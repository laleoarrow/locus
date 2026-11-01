import { defineBackground } from 'wxt/utils/define-background';
import { recordAnchorStates } from '@/db/library';
import { editAnnotations, getPageSummary, savePageSummaries } from '@/db/editing';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import { toUrlKey } from '@/domain/url';
import { isConfigComplete, type SyncState } from '@/domain/sync';
import { isNewerVersion } from '@/domain/version';
import { LLMError, validateLLMConfig } from '@/domain/llm';
import type { ConnectionAttempt, ConnectionState } from '@/domain/status';
import { generateSummary, testLLMConnection, validateSummaryRequest } from '@/llm/client';
import { beginLLMConnection, finishLLMConnection, getLLMConfig, getLLMConfigView, getLLMConnection, saveLLMConfig } from '@/llm/store';
import type { BgRequest, BgResponseFor, ChangeBroadcast, TabMessage } from '@/messaging/protocol';
import { runSync, testConnection, type SyncResult } from '@/sync/engine';
import { rescheduleSyncAlarm, SYNC_ALARM } from '@/sync/schedule';
import {
  getSyncConfig,
  getSyncConnection,
  getSyncState,
  claimScheduledSync,
  beginSyncConnection,
  finishSyncConnection,
  setSyncConfig,
  toConfigView,
} from '@/sync/store';

const RELEASES_API = 'https://api.github.com/repos/laleoarrow/locus/releases/latest';
const UPDATE_ALARM = 'locus-update-check';
/** A manual request and a scheduled alarm cannot interleave two passes. */
let syncing = false;

async function syncNow(manual = false, scheduledRevision?: number): Promise<{ result: SyncResult; state: SyncState; connection: ConnectionState }> {
  const config = await getSyncConfig();
  const state = await getSyncState();
  if (!config.enabled || !isConfigComplete(config)) {
    return {
      result: {
        ok: false,
        pulled: 0,
        settingsPulled: 0,
        pushed: false,
        error: 'Sync is off.',
      },
      state,
      connection: await getSyncConnection(),
    };
  }
  if (!manual && scheduledRevision !== config.revision) return {
    result: { ok: false, pulled: 0, settingsPulled: 0, pushed: false, error: 'Sync schedule changed.' },
    state, connection: await getSyncConnection(),
  };
  if (!manual && state.autoPaused === 'quota') {
    return {
      result: { ok: false, pulled: 0, settingsPulled: 0, pushed: false,
        error: '网盘上传流量不足，自动上传已暂停。额度恢复后可手动重试。' },
      state, connection: await getSyncConnection(),
    };
  }
  if (syncing) {
    return {
      result: {
        ok: false,
        pulled: 0,
        settingsPulled: 0,
        pushed: false,
        error: 'Already syncing.',
      },
      state,
      connection: await getSyncConnection(),
    };
  }
  syncing = true;
  try {
    const attempt = await beginSyncConnection(config.revision);
    if (!attempt) return {
      result: { ok: false, pulled: 0, settingsPulled: 0, pushed: false, error: 'Sync settings changed. Run sync again.' },
      state: await getSyncState(), connection: await getSyncConnection(),
    };
    const outcome = await runSync(config, state, chrome.runtime.getManifest().version,
      async () => (await getSyncConfig()).revision === config.revision, { fullScan: manual });
    await finishSyncConnection(attempt, outcome.result.ok, outcome.result.error, outcome.state);
    if (outcome.result.pulled > 0) {
      // Pulled rows change what pages should render: refresh every tab.
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(
        tabs
          .filter((tab) => tab.id !== undefined && tab.url && /^https?:/.test(tab.url))
          .map((tab) =>
            chrome.tabs.sendMessage(tab.id as number, {
              type: 'annotations:changed',
              urlKey: toUrlKey(tab.url as string),
            } satisfies TabMessage),
          ),
      );
    }
    if (outcome.result.settingsPulled > 0) await broadcastPrefs();
    if (outcome.result.pulled > 0 || outcome.result.settingsPulled > 0) {
      await broadcastOpenPageColors();
    }
    const current = await getSyncConfig();
    return {
      result: current.revision === config.revision ? outcome.result
        : { ...outcome.result, ok: false, error: 'Sync settings changed during this run. Run sync again.' },
      state: await getSyncState(), connection: await getSyncConnection(),
    };
  } finally {
    syncing = false;
    await rescheduleSyncAlarm();
  }
}

/**
 * Update check: fetches release *metadata* from GitHub (nothing about the
 * user or their pages is sent) and badges the action icon when a newer
 * version exists. Sideloaded extensions cannot self-install updates, so the
 * popup links to the release download instead.
 */
async function checkForUpdates(): Promise<void> {
  const prefs = await repo.getPrefs();
  if (!prefs.checkUpdates) return;
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;
    const release = (await response.json()) as { tag_name?: string; html_url?: string };
    if (!release.tag_name || !release.html_url) return;
    await repo.setUpdateInfo({
      latestVersion: release.tag_name.replace(/^v/, ''),
      releaseUrl: release.html_url,
      checkedAt: Date.now(),
    });
    await syncUpdateBadge();
  } catch {
    // offline etc. — try again on the next alarm
  }
}

async function updateStatus(): Promise<BgResponseFor<{ type: 'update:status' }>> {
  const current = chrome.runtime.getManifest().version;
  const info = await repo.getUpdateInfo();
  return { current, info, hasUpdate: !!info && isNewerVersion(info.latestVersion, current) };
}

async function syncUpdateBadge(): Promise<void> {
  const { hasUpdate } = await updateStatus();
  await chrome.action.setBadgeBackgroundColor({ color: '#0a84ff' });
  await chrome.action.setBadgeText({ text: hasUpdate ? '1' : '' });
}

const CONTENT_SCRIPT_ID = 'locus-content';
const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

/**
 * Keep the dynamic content-script registration in sync with the origins the
 * user has granted. This is derived state (chrome.permissions is the source
 * of truth), so it is safe to recompute whenever the worker wakes up.
 */
async function syncRegistration(): Promise<string[]> {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter((o) => o.startsWith('http://') || o.startsWith('https://'));
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (matches.length === 0) {
    if (registered.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    return matches;
  }
  const script: chrome.scripting.RegisteredContentScript = {
    id: CONTENT_SCRIPT_ID,
    js: [CONTENT_SCRIPT_FILE],
    matches,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  };
  if (registered.length > 0) {
    await chrome.scripting.updateContentScripts([script]);
  } else {
    await chrome.scripting.registerContentScripts([script]);
  }
  return matches;
}

async function broadcastPrefs(): Promise<{ prefs: Awaited<ReturnType<typeof repo.getPrefs>> }> {
  const prefs = await repo.getPrefs();
  const message: TabMessage = { type: 'prefs:changed', prefs };
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) => chrome.tabs.sendMessage(tab.id as number, message)),
  );
  return { prefs };
}

async function broadcastPageColors(url: string): Promise<{ colors: string[] }> {
  const urlKey = toUrlKey(url);
  const colors = await repo.getPageColorKeys(url);
  const message: TabMessage = { type: 'page-colors:changed', urlKey, colors };
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && tab.url && toUrlKey(tab.url) === urlKey)
      .map((tab) => chrome.tabs.sendMessage(tab.id as number, message)),
  );
  return { colors };
}

async function broadcastOpenPageColors(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const pages = new Map<string, { url: string; tabIds: number[] }>();
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) continue;
    const urlKey = toUrlKey(tab.url);
    const page = pages.get(urlKey);
    if (page) page.tabIds.push(tab.id);
    else pages.set(urlKey, { url: tab.url, tabIds: [tab.id] });
  }
  await Promise.all(
    [...pages.entries()].map(async ([urlKey, page]) => {
      const colors = await repo.getPageColorKeys(page.url);
      const message: TabMessage = { type: 'page-colors:changed', urlKey, colors };
      await Promise.allSettled(page.tabIds.map((tabId) => chrome.tabs.sendMessage(tabId, message)));
    }),
  );
}

async function broadcastChange(urlKey: string): Promise<void> {
  const toRuntime: ChangeBroadcast = { type: 'annotations:changed', urlKey };
  chrome.runtime.sendMessage(toRuntime).catch(() => {
    // no side panel open; fine
  });
  const toTab: TabMessage = { type: 'annotations:changed', urlKey };
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && tab.url && toUrlKey(tab.url) === urlKey)
      .map((tab) => chrome.tabs.sendMessage(tab.id as number, toTab)),
  );
}

async function handleRequest<T extends BgRequest>(message: T, sender: chrome.runtime.MessageSender): Promise<BgResponseFor<T>>;
async function handleRequest(message: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'source:bootstrap': {
      const source = await repo.ensureSource(message.url, message.title);
      const items = await repo.listForSource(source.id);
      const prefs = await repo.getPrefs();
      let altVersion = null;
      if (prefs.detectDoi && message.doi) {
        await repo.recordDoi(source.documentId, message.doi);
        altVersion = await repo.findAltVersion(message.doi, source.documentId);
      }
      return {
        source,
        items,
        lastColor: await repo.getLastColor(),
        prefs,
        pageColors: await repo.getPageColorKeys(message.url),
        altVersion,
      };
    }
    case 'annotations:list':
      return repo.listForUrl(message.url);
    case 'annotation:create': {
      const source = await repo.ensureSource(message.url, message.title);
      const item = await repo.createAnnotation({
        sourceId: source.id,
        documentId: source.documentId,
        color: message.color,
        comment: message.comment,
        anchor: message.anchor,
      });
      await broadcastChange(source.urlKey);
      return { item };
    }
    case 'annotation:set-comment': {
      await repo.setComment(message.id, message.comment);
      await broadcastForAnnotation(message.id);
      return { ok: true };
    }
    case 'annotation:delete': {
      await repo.tombstone(message.id);
      await broadcastForAnnotation(message.id);
      return { ok: true };
    }
    case 'annotation:undelete': {
      await repo.undelete(message.id);
      await broadcastForAnnotation(message.id);
      return { ok: true };
    }
    case 'annotations:delete': {
      await repo.tombstoneMany(message.ids);
      await bestEffortBroadcastForAnnotations(message.ids);
      return { ok: true };
    }
    case 'annotations:undelete': {
      await repo.undeleteMany(message.ids);
      await bestEffortBroadcastForAnnotations(message.ids);
      return { ok: true };
    }
    case 'annotations:edit': {
      try {
        if (!sender.url?.startsWith(chrome.runtime.getURL(''))) {
          // Reading pages may edit one of their own notes; Library keeps the
          // cross-page batch capability. Do not expose bulk edits to content.
          const expected = message.expected?.[0];
          if (sender.tab?.id === undefined || sender.frameId !== 0 || !sender.url ||
            message.expected?.length !== 1 || !expected ||
            !['comment', 'delete'].includes(message.action?.type)) {
            throw new Error('Open the Locus library to use this action.');
          }
          const annotation = await db.annotations.get(expected.id);
          const source = annotation && await db.sources.get(annotation.sourceId);
          if (!source || source.urlKey !== toUrlKey(sender.url)) {
            throw new Error('This note belongs to another page. Open it in the Locus library.');
          }
        }
        const result = await editAnnotations(message.expected, message.action);
        if (result.updated > 0) {
          await bestEffortBroadcastForAnnotations(result.annotationIds, message.action.type === 'color');
        }
        return { updated: result.updated };
      } catch (error) {
        return { updated: 0, error: error instanceof Error ? error.message : 'Could not edit annotations.' };
      }
    }
    case 'summary:save': {
      try {
        const result = await savePageSummaries(message.changes);
        return result;
      } catch (error) {
        return { updated: 0, error: error instanceof Error ? error.message : 'Could not save main content.' };
      }
    }
    case 'llm:status':
      return { config: await getLLMConfigView(), connection: await getLLMConnection() };
    case 'llm:save': {
      try {
        return { config: await saveLLMConfig(message.patch), connection: await getLLMConnection() };
      } catch (error) {
        return {
          config: await getLLMConfigView(),
          connection: await getLLMConnection(),
          error: error instanceof Error ? error.message : 'Could not save LLM settings.',
        };
      }
    }
    case 'llm:test': {
      let attempt: ConnectionAttempt | null = null;
      try {
        const config = await getLLMConfig();
        if (!config.enabled) throw new LLMError('请先在设置中启用 AI 整理。');
        validateLLMConfig(config);
        attempt = await beginLLMConnection(config.revision);
        if (!attempt) throw new LLMError('LLM 设置已改变，请重新测试。');
        await testLLMConnection(config);
        if (!await finishLLMConnection(attempt, true)) throw new LLMError('设置已改变或已有更新的测试，请重新查看连接状态。');
        return { ok: true, error: '', connection: await getLLMConnection() };
      } catch (error) {
        const message = error instanceof LLMError ? error.message : 'Could not test the LLM connection.';
        if (attempt && error instanceof LLMError && error.requestAttempted) {
          await finishLLMConnection(attempt, false, message);
        }
        return { ok: false, error: message, connection: await getLLMConnection() };
      }
    }
    case 'llm:generate': {
      let attempt: ConnectionAttempt | null = null;
      try {
        const config = await getLLMConfig();
        const source = await db.sources.get(message.sourceId);
        if (!source) throw new Error('This page no longer exists.');
        const readNotes = async () => (await db.annotations.where('sourceId').equals(source.id).toArray())
          .filter((row) => row.deletedAt === 0).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
          .map((row) => ({ id: row.id, quote: row.exact, note: row.comment }));
        const notes = await readNotes();
        if (notes.length === 0) throw new Error('This page has no live annotations to organise.');
        const summary = await getPageSummary(source.id);
        const input = {
          title: source.title,
          url: source.url,
          annotations: notes.map(({ quote, note }) => ({ quote, note })),
        };
        validateSummaryRequest(config, input);
        attempt = await beginLLMConnection(config.revision, false);
        if (!attempt) throw new Error('LLM settings changed during generation. Generate again with the current settings.');
        const content = await generateSummary(config, input);
        await finishLLMConnection(attempt, true);
        if ((await getLLMConfig()).revision !== config.revision) {
          throw new Error('LLM settings changed during generation. Generate again with the current settings.');
        }
        if (JSON.stringify(await readNotes()) !== JSON.stringify(notes)) {
          throw new Error('The page notes changed during generation. Generate again from the updated notes.');
        }
        return { draft: { sourceId: source.id, content, expectedUpdatedAt: summary?.updatedAt ?? 0 } };
      } catch (error) {
        if (attempt && error instanceof LLMError && error.requestAttempted) {
          await finishLLMConnection(attempt, false, error.message);
        }
        return { error: error instanceof Error ? error.message : 'Could not generate main content.' };
      }
    }
    case 'annotations:replace-color': {
      try {
        const result = await repo.replaceAnnotationColor(
          message.sourceColor,
          message.targetColor,
          message.expectedCount,
          message.expectedAnnotations,
        );
        if (result.updated > 0) {
          await bestEffortBroadcastForAnnotations(result.annotationIds, true);
        }
        return { updated: result.updated };
      } catch (error) {
        console.error('[locus] color replacement failed', error);
        return {
          updated: 0,
          error: error instanceof Error ? error.message : 'Could not replace annotation colors.',
        };
      }
    }
    case 'prefs:set-placement': {
      await repo.setPlacement(message.placement);
      return broadcastPrefs();
    }
    case 'page-colors:add': {
      await repo.addPageColor(message.url, message.color);
      const result = await broadcastPageColors(message.url);
      return result;
    }
    case 'page-colors:remove': {
      await repo.removePageColor(message.url, message.key);
      const result = await broadcastPageColors(message.url);
      return result;
    }
    case 'prefs:toggle-site': {
      await repo.setSiteDisabled(message.origin, message.disabled);
      return broadcastPrefs();
    }
    case 'prefs:set-detect-doi': {
      await repo.setDetectDoi(message.on);
      return broadcastPrefs();
    }
    case 'prefs:set-check-updates': {
      await repo.setCheckUpdates(message.on);
      if (message.on) void checkForUpdates();
      else await chrome.action.setBadgeText({ text: '' });
      return broadcastPrefs();
    }
    case 'update:status':
      return updateStatus();
    case 'sync:status':
      return { config: toConfigView(await getSyncConfig()), state: await getSyncState(), connection: await getSyncConnection() };
    case 'sync:save': {
      try {
        const config = await setSyncConfig(message.patch, message.expectedRevision);
        await rescheduleSyncAlarm();
        return { config: toConfigView(config), state: await getSyncState(), connection: await getSyncConnection() };
      } catch (error) {
        return {
          config: toConfigView(await getSyncConfig()), state: await getSyncState(), connection: await getSyncConnection(),
          error: error instanceof Error ? error.message : 'Could not save sync settings.',
        };
      }
    }
    case 'sync:test': {
      const config = await getSyncConfig();
      const attempt = await beginSyncConnection(config.revision);
      if (!attempt) return { ok: false, error: 'Sync settings changed. Test again.', connection: await getSyncConnection() };
      const result = await testConnection(config);
      const current = await finishSyncConnection(attempt, result.ok, result.error);
      return {
        ...(current ? result : { ok: false, error: 'Settings changed or a newer check started. Test again.' }),
        connection: await getSyncConnection(),
      };
    }
    case 'sync:now':
      return syncNow(true);
    case 'anchor-state:report': {
      await recordAnchorStates(message.states);
      return { ok: true };
    }
    case 'library:set-mode': {
      await repo.setLibraryMode(message.mode);
      return { mode: message.mode };
    }
    case 'library:open': {
      await openLibrary();
      return { ok: true };
    }
    case 'library:reveal':
      return revealInPage(message.url, message.annotationId);
  }
}

const LIBRARY_PAGE = 'library.html';

/** Focus the library tab if it is already open, otherwise create it. */
async function openLibrary(): Promise<void> {
  const url = chrome.runtime.getURL(LIBRARY_PAGE);
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

/**
 * Open (or focus) the page an annotation lives on and scroll to it.
 *
 * A freshly created tab has no content script for a moment, so the reveal
 * cannot simply be sent: it is retried while the page boots. Failing to reach
 * the highlight is reported rather than swallowed — the tab is still opened, so
 * the user is not left wondering whether the click did anything.
 */
async function revealInPage(
  url: string,
  annotationId: string,
): Promise<{ ok: boolean; revealed: boolean }> {
  const urlKey = toUrlKey(url);
  const tabs = await chrome.tabs.query({});
  const match = tabs.find((tab) => tab.url && toUrlKey(tab.url) === urlKey);

  let tabId: number | undefined;
  if (match?.id !== undefined) {
    tabId = match.id;
    await chrome.tabs.update(tabId, { active: true });
    if (match.windowId !== undefined) {
      await chrome.windows.update(match.windowId, { focused: true });
    }
  } else {
    const created = await chrome.tabs.create({ url, active: true });
    tabId = created.id;
  }
  if (tabId === undefined) return { ok: false, revealed: false };

  const reveal: TabMessage = { type: 'annotation:reveal', id: annotationId };
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, reveal);
      return { ok: true, revealed: true };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return { ok: true, revealed: false };
}

async function broadcastForAnnotation(id: string): Promise<void> {
  const annotation = await repo.getAnnotation(id);
  if (!annotation) return;
  const source = await db.sources.get(annotation.sourceId);
  if (source) await broadcastChange(source.urlKey);
}

async function broadcastForAnnotations(
  ids: string[],
  refreshPageColors = false,
): Promise<void> {
  const annotations = await db.annotations.bulkGet([...new Set(ids)]);
  const sourceIds = [
    ...new Set(
      annotations.flatMap((annotation) => annotation ? [annotation.sourceId] : []),
    ),
  ];
  const sources = (await db.sources.bulkGet(sourceIds)).filter(
    (source): source is NonNullable<typeof source> => source !== undefined,
  );
  const urlKeys = [
    ...new Set(sources.map((source) => source.urlKey)),
  ];
  await Promise.all([
    ...urlKeys.map((urlKey) => broadcastChange(urlKey)),
    ...(refreshPageColors ? sources.map((source) => broadcastPageColors(source.url)) : []),
  ]);
}

async function bestEffortBroadcastForAnnotations(
  ids: string[],
  refreshPageColors = false,
): Promise<void> {
  try {
    await broadcastForAnnotations(ids, refreshPageColors);
  } catch (error) {
    // The database transaction has already committed. Do not report the user
    // action as failed just because tab notification was temporarily
    // unavailable; the initiating content script refreshes from IndexedDB.
    console.error('[locus] annotation batch notification failed', error);
    setTimeout(() => {
      void broadcastForAnnotations(ids, refreshPageColors).catch((retryError: unknown) => {
        console.error('[locus] annotation batch notification retry failed', retryError);
      });
    }, 500);
  }
}

export default defineBackground(() => {
  // Restore the persisted alarm on worker wake without starting a sync pass.
  void rescheduleSyncAlarm();
  chrome.runtime.onInstalled.addListener(() => {
    void syncRegistration();
    void chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 60 * 12, delayInMinutes: 1 });
    void checkForUpdates();
    void rescheduleSyncAlarm();
  });
  chrome.runtime.onStartup.addListener(() => {
    void syncRegistration();
    void checkForUpdates();
    void rescheduleSyncAlarm();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM) void checkForUpdates();
    if (alarm.name === SYNC_ALARM) void (async () => {
      const revision = await claimScheduledSync();
      if (revision !== null) await syncNow(false, revision);
      await rescheduleSyncAlarm();
    })();
  });
  chrome.permissions.onAdded.addListener(() => void syncRegistration());
  chrome.permissions.onRemoved.addListener(() => void syncRegistration());

  chrome.runtime.onMessage.addListener((message: BgRequest, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if ((message.type.startsWith('llm:') || message.type === 'summary:save') &&
      !sender.url?.startsWith(chrome.runtime.getURL(''))) {
      sendResponse({ error: 'Open the Locus library to use this action.' });
      return false;
    }
    handleRequest(message, sender).then(sendResponse, (error: unknown) => {
      console.error('[locus] background request failed', message.type, error);
      sendResponse(undefined);
    });
    return true; // async response
  });
});

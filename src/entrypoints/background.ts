import { defineBackground } from 'wxt/utils/define-background';
import { recordAnchorStates } from '@/db/library';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import { toUrlKey } from '@/domain/url';
import { isConfigComplete, type SyncState } from '@/domain/sync';
import { isNewerVersion } from '@/domain/version';
import type { BgRequest, BgResponseFor, ChangeBroadcast, TabMessage } from '@/messaging/protocol';
import { runSync, testConnection, type SyncResult } from '@/sync/engine';
import {
  getSyncConfig,
  getSyncState,
  setSyncConfig,
  setSyncState,
  toConfigView,
} from '@/sync/store';

const RELEASES_API = 'https://api.github.com/repos/laleoarrow/locus/releases/latest';
const UPDATE_ALARM = 'locus-update-check';
const SYNC_ALARM = 'locus-sync';
/** Coalesce bursts of edits into one push. */
const SYNC_DEBOUNCE_MS = 4000;

let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** Guard so an alarm and a debounced push cannot interleave two passes. */
let syncing = false;
/** A local mutation that still needs a pass after the active one finishes. */
let syncQueued = false;

async function syncNow(): Promise<{ result: SyncResult; state: SyncState }> {
  const config = await getSyncConfig();
  const state = await getSyncState();
  if (!config.enabled || !isConfigComplete(config)) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
    syncQueued = false;
    return {
      result: {
        ok: false,
        pulled: 0,
        settingsPulled: 0,
        pushed: false,
        error: 'Sync is off.',
      },
      state,
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
    };
  }
  clearTimeout(syncTimer);
  syncTimer = undefined;
  // A manual/alarm pass includes everything queued before it starts. Any
  // mutation after this point sets the flag again and is pushed afterwards.
  syncQueued = false;
  syncing = true;
  try {
    const outcome = await runSync(config, state, chrome.runtime.getManifest().version);
    await setSyncState(outcome.state);
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
    return outcome;
  } finally {
    syncing = false;
    if (syncQueued) armScheduledSync();
  }
}

function armScheduledSync(): void {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    void syncNow();
  }, SYNC_DEBOUNCE_MS);
}

/** Called after any local mutation; pushes once the edits settle. */
function scheduleSync(): void {
  syncQueued = true;
  armScheduledSync();
}

async function rescheduleSyncAlarm(): Promise<void> {
  const config = await getSyncConfig();
  await chrome.alarms.clear(SYNC_ALARM);
  if (config.enabled && isConfigComplete(config)) {
    await chrome.alarms.create(SYNC_ALARM, {
      periodInMinutes: config.intervalMinutes,
      delayInMinutes: config.intervalMinutes,
    });
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
  // Every local mutation funnels through here, so this is the one place that
  // needs to nudge sync. (A pull inside syncNow notifies tabs directly instead,
  // so merging remote rows cannot re-trigger a push.)
  scheduleSync();
}

async function handleRequest<T extends BgRequest>(message: T): Promise<BgResponseFor<T>>;
async function handleRequest(message: BgRequest): Promise<unknown> {
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
      scheduleSync();
      await bestEffortBroadcastForAnnotations(message.ids);
      return { ok: true };
    }
    case 'annotations:undelete': {
      await repo.undeleteMany(message.ids);
      scheduleSync();
      await bestEffortBroadcastForAnnotations(message.ids);
      return { ok: true };
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
          scheduleSync();
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
      scheduleSync();
      return result;
    }
    case 'page-colors:remove': {
      await repo.removePageColor(message.url, message.key);
      const result = await broadcastPageColors(message.url);
      scheduleSync();
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
      return { config: toConfigView(await getSyncConfig()), state: await getSyncState() };
    case 'sync:save': {
      const config = await setSyncConfig(message.patch);
      await rescheduleSyncAlarm();
      if (config.enabled && isConfigComplete(config)) scheduleSync();
      return { config: toConfigView(config), state: await getSyncState() };
    }
    case 'sync:test':
      return testConnection(await getSyncConfig());
    case 'sync:now':
      return syncNow();
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
    void syncNow();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM) void checkForUpdates();
    if (alarm.name === SYNC_ALARM) void syncNow();
  });
  chrome.permissions.onAdded.addListener(() => void syncRegistration());
  chrome.permissions.onRemoved.addListener(() => void syncRegistration());

  chrome.runtime.onMessage.addListener((message: BgRequest, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    handleRequest(message).then(sendResponse, (error: unknown) => {
      console.error('[locus] background request failed', message.type, error);
      sendResponse(undefined);
    });
    return true; // async response
  });
});

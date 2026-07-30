import { defineBackground } from 'wxt/utils/define-background';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import { toUrlKey } from '@/domain/url';
import type { BgRequest, BgResponseFor, ChangeBroadcast, TabMessage } from '@/messaging/protocol';

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

async function handleRequest<T extends BgRequest>(message: T): Promise<BgResponseFor<T>>;
async function handleRequest(message: BgRequest): Promise<unknown> {
  switch (message.type) {
    case 'source:bootstrap': {
      const source = await repo.ensureSource(message.url, message.title);
      const items = await repo.listForSource(source.id);
      return { source, items, lastColor: await repo.getLastColor() };
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
    case 'site:registered-status': {
      const { origins = [] } = await chrome.permissions.getAll();
      return { origins };
    }
    case 'site:enable': {
      // The popup already obtained the grant (permissions.request needs its
      // user gesture); register and inject into the requesting tab now.
      await syncRegistration();
      if (message.tabId !== undefined) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: message.tabId },
            files: [CONTENT_SCRIPT_FILE],
          });
        } catch {
          return { ok: false };
        }
      }
      return { ok: true };
    }
  }
}

async function broadcastForAnnotation(id: string): Promise<void> {
  const annotation = await repo.getAnnotation(id);
  if (!annotation) return;
  const source = await db.sources.get(annotation.sourceId);
  if (source) await broadcastChange(source.urlKey);
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => void syncRegistration());
  chrome.runtime.onStartup.addListener(() => void syncRegistration());
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

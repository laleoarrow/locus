import type {
  AnchorPayload,
  AnchorState,
  AnnotationWithAnchor,
  ColorKey,
  SourceRecord,
} from '@/domain/types';

/**
 * Typed runtime messaging. Content scripts and the side panel send
 * `BgRequest`s to the background (the single write path); the background
 * broadcasts `ChangeBroadcast`s; the panel talks to tabs with `TabMessage`s
 * for ephemeral state (reveal, anchor states) that must not live in
 * service-worker globals.
 */

export interface BootstrapResult {
  source: SourceRecord;
  items: AnnotationWithAnchor[];
  lastColor: ColorKey;
}

export interface CreateResult {
  item: AnnotationWithAnchor;
}

export type BgRequest =
  | { type: 'source:bootstrap'; url: string; title: string }
  | { type: 'annotations:list'; url: string }
  | {
      type: 'annotation:create';
      url: string;
      title: string;
      color: ColorKey;
      comment: string;
      anchor: AnchorPayload;
    }
  | { type: 'annotation:set-comment'; id: string; comment: string }
  | { type: 'annotation:delete'; id: string }
  | { type: 'annotation:undelete'; id: string }
  | { type: 'site:registered-status' }
  | { type: 'site:enable'; origin: string; tabId?: number };

export interface BgResponseMap {
  'source:bootstrap': BootstrapResult;
  'annotations:list': { source: SourceRecord | undefined; items: AnnotationWithAnchor[] };
  'annotation:create': CreateResult;
  'annotation:set-comment': { ok: true };
  'annotation:delete': { ok: true };
  'annotation:undelete': { ok: true };
  'site:registered-status': { origins: string[] };
  'site:enable': { ok: boolean };
}

export type BgResponseFor<T extends BgRequest> = BgResponseMap[T['type']];

/** Background → side panel / other extension pages. */
export type ChangeBroadcast =
  | { type: 'annotations:changed'; urlKey: string }
  | { type: 'anchor-state:changed'; urlKey: string };

/** Side panel / background → content script in a tab. */
export type TabMessage =
  | { type: 'annotations:changed'; urlKey: string }
  | { type: 'annotation:reveal'; id: string }
  | { type: 'anchor-state:query' };

export interface AnchorStateReply {
  url: string;
  states: Record<string, AnchorState>;
}

export function requestBg<T extends BgRequest>(message: T): Promise<BgResponseFor<T>> {
  return chrome.runtime.sendMessage(message);
}

export function sendToTab(tabId: number, message: TabMessage): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

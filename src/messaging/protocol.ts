import type { AltVersion } from '@/db/repo';
import type { SyncConfig, SyncState } from '@/domain/sync';
import type { SyncResult } from '@/sync/engine';
import type { SyncConfigView } from '@/sync/store';
import type {
  AnchorPayload,
  AnchorState,
  AnnotationWithAnchor,
  ColorKey,
  CustomColor,
  Prefs,
  SourceRecord,
  ToolbarPlacement,
  UpdateInfo,
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
  prefs: Prefs;
  /** Another annotated version of the same paper (DOI match), if any. */
  altVersion: AltVersion | null;
}

export interface CreateResult {
  item: AnnotationWithAnchor;
}

export type BgRequest =
  | { type: 'source:bootstrap'; url: string; title: string; doi?: string }
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
  | { type: 'prefs:set-placement'; placement: ToolbarPlacement }
  | { type: 'prefs:add-color'; color: CustomColor }
  | { type: 'prefs:remove-color'; key: string }
  | { type: 'prefs:toggle-site'; origin: string; disabled: boolean }
  | { type: 'prefs:set-detect-doi'; on: boolean }
  | { type: 'prefs:set-check-updates'; on: boolean }
  | { type: 'update:status' }
  | { type: 'sync:status' }
  | { type: 'sync:save'; patch: Partial<SyncConfig> }
  | { type: 'sync:test' }
  | { type: 'sync:now' }
  | {
      type: 'anchor-state:report';
      states: { annotationId: string; detached: boolean }[];
    }
  | { type: 'library:open' }
  | { type: 'library:reveal'; url: string; annotationId: string };

export interface BgResponseMap {
  'source:bootstrap': BootstrapResult;
  'annotations:list': { source: SourceRecord | undefined; items: AnnotationWithAnchor[] };
  'annotation:create': CreateResult;
  'annotation:set-comment': { ok: true };
  'annotation:delete': { ok: true };
  'annotation:undelete': { ok: true };
  'prefs:set-placement': { prefs: Prefs };
  'prefs:add-color': { prefs: Prefs };
  'prefs:remove-color': { prefs: Prefs };
  'prefs:toggle-site': { prefs: Prefs };
  'prefs:set-detect-doi': { prefs: Prefs };
  'prefs:set-check-updates': { prefs: Prefs };
  'update:status': { current: string; info: UpdateInfo | null; hasUpdate: boolean };
  'sync:status': { config: SyncConfigView; state: SyncState };
  'sync:save': { config: SyncConfigView; state: SyncState };
  'sync:test': { ok: boolean; error: string };
  'sync:now': { result: SyncResult; state: SyncState };
  'anchor-state:report': { ok: true };
  'library:open': { ok: true };
  /** `revealed` is false when the tab opened but the highlight could not be reached. */
  'library:reveal': { ok: boolean; revealed: boolean };
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
  | { type: 'anchor-state:query' }
  | { type: 'prefs:changed'; prefs: Prefs };

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

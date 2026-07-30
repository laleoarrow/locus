import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listForUrl } from '@/db/repo';
import { COLORS } from '@/domain/colors';
import type { AnchorState, AnnotationWithAnchor } from '@/domain/types';
import { markdownToHtml } from '@/lib/markdown';
import {
  requestBg,
  sendToTab,
  type AnchorStateReply,
  type ChangeBroadcast,
} from '@/messaging/protocol';

const UNDO_MS = 6000;

interface TargetTab {
  tabId: number | null;
  url: string;
  title: string;
}

/** The tab this panel mirrors: the active tab, or ?tabId/?url overrides (tests). */
function useTargetTab(): TargetTab | null {
  const [target, setTarget] = useState<TargetTab | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlOverride = params.get('url');
    if (urlOverride) {
      setTarget({
        tabId: params.get('tabId') ? Number(params.get('tabId')) : null,
        url: urlOverride,
        title: urlOverride,
      });
      return;
    }
    let disposed = false;
    const readActiveTab = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (disposed || !tab?.url) return;
      setTarget({ tabId: tab.id ?? null, url: tab.url, title: tab.title ?? tab.url });
    };
    void readActiveTab();
    const onActivated = () => void readActiveTab();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (info.url || info.status === 'complete')) void readActiveTab();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return target;
}

function useAnchorStates(target: TargetTab | null): Record<string, AnchorState> {
  const [states, setStates] = useState<Record<string, AnchorState>>({});

  const query = useCallback(async () => {
    if (!target?.tabId) return;
    try {
      const reply = (await sendToTab(target.tabId, { type: 'anchor-state:query' })) as
        | AnchorStateReply
        | undefined;
      setStates(reply?.states ?? {});
    } catch {
      setStates({});
    }
  }, [target?.tabId]);

  useEffect(() => {
    void query();
    const onBroadcast = (message: ChangeBroadcast) => {
      if (message.type === 'anchor-state:changed' || message.type === 'annotations:changed') {
        void query();
      }
    };
    chrome.runtime.onMessage.addListener(onBroadcast);
    return () => chrome.runtime.onMessage.removeListener(onBroadcast);
  }, [query]);

  return states;
}

interface UndoEntry {
  id: string;
  exact: string;
}

function AnnotationItem({
  item,
  state,
  onReveal,
  onDelete,
}: {
  item: AnnotationWithAnchor;
  state: AnchorState;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const { annotation, anchor } = item;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.comment);
  const detached = state === 'detached';
  const isImage = anchor.kind === 'image';

  const saveComment = async () => {
    await requestBg({ type: 'annotation:set-comment', id: annotation.id, comment: draft.trim() });
    setEditing(false);
  };

  return (
    <li
      className={`annotation-item${detached ? ' detached' : ''}`}
      data-annotation-id={annotation.id}
      data-anchor-state={state}
      onClick={detached ? undefined : onReveal}
    >
      <div className="annotation-top">
        <span className="color-dot" style={{ background: COLORS[annotation.color].swatch }} />
        {isImage ? (
          <span className="annotation-image">
            <img src={anchor.kind === 'image' ? anchor.src : ''} alt={annotation.exact || 'annotated image'} />
            <span className="annotation-exact">{annotation.exact || 'Image'}</span>
          </span>
        ) : (
          <span className="annotation-exact">{annotation.exact}</span>
        )}
        {detached && <span className="detached-badge">detached</span>}
      </div>
      {!editing && annotation.comment && (
        <div
          className="annotation-comment md"
          // Safe: markdownToHtml escapes all source text (see lib/markdown.ts).
          dangerouslySetInnerHTML={{ __html: markdownToHtml(annotation.comment) }}
        />
      )}
      {editing ? (
        <div className="comment-editor" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Markdown supported"
            autoFocus
          />
          {draft.trim() && (
            <div className="md preview" dangerouslySetInnerHTML={{ __html: markdownToHtml(draft.trim()) }} />
          )}
          <div className="row">
            <button onClick={() => setEditing(false)}>Cancel</button>
            <button className="primary" onClick={() => void saveComment()}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="annotation-actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setEditing(true)}>{annotation.comment ? 'Edit note' : 'Add note'}</button>
          <button className="danger" data-action="delete" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

export function App() {
  const target = useTargetTab();
  const anchorStates = useAnchorStates(target);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // liveQuery re-runs on any IndexedDB change (background writes included).
  const data = useLiveQuery(
    () => (target ? listForUrl(target.url) : Promise.resolve(undefined)),
    [target?.url],
  );

  const deleteAnnotation = async (item: AnnotationWithAnchor) => {
    await requestBg({ type: 'annotation:delete', id: item.annotation.id });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ id: item.annotation.id, exact: item.annotation.exact });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const undoDelete = async () => {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    await requestBg({ type: 'annotation:undelete', id: undo.id });
    setUndo(null);
  };

  const items = data?.items ?? [];
  const supported = target !== null && /^https?:/.test(target.url);

  return (
    <div className="panel">
      <header className="panel-header">
        <h1>Locus · 文迹</h1>
        {data?.source && <p className="source-title">{data.source.title || data.source.url}</p>}
      </header>
      {!supported ? (
        <div className="no-access">This page cannot be annotated.</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          No annotations on this page yet.
          <br />
          Select some text to get started — enable Locus for this site from the toolbar popup first.
        </div>
      ) : (
        <ul className="annotation-list">
          {items.map((item) => (
            <AnnotationItem
              key={item.annotation.id}
              item={item}
              state={anchorStates[item.annotation.id] ?? 'anchored'}
              onReveal={() => {
                if (target?.tabId) {
                  void sendToTab(target.tabId, {
                    type: 'annotation:reveal',
                    id: item.annotation.id,
                  }).catch(() => undefined);
                }
              }}
              onDelete={() => void deleteAnnotation(item)}
            />
          ))}
        </ul>
      )}
      {undo && (
        <div className="undo-bar" data-locus-undo>
          <span>Annotation deleted.</span>
          <button onClick={() => void undoDelete()}>Undo</button>
        </div>
      )}
    </div>
  );
}

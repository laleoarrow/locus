import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exportBackup as repoExportBackup,
  getPageColorKeys,
  getPrefs,
  importBackup as repoImportBackup,
  listForUrl,
} from '@/db/repo';
import { backupFileName, parseBackup, type BackupFile } from '@/domain/backup';
import { buildPaletteForKeys, specFor } from '@/domain/colors';
import { parsePageNoteZip, type PageNoteImportStats } from '@/domain/pagenote';
import type { SyncConfig, SyncState } from '@/domain/sync';
import type { SyncConfigView } from '@/sync/store';
import type {
  AnchorState,
  AnnotationWithAnchor,
  CustomColor,
  ToolbarPlacement,
} from '@/domain/types';
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
  customColors,
  onReveal,
  onDelete,
}: {
  item: AnnotationWithAnchor;
  state: AnchorState;
  customColors: CustomColor[];
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
        <span
          className="color-dot"
          style={{ background: specFor(annotation.color, customColors).swatch }}
        />
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

  const prefs = useLiveQuery(() => getPrefs(), []) ?? {
    placement: 'below' as ToolbarPlacement,
    customColors: [],
    disabledSites: [],
    detectDoi: true,
    checkUpdates: true,
  };
  const pageColorKeys =
    useLiveQuery(
      () => (target ? getPageColorKeys(target.url) : Promise.resolve([])),
      [target?.url],
    ) ?? [];
  const pageColors = buildPaletteForKeys(pageColorKeys, prefs.customColors).slice(3);
  const items = data?.items ?? [];
  const supported = target !== null && /^https?:/.test(target.url);

  const placements: Array<{ value: ToolbarPlacement; label: string }> = [
    { value: 'below', label: 'Below' },
    { value: 'above', label: 'Above' },
    { value: 'auto', label: 'Auto' },
  ];

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
              customColors={prefs.customColors}
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
      <footer className="panel-footer">
        <div className="pref-row">
          <span className="pref-label">Toolbar position</span>
          <div className="segmented" role="group" aria-label="Toolbar position">
            {placements.map(({ value, label }) => (
              <button
                key={value}
                className={prefs.placement === value ? 'on' : ''}
                data-placement={value}
                onClick={() => void requestBg({ type: 'prefs:set-placement', placement: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="pref-row">
          <span className="pref-label">Detect DOI (link paper versions)</span>
          <label className="switch">
            <input
              type="checkbox"
              data-pref="detect-doi"
              checked={prefs.detectDoi}
              onChange={(e) => void requestBg({ type: 'prefs:set-detect-doi', on: e.target.checked })}
            />
            <span />
          </label>
        </div>
        <div className="pref-row">
          <span className="pref-label">Check for updates</span>
          <label className="switch">
            <input
              type="checkbox"
              data-pref="check-updates"
              checked={prefs.checkUpdates}
              onChange={(e) =>
                void requestBg({ type: 'prefs:set-check-updates', on: e.target.checked })
              }
            />
            <span />
          </label>
        </div>
        {pageColors.length > 0 && target && (
          <div className="pref-row" data-page-colors>
            <span className="pref-label">Colors on this page</span>
            <div className="custom-colors">
              {pageColors.map((color) => (
                <span
                  key={color.key}
                  className="color-chip"
                  style={{ background: color.swatch }}
                  title={color.label}
                >
                  <button
                    aria-label={`Remove ${color.label}`}
                    onClick={() =>
                      void requestBg({
                        type: 'page-colors:remove',
                        url: target.url,
                        key: color.key,
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <BackupRow />
        <SyncRow />
      </footer>
    </div>
  );
}

/**
 * Manual backup: export the library to a JSON file, import one back. Also the
 * supported way to move annotations to another machine or another install
 * (IndexedDB is scoped to the extension id).
 */
function BackupRow() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');

  const exportBackup = async () => {
    const file = await repoExportBackup(chrome.runtime.getManifest().version);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName(new Date());
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${file.annotations.filter((a) => a.deletedAt === 0).length} annotations.`);
  };

  const importBackup = async (selected: File) => {
    setStatus('Importing…');
    let file: BackupFile;
    let pageNoteStats: PageNoteImportStats | null = null;
    const isZip = selected.name.toLowerCase().endsWith('.zip') || selected.type.includes('zip');

    if (isZip) {
      const result = await parsePageNoteZip(
        selected,
        chrome.runtime.getManifest().version,
      );
      if ('error' in result) {
        setStatus(result.error);
        return;
      }
      file = result.file;
      pageNoteStats = result.stats;
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await selected.text());
      } catch {
        setStatus('That file is not valid JSON.');
        return;
      }
      const result = parseBackup(parsed);
      if ('error' in result) {
        setStatus(result.error);
        return;
      }
      file = result.file;
    }

    const summary = await repoImportBackup(file);
    let message =
      `Imported: ${summary.annotationsAdded} added, ${summary.annotationsUpdated} updated, ` +
      `${summary.annotationsSkipped} already present.`;
    if (pageNoteStats) {
      const warnings: string[] = [];
      if (pageNoteStats.recordsSkipped) {
        warnings.push(`${pageNoteStats.recordsSkipped} invalid/deleted records skipped`);
      }
      if (pageNoteStats.deletedHighlights) {
        warnings.push(`${pageNoteStats.deletedHighlights} deleted highlights merged`);
      }
      if (pageNoteStats.standaloneNotesSkipped) {
        warnings.push(`${pageNoteStats.standaloneNotesSkipped} standalone notes not supported`);
      }
      if (pageNoteStats.emptyNotesSkipped) {
        warnings.push(`${pageNoteStats.emptyNotesSkipped} empty note shells ignored`);
      }
      if (pageNoteStats.degradedStrikethroughs) {
        warnings.push(
          `${pageNoteStats.degradedStrikethroughs} strikethroughs shown as highlights`,
        );
      }
      message +=
        ` PageNote source: ${pageNoteStats.highlights} highlights, ` +
        `${pageNoteStats.highlightNotes} with notes.` +
        (warnings.length > 0 ? ` ${warnings.join('; ')}.` : '');
    }
    setStatus(message);
  };

  return (
    <div className="pref-row backup-row">
      <span className="pref-label">Backup</span>
      <div className="backup-actions">
        <button data-action="export" onClick={() => void exportBackup()}>
          Export
        </button>
        <button
          data-action="import"
          title="Import a Locus JSON backup or PageNote ZIP"
          onClick={() => fileInput.current?.click()}
        >
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,application/zip,.json,.zip"
          data-locus-import-input
          hidden
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (selected) void importBackup(selected);
          }}
        />
      </div>
      {status && (
        <p className="backup-status" data-locus-backup-status>
          {status}
        </p>
      )}
    </div>
  );
}

function relativeTime(then: number): string {
  if (then === 0) return 'never';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/**
 * WebDAV sync: enter the collection URL and an app password once, and the
 * background worker keeps this library and the remote file merged. Credentials
 * stay in chrome.storage.local, so they never appear in a backup export.
 */
function SyncRow() {
  const [config, setConfig] = useState<SyncConfigView | null>(null);
  const [state, setState] = useState<SyncState | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await requestBg({ type: 'sync:status' });
    if (result) {
      setConfig(result.config);
      setState(result.state);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!config) return null;

  // Saving a field is a fast local write, so it must NOT flip `busy`: a field
  // blurred by the very click that presses Test/Sync would otherwise disable
  // the button between mousedown and click and swallow that first press.
  const save = async (patch: Partial<SyncConfig>) => {
    const result = await requestBg({ type: 'sync:save', patch });
    if (result) {
      setConfig(result.config);
      setState(result.state);
    }
    if (patch.password) setPassword('');
  };

  const test = async () => {
    setBusy(true);
    setStatus('Checking…');
    try {
      if (password) await requestBg({ type: 'sync:save', patch: { password } });
      const result = await requestBg({ type: 'sync:test' });
      setStatus(result?.ok ? 'Connected.' : (result?.error ?? 'Could not connect.'));
      if (password) setPassword('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setStatus('Syncing…');
    try {
      const result = await requestBg({ type: 'sync:now' });
      if (result) {
        setState(result.state);
        setStatus(
          result.result.ok
            ? result.result.pulled > 0
              ? `Synced — ${result.result.pulled} pulled in.`
              : 'Synced.'
            : result.result.error,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pref-row sync-row">
      <span className="pref-label">
        Sync (WebDAV)
        {config.enabled && state ? (
          <em className="sync-when">
            {state.lastError ? 'error' : `synced ${relativeTime(state.lastSyncAt)}`}
          </em>
        ) : null}
      </span>
      <div className="backup-actions">
        <label className="switch">
          <input
            type="checkbox"
            data-pref="sync-enabled"
            checked={config.enabled}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          <span />
        </label>
        <button data-action="sync-settings" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Setup'}
        </button>
      </div>
      {open && (
        <div className="sync-form">
          <input
            type="url"
            data-sync="url"
            placeholder="https://dav.jianguoyun.com/dav/locus/"
            defaultValue={config.url}
            onBlur={(e) => void save({ url: e.target.value })}
          />
          <input
            type="text"
            data-sync="username"
            placeholder="Account (email)"
            autoComplete="off"
            defaultValue={config.username}
            onBlur={(e) => void save({ username: e.target.value })}
          />
          <input
            type="password"
            data-sync="password"
            placeholder={config.hasPassword ? 'App password (saved)' : 'App password'}
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => password && void save({ password })}
          />
          <div className="backup-actions">
            <button data-action="sync-test" disabled={busy} onClick={() => void test()}>
              Test
            </button>
            <button data-action="sync-now" disabled={busy} onClick={() => void syncNow()}>
              Sync now
            </button>
          </div>
          <p className="sync-hint">
            Use your provider's <strong>app password</strong>, not the account password. Annotations
            are merged, never overwritten — the newer edit of each note wins.
          </p>
        </div>
      )}
      {(status || state?.lastError) && (
        <p className="backup-status" data-locus-sync-status>
          {status || state?.lastError}
        </p>
      )}
    </div>
  );
}

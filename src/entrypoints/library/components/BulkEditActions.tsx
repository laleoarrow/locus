import { useEffect, useState } from 'react';
import type { PaletteEntry } from '@/domain/colors';
import type { AnnotationEditAction } from '@/domain/editing';
import './bulk-edit.css';

interface BulkEditActionsProps {
  count: number;
  pageCount: number;
  palette: PaletteEntry[];
  deletedOnly: boolean;
  busy: boolean;
  onSelectAll(): void;
  onClear(): void;
  onExit(): void;
  onApply(action: AnnotationEditAction): Promise<number>;
  onSummarize(): void;
}

export function BulkEditActions({
  count, pageCount, palette, deletedOnly, busy,
  onSelectAll, onClear, onExit, onApply, onSummarize,
}: BulkEditActionsProps) {
  const [action, setAction] = useState<AnnotationEditAction['type'] | null>(null);
  const [color, setColor] = useState('');
  const [comment, setComment] = useState('');
  const [noteMode, setNoteMode] = useState<'append' | 'replace'>('append');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const locked = busy || pending;
  const target = palette.find((entry) => entry.key === color) ?? palette[0];
  const annotations = `${count} annotation${count === 1 ? '' : 's'}`;

  useEffect(() => {
    setAction(null);
    setError('');
    setStatus('');
  }, [deletedOnly]);

  const choose = (next: AnnotationEditAction['type']) => {
    setAction(next);
    setError('');
    setStatus('');
  };

  const apply = async () => {
    if (locked || count === 0 || !action) return;
    let edit: AnnotationEditAction;
    if (action === 'color') {
      if (!target) return;
      edit = { type: 'color', color: target.key };
    } else if (action === 'comment') {
      if (noteMode === 'append' && !comment.trim()) return;
      edit = { type: 'comment', comment: comment.trim(), mode: noteMode };
    } else {
      edit = { type: action };
    }
    setPending(true);
    setError('');
    try {
      const updated = await onApply(edit);
      setStatus(updated > 0
        ? `${updated} annotation${updated === 1 ? '' : 's'} updated.`
        : 'No annotations needed changing.');
      setAction(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the selected annotations.');
    } finally {
      setPending(false);
    }
  };

  const canApply = !locked && count > 0 && action !== null &&
    (action !== 'color' || target !== undefined) &&
    (action !== 'comment' || noteMode === 'replace' || comment.trim() !== '');
  const applyLabel = action === 'color' ? `Set colour on ${annotations}`
    : action === 'comment' ? `${noteMode === 'append' ? 'Append to' : 'Replace'} ${count} note${count === 1 ? '' : 's'}`
      : action === 'delete' ? `Delete ${annotations}` : `Restore ${annotations}`;

  return (
    <section id="selection-actions" className="bulk-edit-panel" aria-label="Selected annotation actions" aria-busy={locked}>
      <div className="bulk-edit-heading">
        <strong data-selection="count" aria-live="polite" aria-label={`已选 ${pageCount} 个页面，${count} 条标注`}>
          {count} selected · {pageCount} page{pageCount === 1 ? '' : 's'}
        </strong>
        <div className="bulk-edit-buttons">
          <button type="button" data-selection="all" disabled={locked} onClick={onSelectAll} title="当前筛选中的标注，含折叠内容">
            全选筛选结果
          </button>
          <button type="button" data-selection="clear" disabled={locked || count === 0} onClick={onClear}>
            清空选择
          </button>
          <button type="button" data-selection="exit" disabled={locked} onClick={onExit}>退出选择</button>
        </div>
      </div>
      <div className="bulk-edit-buttons">
        {!deletedOnly && <>
          <button type="button" data-selection="color" disabled={locked || count === 0} onClick={() => choose('color')}>
            批量改色
          </button>
          <button type="button" data-selection="comment" disabled={locked || count === 0} onClick={() => choose('comment')}>
            批量编辑笔记
          </button>
          <button type="button" data-selection="summarize" disabled={locked || count === 0} onClick={onSummarize}
            title="整理所选页面的全部未删除标注和笔记" aria-description="整理所选页面的全部未删除标注和笔记">
            批量整理主要内容
          </button>
        </>}
        <button
          type="button"
          className={deletedOnly ? '' : 'danger'}
          data-selection={deletedOnly ? 'restore' : 'delete'}
          disabled={locked || count === 0}
          onClick={() => choose(deletedOnly ? 'restore' : 'delete')}
        >
          {deletedOnly ? '批量恢复' : '批量删除'}
        </button>
      </div>

      {action && (
        <form className="bulk-edit-form" onSubmit={(event) => { event.preventDefault(); void apply(); }}>
          {action === 'color' && (
            <label>
              <span>New colour</span>
              <select data-selection="target-color" value={target?.key ?? ''} disabled={locked} onChange={(event) => setColor(event.target.value)} autoFocus>
                {palette.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
              </select>
            </label>
          )}
          {action === 'comment' && <>
            <label>
              <span>Note action</span>
              <select data-selection="note-mode" value={noteMode} disabled={locked} onChange={(event) => setNoteMode(event.target.value as 'append' | 'replace')}>
                <option value="append">Append to existing notes</option>
                <option value="replace">Replace existing notes</option>
              </select>
            </label>
            <label>
              <span>Note text</span>
              <textarea data-selection="note-text" value={comment} disabled={locked} onChange={(event) => setComment(event.target.value)} placeholder="Markdown supported" rows={3} autoFocus />
            </label>
          </>}
          <p className="bulk-edit-description" data-selection="preview">
            {action === 'color' && `Set ${annotations} to ${target?.label ?? 'the chosen colour'}.`}
            {action === 'comment' && (noteMode === 'append'
              ? `Add this text after the existing note on each of the ${annotations}.`
              : `Replace the existing note on each of the ${annotations}. Leave empty to clear these notes.`)}
            {action === 'delete' && `Move ${annotations} to Deleted. You can restore them there.`}
            {action === 'restore' && `Restore ${annotations} to the library.`}
          </p>
          <div className="bulk-edit-buttons bulk-edit-confirm">
            <button type="button" disabled={locked} onClick={() => { setAction(null); setError(''); }}>Cancel</button>
            <button type="submit" className={action === 'delete' ? 'primary danger' : 'primary'} data-selection="apply" disabled={!canApply}>
              {locked ? 'Updating…' : applyLabel}
            </button>
          </div>
        </form>
      )}
      {error && <p className="bulk-edit-error" role="alert">{error}</p>}
      {status && <p className="bulk-edit-description" role="status">{status}</p>}
    </section>
  );
}

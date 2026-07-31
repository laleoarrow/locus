import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PaletteEntry } from '@/domain/colors';
import type { ColorKey } from '@/domain/types';

interface BulkColorActionsProps {
  palette: PaletteEntry[];
  counts: ReadonlyMap<ColorKey, number>;
  preferredSource?: ColorKey;
  onReplace: (
    sourceColor: ColorKey,
    targetColor: ColorKey,
    expectedCount: number,
  ) => Promise<number>;
}

type OpenView = 'closed' | 'menu' | 'dialog';

export function BulkColorActions({
  palette,
  counts,
  preferredSource,
  onReplace,
}: BulkColorActionsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLSelectElement>(null);
  const [view, setView] = useState<OpenView>('closed');
  const [sourceColor, setSourceColor] = useState<ColorKey>('');
  const [targetColor, setTargetColor] = useState<ColorKey>('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const close = (restoreFocus = true, force = false) => {
    if (pending && !force) return;
    setView('closed');
    setPending(false);
    setError('');
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (view === 'closed') return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [pending, view]);

  useEffect(() => {
    if (view === 'menu') menuItemRef.current?.focus();
    if (view === 'dialog') {
      if (pending) dialogRef.current?.focus();
      else sourceRef.current?.focus();
    }
  }, [pending, view]);

  const openDialog = () => {
    const preferred =
      preferredSource && (counts.get(preferredSource) ?? 0) > 0
        ? preferredSource
        : undefined;
    const source =
      preferred ??
      palette.find((entry) => (counts.get(entry.key) ?? 0) > 0)?.key ??
      palette[0]?.key ??
      '';
    const target = palette.find((entry) => entry.key !== source)?.key ?? source;
    setSourceColor(source);
    setTargetColor(target);
    setError('');
    setView('dialog');
  };

  const source = palette.find((entry) => entry.key === sourceColor);
  const target = palette.find((entry) => entry.key === targetColor);
  const affected = counts.get(sourceColor) ?? 0;
  const sameColor = sourceColor === targetColor;
  const canConfirm =
    !pending &&
    affected > 0 &&
    !sameColor &&
    source !== undefined &&
    target !== undefined;

  let summary = 'Choose a source and target colour.';
  if (source && target) {
    if (affected === 0) {
      summary = `There are no live ${source.label} annotations to replace.`;
    } else if (sameColor) {
      summary = 'Choose a different target colour.';
    } else {
      summary =
        `${affected} live ${source.label} annotation${affected === 1 ? '' : 's'} ` +
        `will change to ${target.label}. Detached annotations are included; ` +
        'deleted annotations are excluded.';
    }
  }

  const confirm = async () => {
    if (!canConfirm) return;
    setPending(true);
    setError('');
    try {
      const updated = await onReplace(sourceColor, targetColor, affected);
      if (updated === 0) {
        setError('No live annotations were changed. The library may have changed; try again.');
        setPending(false);
        return;
      }
      close(true, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not replace annotation colours.');
      setPending(false);
    }
  };

  return (
    <div className="bulk-color-actions" ref={rootRef}>
      <button
        ref={triggerRef}
        className="chip batch-trigger"
        type="button"
        data-bulk-action="menu"
        aria-haspopup={view === 'dialog' ? 'dialog' : 'menu'}
        aria-expanded={view !== 'closed'}
        aria-controls={
          view === 'menu'
            ? 'bulk-colour-menu'
            : view === 'dialog'
              ? 'bulk-colour-dialog'
              : undefined
        }
        title="Batch actions"
        disabled={pending}
        onClick={() => setView((current) => (current === 'menu' ? 'closed' : 'menu'))}
        onKeyDown={(event) => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && view !== 'dialog') {
            event.preventDefault();
            setView('menu');
          }
        }}
      >
        Batch <span aria-hidden="true">⌄</span>
      </button>

      {view === 'menu' && (
        <div className="bulk-menu" id="bulk-colour-menu" role="menu">
          <button
            ref={menuItemRef}
            type="button"
            role="menuitem"
            data-bulk-action="replace-color"
            onClick={openDialog}
          >
            Replace annotation colours…
          </button>
        </div>
      )}

      {view === 'dialog' && (
        <>
          {pending &&
            createPortal(
              <div className="bulk-operation-shield" aria-hidden="true" />,
              document.body,
            )}
          <div
            ref={dialogRef}
            className="bulk-colour-popover"
            id="bulk-colour-dialog"
            role="dialog"
            aria-labelledby="bulk-colour-title"
            aria-busy={pending}
            aria-modal={pending || undefined}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (pending && event.key === 'Tab') event.preventDefault();
            }}
          >
            <div className="bulk-popover-heading">
              <h2 id="bulk-colour-title">Replace annotation colours</h2>
              <p>Across the whole live library</p>
            </div>

            <label className="bulk-colour-field" htmlFor="bulk-source-colour">
              <span>Source</span>
              <span
                className="bulk-colour-dot"
                style={{ background: source?.swatch }}
                aria-hidden="true"
              />
              <select
                ref={sourceRef}
                id="bulk-source-colour"
                data-bulk-color="source"
                value={sourceColor}
                disabled={pending}
                onChange={(event) => {
                  setSourceColor(event.target.value);
                  setError('');
                }}
              >
                {palette.map((entry) => {
                  const count = counts.get(entry.key) ?? 0;
                  return (
                    <option key={entry.key} value={entry.key}>
                      {entry.label} — {count} live
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="bulk-colour-field" htmlFor="bulk-target-colour">
              <span>Target</span>
              <span
                className="bulk-colour-dot"
                style={{ background: target?.swatch }}
                aria-hidden="true"
              />
              <select
                id="bulk-target-colour"
                data-bulk-color="target"
                value={targetColor}
                disabled={pending}
                onChange={(event) => {
                  setTargetColor(event.target.value);
                  setError('');
                }}
              >
                {palette.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>

            <p className="bulk-colour-summary" data-bulk-color="summary" aria-live="polite">
              {summary}
            </p>
            {error && (
              <p className="bulk-colour-error" role="alert">
                {error}
              </p>
            )}

            <div className="bulk-popover-actions">
              <button type="button" disabled={pending} onClick={() => close()}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                data-bulk-color="confirm"
                disabled={!canConfirm}
                onClick={() => void confirm()}
              >
                {pending ? 'Replacing…' : `Replace${affected > 0 ? ` ${affected}` : ''}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

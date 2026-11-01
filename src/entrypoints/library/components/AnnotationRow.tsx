import { useMemo, useState } from 'react';
import { specFor } from '@/domain/colors';
import { highlightParts, type LibraryAnnotation, type LibraryPage } from '@/domain/library';
import type { CustomColor } from '@/domain/types';
import { markdownToHtml } from '@/lib/markdown';
import { requestBg } from '@/messaging/protocol';
import { useBlankSelection, useSelection } from './SelectionContext';
import { useNoteDraft } from './NoteDraftContext';

/** Text with the current search term marked. */
export function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.hit ? (
          <mark key={index}>{part.text}</mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function AnnotationRow({
  page,
  annotation,
  query,
  customColors,
}: {
  page: LibraryPage;
  annotation: LibraryAnnotation;
  query: string;
  customColors: CustomColor[];
}) {
  const [status, setStatus] = useState('');
  const notes = useNoteDraft(annotation.id);
  const draft = notes.draft;
  const editing = draft !== undefined;
  const selection = useSelection();
  const busy = selection.busy || (draft?.busy ?? false);
  const blankSelection = useBlankSelection(() => selection.toggle(annotation.id),
    '.annotation, .annotation > .body, .annotation > .body > .actions', busy);
  const swatch = specFor(annotation.color, customColors).swatch;
  const needle = query.trim().toLowerCase();
  const noteMatches = needle !== '' && annotation.note.toLowerCase().includes(needle);
  const noteHtml = useMemo(() => annotation.note ? markdownToHtml(annotation.note) : '', [annotation.note]);

  const open = async () => {
    setStatus('');
    const result = await requestBg({
      type: 'library:reveal',
      url: page.url,
      annotationId: annotation.id,
    });
    // Opening the tab but failing to reach the highlight is worth saying out
    // loud — silence would look like the click did nothing.
    if (result && result.ok && !result.revealed) {
      setStatus('Opened the page, but the highlight could not be located.');
    }
  };

  return (
    <li
      className={`annotation${annotation.detached ? ' detached' : ''}`}
      data-annotation-id={annotation.id}
      data-color={annotation.color}
      aria-busy={draft?.busy ?? false}
      data-selected={selection.enabled && selection.selectedIds.has(annotation.id) || undefined}
      {...blankSelection}
      onClick={(event) => { event.stopPropagation(); blankSelection.onClick(event); }}
    >
      {selection.enabled && (
        <input
          className="annotation-select"
          type="checkbox"
          aria-label={`Select annotation: ${annotation.quote || (annotation.isImage ? 'Figure' : 'Note')}`}
          checked={selection.selectedIds.has(annotation.id)}
          disabled={busy}
          onChange={() => selection.toggle(annotation.id)}
        />
      )}
      <span className="dot" style={{ background: swatch }} aria-hidden="true" />
      <div className="body">
        <button className="quote" disabled={busy} onClick={() => void open()} title="Open this page and scroll to it">
          {annotation.isImage && annotation.imageSrc ? (
            <img className="thumb" src={annotation.imageSrc} alt={annotation.quote || 'figure'} />
          ) : null}
          <Marked text={annotation.quote || (annotation.isImage ? 'Figure' : '')} query={query} />
        </button>

        {annotation.detached && <span className="badge detached-badge">detached</span>}
        {annotation.deleted && <span className="badge deleted-badge">deleted</span>}

        {!editing && annotation.note && (
          noteMatches ? (
            // The search hit is inside the note, so show the note as plain text
            // with the match marked. Rendering Markdown here would hide where
            // the hit is, and marking the rendered HTML would mean touching a
            // string that is only safe because nothing else edits it.
            <p className="note note-plain">
              <Marked text={annotation.note} query={query} />
            </p>
          ) : (
            <div
              className="note md"
              // Safe: markdownToHtml escapes all source text (see lib/markdown.ts).
              dangerouslySetInnerHTML={{ __html: noteHtml }}
            />
          )
        )}

        {draft ? (
          <div className="note-editor">
            <textarea
              value={draft.text}
              onChange={(event) => notes.change(annotation.id, event.target.value)}
              placeholder="Markdown supported"
              disabled={busy}
              autoFocus
            />
            <div className="row">
              <button disabled={busy} onClick={() => { notes.cancel(annotation.id); setStatus(''); }}>Cancel</button>
              <button className="primary" disabled={busy} onClick={() => { if (!busy) void notes.save(annotation.id); }}>{draft.busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          <div className="actions">
            {annotation.deleted ? (
              <button
                data-action="restore"
                disabled={busy}
                onClick={() => void requestBg({ type: 'annotation:undelete', id: annotation.id })}
              >
                Restore
              </button>
            ) : (
              <>
                <button data-action="edit" disabled={busy} onClick={() => {
                  setStatus('');
                  notes.begin(annotation);
                }}>
                  {annotation.note ? 'Edit note' : 'Add note'}
                </button>
                <button
                  className="danger"
                  data-action="delete"
                  disabled={busy}
                  onClick={() => void requestBg({ type: 'annotation:delete', id: annotation.id })}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
        {(draft?.status || status) && <p className="row-status" role="alert">{draft?.status || status}</p>}
      </div>
    </li>
  );
}

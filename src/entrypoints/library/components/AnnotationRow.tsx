import { useState } from 'react';
import { specFor } from '@/domain/colors';
import { highlightParts, type LibraryAnnotation, type LibraryPage } from '@/domain/library';
import type { CustomColor } from '@/domain/types';
import { markdownToHtml } from '@/lib/markdown';
import { requestBg } from '@/messaging/protocol';

/** Text with the current search term marked. */
function Marked({ text, query }: { text: string; query: string }) {
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.note);
  const [status, setStatus] = useState('');
  const swatch = specFor(annotation.color, customColors).swatch;
  const needle = query.trim().toLowerCase();
  const noteMatches = needle !== '' && annotation.note.toLowerCase().includes(needle);

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

  const saveNote = async () => {
    await requestBg({ type: 'annotation:set-comment', id: annotation.id, comment: draft.trim() });
    setEditing(false);
  };

  return (
    <li
      className={`annotation${annotation.detached ? ' detached' : ''}`}
      data-annotation-id={annotation.id}
      data-color={annotation.color}
    >
      <span className="dot" style={{ background: swatch }} aria-hidden="true" />
      <div className="body">
        <button className="quote" onClick={() => void open()} title="Open this page and scroll to it">
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
              dangerouslySetInnerHTML={{ __html: markdownToHtml(annotation.note) }}
            />
          )
        )}

        {editing ? (
          <div className="note-editor">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Markdown supported"
              autoFocus
            />
            <div className="row">
              <button onClick={() => { setDraft(annotation.note); setEditing(false); }}>Cancel</button>
              <button className="primary" onClick={() => void saveNote()}>Save</button>
            </div>
          </div>
        ) : (
          <div className="actions">
            {annotation.deleted ? (
              <button
                data-action="restore"
                onClick={() => void requestBg({ type: 'annotation:undelete', id: annotation.id })}
              >
                Restore
              </button>
            ) : (
              <>
                <button data-action="edit" onClick={() => setEditing(true)}>
                  {annotation.note ? 'Edit note' : 'Add note'}
                </button>
                <button
                  className="danger"
                  data-action="delete"
                  onClick={() => void requestBg({ type: 'annotation:delete', id: annotation.id })}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
        {status && <p className="row-status">{status}</p>}
      </div>
    </li>
  );
}

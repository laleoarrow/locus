import type { SummaryChange } from '@/domain/editing';
import { LibraryDialog } from './LibraryDialog';

export interface SummaryReviewEntry {
  sourceId: string;
  title: string;
  draft?: SummaryChange;
  error?: string;
  pending: boolean;
}

export function SummaryReview({ entries, generating, saving, error, onChange, onSave, onClose }: {
  entries: SummaryReviewEntry[]; generating: boolean; saving: boolean; error: string;
  onChange(sourceId: string, content: string): void; onSave(): void; onClose(): void;
}) {
  const ready = entries.filter((entry) => entry.draft).length;
  return (
    <LibraryDialog title="Review main content · 主要内容" onClose={onClose} busy={saving}>
      <p className="dialog-help">Each draft uses all live quotes and notes saved for that page. Edit before saving; existing main content is replaced only when you save.</p>
      <p role="status">{generating ? `Generating… ${entries.filter((entry) => !entry.pending).length} / ${entries.length}` : `${ready} draft${ready === 1 ? '' : 's'} ready`}</p>
      {generating && <p className="dialog-help">Closing stops the remaining pages. The current API request may still finish.</p>}
      <div className="summary-drafts">
        {entries.map((entry) => <section key={entry.sourceId} data-summary-draft={entry.sourceId}>
          <h3>{entry.title}</h3>
          {entry.pending && <p>Waiting for the model…</p>}
          {entry.error && <p role="alert" className="dialog-error">{entry.error}</p>}
          {entry.draft && <textarea rows={8} aria-label={`Main content: ${entry.title}`} value={entry.draft.content}
            disabled={saving} onChange={(event) => onChange(entry.sourceId, event.target.value)} />}
        </section>)}
      </div>
      {error && <p role="alert" className="dialog-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={saving} onClick={onClose}>{generating ? 'Close preview' : 'Cancel'}</button>
        <button type="button" className="primary" data-summary-review="save" disabled={generating || saving || ready === 0} onClick={onSave}>
          {saving ? 'Saving…' : `Save ${ready} ${ready === 1 ? 'page' : 'pages'}`}
        </button>
      </div>
    </LibraryDialog>
  );
}

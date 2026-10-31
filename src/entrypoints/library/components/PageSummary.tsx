import { createContext, useContext, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getPageSummary } from '@/db/editing';
import { markdownToHtml } from '@/lib/markdown';
import { requestBg } from '@/messaging/protocol';
import './notes.css';

export const SummaryActions = createContext({
  enabled: false, busy: false,
  generate: (_sourceIds: string[]) => {},
  configure: () => {},
});

export function PageSummary({ sourceId }: { sourceId: string }) {
  const summary = useLiveQuery(() => getPageSummary(sourceId), [sourceId]);
  const actions = useContext(SummaryActions);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const edit = () => {
    setDraft(summary?.content ?? ''); setExpectedUpdatedAt(summary?.updatedAt ?? 0);
    setEditing(true); setError('');
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const result = await requestBg({ type: 'summary:save', changes: [{ sourceId, content: draft.trim(), expectedUpdatedAt }] });
      if (!result || result.error) throw new Error(result?.error ?? 'Could not save main content.');
      setEditing(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save main content.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="page-summary" data-summary-source={sourceId} aria-label="主要内容">
      <div className="summary-heading">
        <h3>主要内容</h3>
        {!editing && <div className="summary-actions">
          <button type="button" data-summary="edit" disabled={actions.busy} onClick={edit}>{summary?.content ? 'Edit' : 'Add'}</button>
          <button type="button" data-summary="generate" disabled={actions.busy}
            onClick={() => actions.enabled ? actions.generate([sourceId]) : actions.configure()}>
            {actions.enabled ? 'Generate' : 'Set up LLM'}
          </button>
        </div>}
      </div>
      {editing ? <div>
        <textarea aria-label="Main content" data-summary="text" rows={5} value={draft} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} autoFocus />
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="primary" data-summary="save" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div> : summary?.content ? <div className="summary-content md" dangerouslySetInnerHTML={{ __html: markdownToHtml(summary.content) }} />
        : <p className="summary-empty">Add the main ideas from this page’s notes.</p>}
      {error && <p role="alert" className="dialog-error">{error}</p>}
    </section>
  );
}

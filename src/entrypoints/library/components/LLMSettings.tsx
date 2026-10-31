import { useState } from 'react';
import { DEFAULT_SUMMARY_PROMPT, type LLMConfigView } from '@/domain/llm';
import { requestBg } from '@/messaging/protocol';
import { LibraryDialog } from './LibraryDialog';

export function LLMSettings({ config, onSaved, onClose }: {
  config: LLMConfigView; onSaved(config: LLMConfigView): void; onClose(): void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [prompt, setPrompt] = useState(config.prompt);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      const result = await requestBg({ type: 'llm:save', patch: { enabled, baseUrl, model, prompt, apiKey, clearApiKey } });
      if (!result || result.error) throw new Error(result?.error ?? 'Could not save settings.');
      onSaved(result.config);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  };
  return (
    <LibraryDialog title="LLM settings" onClose={onClose} busy={busy}>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="llm-toggle">
          <input type="checkbox" data-llm="enabled" checked={enabled} disabled={busy}
            onChange={(event) => setEnabled(event.target.checked)} />
          Use an API to organise notes
        </label>
        <p className="dialog-help">Generation sends the page title, link, saved quotes and notes to your configured API only when you click Generate. Review and edit the draft before saving.</p>
        <fieldset disabled={busy} className="llm-fields">
          <label>API URL<input type="url" data-llm="url" value={baseUrl}
            placeholder="https://your-provider.example/v1" onChange={(event) => setBaseUrl(event.target.value)} /></label>
          <label>Model<input data-llm="model" value={model} placeholder="Model name from your provider"
            onChange={(event) => setModel(event.target.value)} /></label>
          <label>API key<input type="password" autoComplete="off" data-llm="key" value={apiKey}
            placeholder={config.hasApiKey && !clearApiKey ? 'Saved — leave blank to keep' : 'API key'}
            onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }} /></label>
          <div className="dialog-help">The key stays on this device and is excluded from backups and sync.
            {config.hasApiKey && <button type="button" className="text-action" data-llm="clear-key"
              onClick={() => { setClearApiKey(true); setApiKey(''); setEnabled(false); }}>Remove saved key</button>}
            {clearApiKey && <span> Key will be removed when you save.</span>}
          </div>
          <label>Default prompt<textarea rows={9} data-llm="prompt" value={prompt}
            onChange={(event) => setPrompt(event.target.value)} /></label>
          <button type="button" className="text-action" data-llm="reset-prompt" onClick={() => setPrompt(DEFAULT_SUMMARY_PROMPT)}>Reset default prompt</button>
        </fieldset>
        {error && <p role="alert" className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" data-llm="save" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      </form>
    </LibraryDialog>
  );
}

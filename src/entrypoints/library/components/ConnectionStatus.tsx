import { useCallback, useEffect, useRef, useState } from 'react';
import type { LLMConfigView } from '@/domain/llm';
import type { ConnectionState } from '@/domain/status';
import { normalizeCollectionUrl } from '@/domain/sync';
import { requestBg, type BgResponseMap } from '@/messaging/protocol';
import { LibraryDialog } from './LibraryDialog';
import './connection-status.css';

type Service = 'llm' | 'sync';
const labels = { untested: '待验证', testing: '检查中', success: '已验证', error: '连接失败' };

function displayState(configured: boolean, enabled: boolean, connection: ConnectionState) {
  if (!configured) return { label: '未配置', tone: 'muted' };
  if (connection.status === 'testing') return { label: labels.testing, tone: 'testing' };
  if (!enabled) return { label: '已关闭', tone: 'muted' };
  return { label: labels[connection.status], tone: connection.status };
}

function when(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ConnectionStatus({ disabled, onLLMConfig, onLLMSettings }: {
  disabled: boolean; onLLMConfig(config: LLMConfigView): void; onLLMSettings(): void;
}) {
  const [llm, setLLM] = useState<BgResponseMap['llm:status'] | null>(null);
  const [sync, setSync] = useState<BgResponseMap['sync:status'] | null>(null);
  const [open, setOpen] = useState(false);
  const [syncSettings, setSyncSettings] = useState(false);
  const [working, setWorking] = useState<Service | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const operationService = useRef<Service | null>(null);
  const loadRun = useRef(0);
  const load = useCallback(async () => {
    const run = ++loadRun.current;
    try {
      const [nextLLM, nextSync] = await Promise.all([
        requestBg({ type: 'llm:status' }), requestBg({ type: 'sync:status' }),
      ]);
      if (run !== loadRun.current) return;
      if (!nextLLM?.connection || !nextSync?.connection) throw new Error();
      setLLM(nextLLM); setSync(nextSync); onLLMConfig(nextLLM.config);
      setLoadError('');
    } catch { if (run === loadRun.current) setLoadError('暂时无法读取状态，请刷新页面重试。'); }
  }, [onLLMConfig]);
  useEffect(() => {
    void load();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      const keys = Object.keys(changes);
      if (operationService.current && keys.some((key) => key.startsWith(operationService.current === 'llm' ? 'locus.llm.' : 'sync.'))) setError('');
      if (keys.some((key) => key.startsWith('locus.llm.') || key.startsWith('sync.'))) void load();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { loadRun.current++; chrome.storage.onChanged.removeListener(changed); };
  }, [load]);

  const llmReady = !!(llm?.config.baseUrl && llm.config.model && llm.config.hasApiKey);
  const syncReady = !!(sync && normalizeCollectionUrl(sync.config.url) && sync.config.username.trim() && sync.config.hasPassword);
  const run = async (service: Service, syncNow = false) => {
    operationService.current = service;
    setWorking(service); setError('');
    try {
      const response = await requestBg(service === 'llm' ? { type: 'llm:test' } : { type: syncNow ? 'sync:now' : 'sync:test' });
      if (!response) throw new Error();
      const result = 'result' in response ? response.result : response;
      if (!result.ok && result.error !== response.connection.error) setError(result.error || '操作未完成，请重试。');
    } catch { setError('操作未完成，请重试。'); }
    finally { await load(); setWorking(null); }
  };
  const entries = [
    { service: 'llm' as const, name: 'LLM', data: llm, configured: llmReady },
    { service: 'sync' as const, name: '网盘同步', data: sync, configured: syncReady },
  ];
  return <>
    <div className="connection-chips" role="group" aria-label="连接状态">
      {entries.map(({ service, name, data, configured }) => {
        const state = data ? displayState(configured, data.config.enabled, data.connection) : { label: loadError ? '状态不可用' : '读取中', tone: 'muted' };
        return <button key={service} type="button" className="chip connection-chip" data-status={service}
          data-tone={state.tone} disabled={disabled} onClick={() => { setOpen(true); setSyncSettings(false); }}
          title={data?.connection.checkedAt ? `最近检查：${when(data.connection.checkedAt)}。点击查看详情。` : '点击查看配置、测试连接与同步状态'}>
          <span className="connection-light" aria-hidden="true" />{name}<span className="connection-chip-label">{state.label}</span>
        </button>;
      })}
    </div>
    {open && <LibraryDialog title="Connection status · 连接状态" onClose={() => setOpen(false)}>
      <p className="dialog-help">状态来自最近一次检查。填写配置后，请测试连接；验证成功不代表服务会一直在线。</p>
      <div className="connection-cards">
        {entries.map(({ service, name, data, configured }) => {
          if (!data) return null;
          const state = displayState(configured, data.config.enabled, data.connection);
          return <section key={service} data-status-section={service} className="connection-card">
            <div className="connection-card-heading"><h3>{name}</h3><span data-tone={state.tone} className="connection-badge"><span className="connection-light" aria-hidden="true" />{state.label}</span></div>
            {service === 'llm' ? <p className="connection-detail">{llm?.config.model || '尚未选择模型'}{llm?.config.baseUrl ? ` · ${llm.config.baseUrl}` : ''}</p>
              : <p className="connection-detail">{sync?.config.url || '尚未设置 WebDAV 网盘'}</p>}
            <p className="connection-check" aria-live="polite">最近检查：{data.connection.status === 'untested' ? '尚未验证' : `${labels[data.connection.status]}${data.connection.checkedAt ? ` · ${when(data.connection.checkedAt)}` : ''}`}</p>
            {data.connection.error && <p className="dialog-error" role="alert">{data.connection.error}</p>}
            {service === 'sync' && <p className="connection-check" data-status-sync="last-sync">最近同步：{sync?.state.lastSyncAt ? when(sync.state.lastSyncAt) : '尚未同步'}{sync?.state.lastError ? ' · 最近同步失败' : ''}</p>}
            <div className="dialog-actions connection-actions">
              <button type="button" data-status-action={`${service}-settings`} data-llm={service === 'llm' ? 'settings' : undefined}
                disabled={!!working} onClick={() => { if (service === 'llm') { setOpen(false); onLLMSettings(); } else setSyncSettings(!syncSettings); }}>设置</button>
              <button type="button" data-status-test={service} disabled={!!working || !configured || (service === 'llm' && !llm?.config.enabled)}
                onClick={() => void run(service)}>{working === service ? '检查中…' : '测试连接'}</button>
              {service === 'sync' && <button type="button" data-status-action="sync-now" disabled={!!working || !configured || !sync?.config.enabled}
                onClick={() => void run('sync', true)}>立即同步</button>}
            </div>
            <p className="dialog-help">{service === 'llm' ? '测试只发送一段示例文字，不发送你的笔记。请先保存配置并启用 API。' : '连接测试不等于同步完成；上方单独显示最近一次成功同步的时间。'}</p>
            {service === 'sync' && syncSettings && sync && <SyncSettings config={sync.config} onSaved={async () => { setSyncSettings(false); await load(); }} />}
          </section>;
        })}
      </div>
      {(error || loadError) && <p className="dialog-error" role="alert">{error || loadError}</p>}
      {working && <p className="dialog-help">检查在后台进行，关闭窗口后仍会更新状态。</p>}
      <p className="connection-footer">笔记保存在本机 · Locus {chrome.runtime.getManifest().version}</p>
    </LibraryDialog>}
  </>;
}

function SyncSettings({ config, onSaved }: { config: BgResponseMap['sync:status']['config']; onSaved(): Promise<void> }) {
  const [openedRevision] = useState(config.revision);
  const [enabled, setEnabled] = useState(config.enabled);
  const [url, setUrl] = useState(config.url);
  const [username, setUsername] = useState(config.username);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (url && !normalizeCollectionUrl(url)) { setError('请填写有效的 WebDAV 地址。'); return; }
    setBusy(true); setError('');
    try {
      const result = await requestBg({ type: 'sync:save', expectedRevision: openedRevision,
        patch: { enabled, url: url.trim(), username: username.trim(), ...(password ? { password } : {}) } });
      if (!result || result.error) { setError(result?.error || '无法保存网盘配置，请重试。'); return; }
      await onSaved();
    } catch { setError('无法保存网盘配置，请重试。'); }
    finally { setBusy(false); }
  };
  return <form className="connection-sync-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <fieldset className="llm-fields" disabled={busy}>
      <label className="connection-sync-toggle"><input type="checkbox" data-status-sync="enabled" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用网盘同步</label>
      <label>WebDAV 地址<input type="url" data-status-sync="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://dav.example.com/locus/" /></label>
      <label>账号<input autoComplete="off" data-status-sync="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label>应用密码<input type="password" autoComplete="off" data-status-sync="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={config.hasPassword ? '已保存，留空保留' : '使用网盘的应用密码'} /></label>
    </fieldset>
    <p className="dialog-help">更换网盘服务后，请重新填写该服务的应用密码。</p>
    {error && <p role="alert" className="dialog-error">{error}</p>}
    <div className="dialog-actions"><button type="submit" data-status-sync="save" disabled={busy}>{busy ? '保存中…' : '保存配置'}</button></div>
  </form>;
}

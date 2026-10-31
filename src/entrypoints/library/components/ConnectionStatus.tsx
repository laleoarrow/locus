import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LLMConfigView } from '@/domain/llm';
import type { ConnectionState } from '@/domain/status';
import { normalizeCollectionUrl, type SyncSchedule } from '@/domain/sync';
import { requestBg, type BgResponseMap } from '@/messaging/protocol';
import { LibraryDialog } from './LibraryDialog';
import './connection-status.css';

type Service = 'llm' | 'sync';
const labels = { untested: '待验证', testing: '检查中', success: '已验证', error: '连接失败' };
const scheduleLabels: Record<SyncSchedule, string> = { hourly: '每小时', daily: '每天', weekly: '每周', manual: '仅手动' };

function displayState(configured: boolean, enabled: boolean, connection: ConnectionState, quotaPaused = false) {
  if (!configured) return { label: '未配置', tone: 'muted' };
  if (connection.status === 'testing') return { label: labels.testing, tone: 'testing' };
  if (!enabled) return { label: '已关闭', tone: 'muted' };
  if (quotaPaused) return { label: '上传已暂停', tone: 'error' };
  return { label: labels[connection.status], tone: connection.status };
}

function when(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

/** A quiet label hint, kept inside the modal and above its scrolling surface. */
function StatusHelp({ name, title, points, children, className = '', tone, button }: {
  name: string; title: string; points: string[]; children: ReactNode; className?: string; tone?: string;
  button?: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-status-test'?: Service; 'data-status-action'?: string };
}) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const show = () => {
    clearTimeout(timer.current);
    anchor.current?.closest('dialog')?.querySelectorAll<HTMLElement>('.connection-help-tip:popover-open')
      .forEach((other) => { if (other !== tip.current) other.hidePopover(); });
    setOpen(true);
  };
  const hideSoon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!anchor.current?.matches(':hover, :focus') && !tip.current?.matches(':hover')) setOpen(false);
    }, 140);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const element = tip.current;
    if (!open || !element || !anchor.current) return;
    element.showPopover();
    const position = () => {
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0; const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth; const height = viewport?.height ?? window.innerHeight;
      element.style.maxWidth = `${Math.max(0, width - 24)}px`;
      element.style.maxHeight = `${Math.max(0, height - 24)}px`;
      const target = anchor.current!.getBoundingClientRect(); const box = element.getBoundingClientRect();
      const below = target.bottom + 8;
      const top = below + box.height <= y + height - 12 ? below : target.top - box.height - 8;
      element.style.left = `${Math.max(x + 12, Math.min(target.left, x + width - box.width - 12))}px`;
      element.style.top = `${Math.max(y + 12, Math.min(top, y + height - box.height - 12))}px`;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); clearTimeout(timer.current); setOpen(false);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor.current); observer.observe(element);
    const dialog = anchor.current.closest('dialog');
    if (dialog) {
      observer.observe(dialog);
      dialog.querySelectorAll('.connection-card').forEach((card) => observer.observe(card));
    }
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    document.addEventListener('keydown', escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      document.removeEventListener('keydown', escape, true);
      if (element.isConnected && element.matches(':popover-open')) element.hidePopover();
    };
  }, [open]);
  const trigger = {
    ref: (element: HTMLElement | null) => { anchor.current = element; },
    'data-status-help': name, 'data-tone': tone, 'aria-describedby': open ? id : undefined,
    className: `connection-help-trigger ${className}`, onMouseEnter: show, onMouseLeave: hideSoon,
    onFocus: show, onBlur: hideSoon,
  };
  const dialog = anchor.current?.closest('dialog');
  return <>
    {button ? <button {...button} {...trigger} disabled={undefined} aria-disabled={button.disabled || undefined}
      onClick={(event) => { if (button.disabled) event.preventDefault(); else button.onClick?.(event); }}>{children}</button>
      : <span tabIndex={0} {...trigger}>{children}</span>}
    {open && dialog && createPortal(<div ref={tip} id={id} role="tooltip" popover="manual"
      data-status-help-content={name} className="connection-help-tip" onMouseEnter={show} onMouseLeave={hideSoon}
      onToggle={(event) => { if (event.newState === 'closed') setOpen(false); }}>
      <strong>{title}</strong><ul>{points.map((point) => <li key={point}>{point}</li>)}</ul>
    </div>, dialog)}
  </>;
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
        const state = data ? displayState(configured, data.config.enabled, data.connection, service === 'sync' && sync?.state.autoPaused === 'quota') : { label: loadError ? '状态不可用' : '读取中', tone: 'muted' };
        return <button key={service} type="button" className="chip connection-chip" data-status={service}
          data-tone={state.tone} disabled={disabled} onClick={() => { setOpen(true); setSyncSettings(false); }}
          title={data?.connection.checkedAt ? `最近检查：${when(data.connection.checkedAt)}。点击查看详情。` : '点击查看配置、测试连接与同步状态'}>
          <span className="connection-light" aria-hidden="true" />{name}<span className="connection-chip-label">{state.label}</span>
        </button>;
      })}
    </div>
    {open && <LibraryDialog title="Connection status · 连接状态" onClose={() => setOpen(false)}>
      <div className="connection-cards">
        {entries.map(({ service, name, data, configured }) => {
          if (!data) return null;
          const state = displayState(configured, data.config.enabled, data.connection, service === 'sync' && sync?.state.autoPaused === 'quota');
          return <section key={service} data-status-section={service} className="connection-card">
            <div className="connection-card-heading"><h3>{name}</h3><StatusHelp name={`${service}-state`} title="连接状态"
              points={['填写配置后，请测试连接。', '已验证表示最近一次检查成功，不保证服务持续在线。']}
              tone={state.tone} className="connection-badge"><span className="connection-light" aria-hidden="true" />{state.label}</StatusHelp></div>
            {service === 'llm' ? <p className="connection-detail">{llm?.config.model || '尚未选择模型'}{llm?.config.baseUrl ? ` · ${llm.config.baseUrl}` : ''}</p>
              : <p className="connection-detail">{sync?.config.url || '尚未设置 WebDAV 网盘'}</p>}
            <p className="connection-check" aria-live="polite"><StatusHelp name={`${service}-checked`} title="最近检查"
              points={['记录最近一次连接测试或实际调用的结果。', '检查在后台进行，关闭窗口后仍会更新。']}>最近检查</StatusHelp>：{data.connection.status === 'untested' ? '尚未验证' : `${labels[data.connection.status]}${data.connection.checkedAt ? ` · ${when(data.connection.checkedAt)}` : ''}`}</p>
            {data.connection.error && <p className="dialog-error" role="alert">{data.connection.error}</p>}
            {service === 'sync' && <p className="connection-check" data-status-sync="last-sync"><StatusHelp name="sync-last-sync" title="最近同步"
              points={['只有完整同步成功才更新时间。', '连接测试不会推进这个时间。']}>最近同步</StatusHelp>：{sync?.state.lastSyncAt ? when(sync.state.lastSyncAt) : '尚未同步'}{sync?.state.lastError ? ' · 最近同步失败' : ''}</p>}
            {service === 'sync' && sync && <p className="connection-check" data-status-sync="schedule-status">
              <StatusHelp name="sync-schedule" title="同步计划"
                points={['按选定的间隔同步，编辑笔记不会立即上传。', '浏览器关闭或休眠时，计划在恢复后执行。', '全量同步可随时手动核对全部笔记，仅上传差异。']}>同步计划</StatusHelp>：{scheduleLabels[sync.config.schedule]}
              <span data-status-sync="next-sync"> · {!sync.config.enabled ? '未启用' : sync.state.autoPaused === 'quota' ? '已暂停'
                : sync.config.schedule === 'manual' ? '按需同步' : sync.state.nextSyncAt ? `下次 ${when(sync.state.nextSyncAt)}` : '待安排'}</span>
            </p>}
            {service === 'sync' && sync?.state.lastUploadBytes !== undefined && <p className="connection-check" data-status-sync="upload-bytes">
              <StatusHelp name="sync-upload" title="上次同步发送"
                points={['统计请求正文大小，包含失败尝试。', '没有变化时无需上传。', '实际扣除的额度以网盘账户页为准。']}>上次同步发送</StatusHelp>：{bytes(sync.state.lastUploadBytes)}{sync.state.lastUploadBytes === 0 ? ' · 无需上传' : ` · ${sync.state.lastChangedPages ?? 0} 个页面有变化`}
            </p>}
            {service === 'sync' && sync?.state.autoPaused === 'quota' && <p className="dialog-error">上传额度不足，已停止自动重试。额度恢复后可点击“全量同步”。</p>}
            <div className="dialog-actions connection-actions">
              <button type="button" data-status-action={`${service}-settings`} data-llm={service === 'llm' ? 'settings' : undefined}
                disabled={!!working} onClick={() => { if (service === 'llm') { setOpen(false); onLLMSettings(); } else setSyncSettings(!syncSettings); }}>设置</button>
              <StatusHelp name={`${service}-test`} title={service === 'llm' ? '测试 LLM 连接' : '测试网盘连接'}
                points={service === 'llm' ? ['只发送一段示例文字，不发送你的笔记。', '请先保存配置并启用 API。']
                  : ['检查网盘是否可读取，不上传笔记。', '测试成功不等于同步完成；同步时间单独显示。']}
                button={{ type: 'button', 'data-status-test': service, disabled: !!working || !configured || (service === 'llm' && !llm?.config.enabled),
                  onClick: () => void run(service) }}>{working === service ? '检查中…' : '测试连接'}</StatusHelp>
              {service === 'sync' && <StatusHelp name="sync-full" title="全量同步"
                points={['立即核对本机与网盘的全部笔记。', '仅上传有变化的页面和索引；相同内容不重复上传。']}
                button={{ type: 'button', 'data-status-action': 'sync-now', disabled: !!working || !configured || !sync?.config.enabled,
                  onClick: () => void run('sync', true) }}>全量同步</StatusHelp>}
            </div>
            {service === 'sync' && syncSettings && sync && <SyncSettings config={sync.config} onSaved={async () => { setSyncSettings(false); await load(); }} />}
          </section>;
        })}
      </div>
      {(error || loadError) && <p className="dialog-error" role="alert">{error || loadError}</p>}
      <p className="connection-footer">笔记保存在本机 · Locus {chrome.runtime.getManifest().version}</p>
    </LibraryDialog>}
  </>;
}

function SyncSettings({ config, onSaved }: { config: BgResponseMap['sync:status']['config']; onSaved(): Promise<void> }) {
  const [openedRevision] = useState(config.revision);
  const [enabled, setEnabled] = useState(config.enabled);
  const [schedule, setSchedule] = useState(config.schedule);
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
        patch: { enabled, schedule, url: url.trim(), username: username.trim(), ...(password ? { password } : {}) } });
      if (!result || result.error) { setError(result?.error || '无法保存网盘配置，请重试。'); return; }
      await onSaved();
    } catch { setError('无法保存网盘配置，请重试。'); }
    finally { setBusy(false); }
  };
  return <form className="connection-sync-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <fieldset className="llm-fields" disabled={busy}>
      <label className="connection-sync-toggle"><input type="checkbox" data-status-sync="enabled" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用网盘同步</label>
      <label>同步频率<select data-status-sync="schedule" value={schedule} onChange={(event) => setSchedule(event.target.value as SyncSchedule)}>
        {Object.entries(scheduleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>WebDAV 地址<input type="url" data-status-sync="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://dav.example.com/locus/" /></label>
      <label>账号<input autoComplete="off" data-status-sync="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label><StatusHelp name="sync-password" title="应用密码"
        points={['使用网盘提供的应用密码。', '更换网盘服务后，请重新填写该服务的应用密码。']}>应用密码</StatusHelp><input type="password" autoComplete="off" data-status-sync="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={config.hasPassword ? '已保存，留空保留' : '使用网盘的应用密码'} /></label>
    </fieldset>
    {error && <p role="alert" className="dialog-error">{error}</p>}
    <div className="dialog-actions"><button type="submit" data-status-sync="save" disabled={busy}>{busy ? '保存中…' : '保存配置'}</button></div>
  </form>;
}

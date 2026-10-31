import {
  DEFAULT_LLM_CONFIG,
  LLMError,
  normalizeLLMBaseUrl,
  validateLLMConfig,
  type LLMConfig,
  type LLMConfigPatch,
  type LLMConfigView,
} from '@/domain/llm';
import { connectionView, EMPTY_CONNECTION_STATE, type ConnectionAttempt, type ConnectionState, type StoredConnection } from '@/domain/status';

/** Kept outside Dexie so API credentials never enter backups or WebDAV sync. */
const CONFIG_KEY = 'locus.llm.config';
const CONNECTION_KEY = 'locus.llm.connection';
const CONNECTION_SESSION_ID = crypto.randomUUID();
let saveQueue: Promise<unknown> = Promise.resolve();

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const pending = saveQueue.then(operation);
  saveQueue = pending.catch(() => undefined);
  return pending;
}

export async function getLLMConfig(): Promise<LLMConfig> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const value = stored[CONFIG_KEY] as Partial<LLMConfig> | undefined;
  return {
    enabled: value?.enabled === true,
    baseUrl: typeof value?.baseUrl === 'string' ? value.baseUrl : '',
    model: typeof value?.model === 'string' ? value.model : '',
    prompt: typeof value?.prompt === 'string' ? value.prompt : DEFAULT_LLM_CONFIG.prompt,
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey : '',
    revision: typeof value?.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0
      ? value.revision : 0,
  };
}

function view(config: LLMConfig): LLMConfigView {
  const { apiKey, ...publicConfig } = config;
  return { ...publicConfig, hasApiKey: apiKey !== '' };
}

export async function getLLMConfigView(): Promise<LLMConfigView> {
  return view(await getLLMConfig());
}

export async function getLLMConnection(): Promise<ConnectionState> {
  const config = await getLLMConfig();
  const stored = await chrome.storage.local.get(CONNECTION_KEY);
  return connectionView(stored[CONNECTION_KEY] as StoredConnection | undefined, config.revision, CONNECTION_SESSION_ID);
}

/** Generation keeps the prior result while pending; explicit tests show Testing. */
export function beginLLMConnection(revision: number, testing = true): Promise<ConnectionAttempt | null> {
  return serial(async () => {
    if ((await getLLMConfig()).revision !== revision) return null;
    const previous = await getLLMConnection();
    const attempt = { revision, id: crypto.randomUUID() };
    await chrome.storage.local.set({ [CONNECTION_KEY]: {
      ...previous, ...attempt, sessionId: CONNECTION_SESSION_ID, ...(testing ? { status: 'testing', error: '' } : {}),
    } satisfies StoredConnection });
    return attempt;
  });
}

export function finishLLMConnection(attempt: ConnectionAttempt, ok: boolean, error = ''): Promise<boolean> {
  return serial(async () => {
    if ((await getLLMConfig()).revision !== attempt.revision) return false;
    const stored = await chrome.storage.local.get(CONNECTION_KEY);
    if ((stored[CONNECTION_KEY] as StoredConnection | undefined)?.id !== attempt.id) return false;
    await chrome.storage.local.set({ [CONNECTION_KEY]: {
      ...attempt, sessionId: CONNECTION_SESSION_ID, status: ok ? 'success' : 'error', checkedAt: Date.now(), error: ok ? '' : error,
    } satisfies StoredConnection });
    return true;
  });
}

async function save(patch: LLMConfigPatch): Promise<LLMConfigView> {
  for (const field of ['baseUrl', 'model', 'prompt', 'apiKey'] as const) {
    if (patch[field] !== undefined && typeof patch[field] !== 'string') {
      throw new LLMError('AI 设置格式无效。');
    }
  }
  for (const field of ['enabled', 'clearApiKey'] as const) {
    if (patch[field] !== undefined && typeof patch[field] !== 'boolean') {
      throw new LLMError('AI 设置格式无效。');
    }
  }
  const current = await getLLMConfig();
  const baseUrl = normalizeLLMBaseUrl(patch.baseUrl ?? current.baseUrl);
  const currentOrigin = current.baseUrl ? new URL(current.baseUrl).origin : '';
  const nextOrigin = baseUrl ? new URL(baseUrl).origin : '';
  const originChanged = currentOrigin !== nextOrigin;
  const typedKey = patch.apiKey?.trim() ?? '';
  const next: LLMConfig = {
    enabled: patch.enabled ?? (patch.clearApiKey ? false : current.enabled),
    baseUrl,
    model: (patch.model ?? current.model).trim(),
    prompt: (patch.prompt ?? current.prompt).trim(),
    apiKey: patch.clearApiKey ? '' : typedKey || (originChanged ? '' : current.apiKey),
    revision: current.revision + 1,
  };
  validateLLMConfig(next);
  await chrome.storage.local.set({ [CONFIG_KEY]: next, [CONNECTION_KEY]: {
    ...EMPTY_CONNECTION_STATE, revision: next.revision, id: '', sessionId: CONNECTION_SESSION_ID,
  } satisfies StoredConnection });
  return view(next);
}

/** Blank keys preserve the saved key; only an explicit clear or new origin removes it. */
export function saveLLMConfig(patch: LLMConfigPatch): Promise<LLMConfigView> {
  // Serial writes preserve independent changes from the library and side panel.
  return serial(() => save(patch));
}

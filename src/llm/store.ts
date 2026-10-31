import {
  DEFAULT_LLM_CONFIG,
  LLMError,
  normalizeLLMBaseUrl,
  validateLLMConfig,
  type LLMConfig,
  type LLMConfigPatch,
  type LLMConfigView,
} from '@/domain/llm';

/** Kept outside Dexie so API credentials never enter backups or WebDAV sync. */
const CONFIG_KEY = 'locus.llm.config';
let saveQueue: Promise<unknown> = Promise.resolve();

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
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return view(next);
}

/** Blank keys preserve the saved key; only an explicit clear or new origin removes it. */
export function saveLLMConfig(patch: LLMConfigPatch): Promise<LLMConfigView> {
  // Serial writes preserve independent changes from the library and side panel.
  const saved = saveQueue.then(() => save(patch));
  saveQueue = saved.catch(() => undefined);
  return saved;
}

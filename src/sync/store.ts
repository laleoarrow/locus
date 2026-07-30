import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  EMPTY_SYNC_CONFIG,
  EMPTY_SYNC_STATE,
  type SyncConfig,
  type SyncState,
} from '@/domain/sync';

/**
 * Sync credentials live in chrome.storage.local, never in the Dexie settings
 * table — that keeps them structurally out of backup exports, which are files
 * users move between machines and may share.
 */
const CONFIG_KEY = 'sync.config';
const STATE_KEY = 'sync.state';

/** What the UI is allowed to see: everything except the password itself. */
export type SyncConfigView = Omit<SyncConfig, 'password'> & { hasPassword: boolean };

export async function getSyncConfig(): Promise<SyncConfig> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const value = stored[CONFIG_KEY] as Partial<SyncConfig> | undefined;
  return {
    enabled: value?.enabled ?? EMPTY_SYNC_CONFIG.enabled,
    url: value?.url ?? '',
    username: value?.username ?? '',
    password: value?.password ?? '',
    intervalMinutes:
      typeof value?.intervalMinutes === 'number' && value.intervalMinutes >= 1
        ? value.intervalMinutes
        : DEFAULT_SYNC_INTERVAL_MINUTES,
  };
}

export function toConfigView(config: SyncConfig): SyncConfigView {
  const { password, ...rest } = config;
  return { ...rest, hasPassword: password !== '' };
}

/** Patch the config; an omitted password keeps the stored one. */
export async function setSyncConfig(patch: Partial<SyncConfig>): Promise<SyncConfig> {
  const current = await getSyncConfig();
  const next: SyncConfig = { ...current, ...patch };
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

export async function getSyncState(): Promise<SyncState> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return { ...EMPTY_SYNC_STATE, ...((stored[STATE_KEY] as Partial<SyncState> | undefined) ?? {}) };
}

export async function setSyncState(state: SyncState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

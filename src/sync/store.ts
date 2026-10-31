import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  EMPTY_SYNC_CONFIG,
  EMPTY_SYNC_STATE,
  normalizeCollectionUrl,
  type SyncConfig,
  type SyncState,
} from '@/domain/sync';
import { connectionView, EMPTY_CONNECTION_STATE, type ConnectionAttempt, type ConnectionState, type StoredConnection } from '@/domain/status';

/**
 * Sync credentials live in chrome.storage.local, never in the Dexie settings
 * table — that keeps them structurally out of backup exports, which are files
 * users move between machines and may share.
 */
const CONFIG_KEY = 'sync.config';
const STATE_KEY = 'sync.state';
const CONNECTION_KEY = 'sync.connection';
const CONNECTION_SESSION_ID = crypto.randomUUID();
let saveQueue: Promise<unknown> = Promise.resolve();

type SyncConfigSnapshot = SyncConfig & { revision: number };

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const pending = saveQueue.then(operation);
  saveQueue = pending.catch(() => undefined);
  return pending;
}

/** What the UI is allowed to see: everything except the password itself. */
export type SyncConfigView = Omit<SyncConfig, 'password'> & { hasPassword: boolean; revision: number };

export async function getSyncConfig(): Promise<SyncConfigSnapshot> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const value = stored[CONFIG_KEY] as Partial<SyncConfigSnapshot> | undefined;
  return {
    enabled: value?.enabled ?? EMPTY_SYNC_CONFIG.enabled,
    url: value?.url ?? '',
    username: value?.username ?? '',
    password: value?.password ?? '',
    intervalMinutes:
      typeof value?.intervalMinutes === 'number' && value.intervalMinutes >= 1
        ? value.intervalMinutes
        : DEFAULT_SYNC_INTERVAL_MINUTES,
    revision: typeof value?.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0
      ? value.revision : 0,
  };
}

export function toConfigView(config: SyncConfigSnapshot): SyncConfigView {
  const { enabled, url, username, intervalMinutes, password, revision } = config;
  return { enabled, url, username, intervalMinutes, hasPassword: password !== '', revision };
}

/** Patch the config; an omitted password keeps the stored one. */
export function setSyncConfig(patch: Partial<SyncConfig>, expectedRevision?: number): Promise<SyncConfigSnapshot> {
  return serial(async () => {
    const current = await getSyncConfig();
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new Error('Sync settings changed in another window. Reopen settings and try again.');
    }
    const next: SyncConfigSnapshot = { ...current, ...patch, revision: current.revision + 1 };
    const oldBase = normalizeCollectionUrl(current.url);
    const nextBase = normalizeCollectionUrl(next.url);
    if ((oldBase ? new URL(oldBase).origin : '') !== (nextBase ? new URL(nextBase).origin : '') &&
      patch.password === undefined) next.password = '';
    // Side-panel blur handlers may save a field again while Test is starting.
    // An unchanged configuration must not invalidate that in-flight check.
    if ((['enabled', 'url', 'username', 'password', 'intervalMinutes'] as const)
      .every((field) => next[field] === current[field])) return current;
    const destinationChanged = (normalizeCollectionUrl(current.url) ?? current.url.trim()) !==
      (normalizeCollectionUrl(next.url) ?? next.url.trim()) ||
      current.username !== next.username || current.password !== next.password;
    await chrome.storage.local.set({
      [CONFIG_KEY]: next,
      [CONNECTION_KEY]: { ...EMPTY_CONNECTION_STATE, revision: next.revision, id: '', sessionId: CONNECTION_SESSION_ID } satisfies StoredConnection,
      ...(destinationChanged ? { [STATE_KEY]: { ...EMPTY_SYNC_STATE } } : {}),
    });
    return next;
  });
}

export async function getSyncState(): Promise<SyncState> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return { ...EMPTY_SYNC_STATE, ...((stored[STATE_KEY] as Partial<SyncState> | undefined) ?? {}) };
}

export async function setSyncState(state: SyncState): Promise<void> {
  await serial(() => chrome.storage.local.set({ [STATE_KEY]: state }));
}

export async function getSyncConnection(): Promise<ConnectionState> {
  const config = await getSyncConfig();
  const stored = await chrome.storage.local.get(CONNECTION_KEY);
  return connectionView(stored[CONNECTION_KEY] as StoredConnection | undefined, config.revision, CONNECTION_SESSION_ID);
}

export function beginSyncConnection(revision: number, testing = true): Promise<ConnectionAttempt | null> {
  return serial(async () => {
    if ((await getSyncConfig()).revision !== revision) return null;
    const previous = await getSyncConnection();
    const attempt = { revision, id: crypto.randomUUID() };
    await chrome.storage.local.set({ [CONNECTION_KEY]: {
      ...previous, ...attempt, sessionId: CONNECTION_SESSION_ID, ...(testing ? { status: 'testing', error: '' } : {}),
    } satisfies StoredConnection });
    return attempt;
  });
}

/** Tests never pass sync state; only a real sync may advance lastSyncAt. */
export function finishSyncConnection(
  attempt: ConnectionAttempt, ok: boolean, error = '', state?: SyncState,
): Promise<boolean> {
  return serial(async () => {
    if ((await getSyncConfig()).revision !== attempt.revision) return false;
    const stored = await chrome.storage.local.get(CONNECTION_KEY);
    const latest = (stored[CONNECTION_KEY] as StoredConnection | undefined)?.id === attempt.id;
    await chrome.storage.local.set({
      ...(state ? { [STATE_KEY]: state } : {}),
      ...(latest ? { [CONNECTION_KEY]: {
        ...attempt, sessionId: CONNECTION_SESSION_ID, status: ok ? 'success' : 'error', checkedAt: Date.now(), error: ok ? '' : error,
      } satisfies StoredConnection } : {}),
    });
    return latest;
  });
}

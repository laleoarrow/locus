/**
 * WebDAV sync configuration and state (pure — no chrome.*, no fetch).
 *
 * Credentials deliberately live in chrome.storage.local rather than the Dexie
 * settings table, so they can never be swept into a backup export file.
 */

export interface SyncConfig {
  enabled: boolean;
  /** Collection URL, e.g. https://dav.jianguoyun.com/dav/locus/ */
  url: string;
  username: string;
  /** WebDAV app password. Providers like Jianguoyun require one. */
  password: string;
  intervalMinutes: number;
}

export interface SyncState {
  lastSyncAt: number;
  lastError: string;
  /** ETag of the remote file as of the last successful push. */
  etag: string;
}

export const LIBRARY_FILE = 'locus-library.json';
export const DEFAULT_SYNC_INTERVAL_MINUTES = 5;

export const EMPTY_SYNC_CONFIG: SyncConfig = {
  enabled: false,
  url: '',
  username: '',
  password: '',
  intervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
};

export const EMPTY_SYNC_STATE: SyncState = { lastSyncAt: 0, lastError: '', etag: '' };

/**
 * Normalize a user-typed collection URL: trims, adds the trailing slash WebDAV
 * collections need, and rejects anything that is not http(s). Returns null when
 * the input cannot be used.
 */
export function normalizeCollectionUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

export function isConfigComplete(config: SyncConfig): boolean {
  return (
    normalizeCollectionUrl(config.url) !== null &&
    config.username.trim() !== '' &&
    config.password !== ''
  );
}

/** Basic-auth value that survives non-ASCII credentials (btoa is Latin-1 only). */
export function basicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function describeSyncError(status: number): string {
  if (status === 401 || status === 403) return 'Sign-in rejected — check the username and app password.';
  if (status === 404) return 'Folder not found — check the WebDAV address.';
  if (status === 507 || status === 413) return 'The server refused the upload (out of space?).';
  if (status >= 500) return `Server error (${status}). Will retry.`;
  return `Sync failed (${status}).`;
}

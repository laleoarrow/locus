import * as repo from '@/db/repo';
import { parseBackup } from '@/domain/backup';
import {
  isConfigComplete,
  LIBRARY_FILE,
  normalizeCollectionUrl,
  type SyncConfig,
  type SyncState,
} from '@/domain/sync';
import { WebDavClient, WebDavError } from '@/lib/webdav';

export interface SyncResult {
  ok: boolean;
  /** Annotations pulled in from the remote copy this run. */
  pulled: number;
  /** Portable settings inserted or extended from the remote copy this run. */
  settingsPulled: number;
  /** True when the local library was pushed. */
  pushed: boolean;
  error: string;
}

/** How many times to redo pull→merge→push when another device wins the race. */
const MAX_ATTEMPTS = 3;

/**
 * One sync pass: pull the remote library, merge it into the local one, then
 * push the merged result back under an If-Match guard.
 *
 * Correctness rests on `repo.importBackup` being a convergent merge (rows
 * merged by id, newer `updatedAt` wins for notes/deletions, and colour has an
 * independent conflict clock), so whichever device syncs last ends up with
 * the union of both — and a device that syncs twice reaches the same state as
 * one that synced once.
 */
export async function runSync(
  config: SyncConfig,
  state: SyncState,
  appVersion: string,
): Promise<{ result: SyncResult; state: SyncState }> {
  const base = normalizeCollectionUrl(config.url);
  if (!base || !isConfigComplete(config)) {
    return {
      result: {
        ok: false,
        pulled: 0,
        settingsPulled: 0,
        pushed: false,
        error: 'Sync is not configured.',
      },
      state,
    };
  }

  const client = new WebDavClient(config, base);
  let lastError = 'Sync failed.';
  let pulled = 0;
  let settingsPulled = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt === 1) await client.ensureCollection();

      const remote = await client.get(LIBRARY_FILE);
      if (remote) {
        const parsed = parseBackup(JSON.parse(remote.body));
        if ('error' in parsed) {
          // A corrupt or foreign file must not be silently overwritten.
          return {
            result: {
              ok: false,
              pulled,
              settingsPulled,
              pushed: false,
              error: `Remote file rejected: ${parsed.error}`,
            },
            state: { ...state, lastError: parsed.error },
          };
        }
        const summary = await repo.importBackup(parsed.file);
        pulled += summary.annotationsAdded + summary.annotationsUpdated;
        settingsPulled += summary.settingsUpdated;
      }

      const merged = await repo.exportBackup(appVersion);
      const etag = await client.put(
        LIBRARY_FILE,
        JSON.stringify(merged),
        remote ? { replaces: remote.etag || '*' } : 'absent',
      );

      const now = Date.now();
      return {
        result: { ok: true, pulled, settingsPulled, pushed: true, error: '' },
        state: { lastSyncAt: now, lastError: '', etag },
      };
    } catch (error) {
      if (error instanceof WebDavError) {
        lastError = error.message;
        // 412: another device pushed between our GET and PUT — merge again.
        if (error.status === 412 && attempt < MAX_ATTEMPTS) continue;
      } else if (error instanceof SyntaxError) {
        lastError = 'Remote file is not valid JSON.';
      } else if (error instanceof Error) {
        lastError = error.message || 'Network error.';
      }
      break;
    }
  }

  return {
    result: { ok: false, pulled, settingsPulled, pushed: false, error: lastError },
    state: { ...state, lastError },
  };
}

/** Credential check for the settings UI: can we reach the collection at all? */
export async function testConnection(config: SyncConfig): Promise<{ ok: boolean; error: string }> {
  const base = normalizeCollectionUrl(config.url);
  if (!base) return { ok: false, error: 'That does not look like a WebDAV address.' };
  if (!isConfigComplete(config)) return { ok: false, error: 'Fill in the address, username and password.' };
  try {
    const client = new WebDavClient(config, base);
    await client.ensureCollection();
    await client.get(LIBRARY_FILE);
    return { ok: true, error: '' };
  } catch (error) {
    if (error instanceof WebDavError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : 'Could not reach the server.' };
  }
}

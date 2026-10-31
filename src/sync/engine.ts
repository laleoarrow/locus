import * as repo from '@/db/repo';
import { cacheBlob, cacheRoot, getCachedBlob, getCachedRoot, preserveLegacyRoot, syncCacheScope } from '@/db/syncCache';
import { parseBackup, type BackupFile } from '@/domain/backup';
import {
  blobPath, byteLength, contentHash, MAX_SYNC_BLOB_BYTES, MAX_SYNC_ROOT_BYTES,
  mergeProjections, parseManifest, projectBackup, projectionBackup, stableJSON,
  SYNC_DIRECTORY, SyncDataError, validateBlob, type SyncManifest, type SyncProjection,
} from '@/domain/syncFormat';
import { isConfigComplete, LIBRARY_FILE, normalizeCollectionUrl, type SyncConfig, type SyncState } from '@/domain/sync';
import { WebDavClient, WebDavError } from '@/lib/webdav';

export interface SyncResult {
  ok: boolean;
  pulled: number;
  settingsPulled: number;
  pushed: boolean;
  error: string;
  uploadedBytes?: number;
  changedPages?: number;
}

const MAX_ATTEMPTS = 3;
class SyncSupersededError extends Error {}
function strongEtag(etag: string): boolean { return etag.trim() !== '' && etag.trim() !== '*' && !/^W\//i.test(etag.trim()); }

interface RemoteSnapshot {
  projection: SyncProjection;
  manifest?: SyncManifest;
  etag: string;
  exists: boolean;
  body?: string;
}
interface EncodedBlob { hash: string; body: string; kind: 'page' | 'settings'; urlKey?: string }

async function encode(file: BackupFile, kind: 'page' | 'settings', urlKey?: string): Promise<EncodedBlob> {
  const body = stableJSON(file);
  if (byteLength(body) > MAX_SYNC_BLOB_BYTES) throw new SyncDataError('A page is too large to sync safely.');
  const hash = await contentHash(body);
  await validateBlob(body, hash, kind, urlKey);
  return { hash, body, kind, urlKey };
}

/** Read all referenced content before importing or publishing any new index. */
async function readSnapshot(client: WebDavClient, scope: string, ensureCurrent: () => Promise<void>, fullScan: boolean): Promise<RemoteSnapshot> {
  const cached = fullScan ? undefined : await getCachedRoot(scope);
  const result = await client.read(LIBRARY_FILE, cached?.etag || undefined);
  await ensureCurrent();
  if (result.kind === 'missing') return {
    projection: await projectBackup({ format: 'locus-backup', formatVersion: 3, appVersion: '', exportedAt: 0,
      documents: [], sources: [], annotations: [], anchors: [], settings: [] }), etag: '', exists: false,
  };
  if (result.kind === 'not-modified' && !cached) throw new SyncDataError('The sync index could not be verified.');
  const body = result.kind === 'file' ? result.body : cached!.body;
  const etag = result.kind === 'file' ? result.etag : result.etag || cached?.etag || '';
  if (byteLength(body) > MAX_SYNC_ROOT_BYTES) throw new SyncDataError('Sync index is too large.');
  const raw = JSON.parse(body) as { formatVersion?: number };
  if (raw.formatVersion !== 4) {
    const parsed = parseBackup(raw);
    if ('error' in parsed) throw new SyncDataError('Remote backup is invalid or needs a newer Locus.');
    // Preserve the exact old file locally before the migration can publish v4.
    await preserveLegacyRoot(scope, body);
    return { projection: await projectBackup(parsed.file), etag, exists: true, body };
  }
  const manifest = parseManifest(body);
  const readBlob = async (kind: 'page' | 'settings', hash: string, urlKey?: string): Promise<BackupFile> => {
    let blob = fullScan ? undefined : await getCachedBlob(hash);
    if (blob === undefined) {
      const remote = await client.read(blobPath(kind, hash));
      await ensureCurrent();
      if (remote.kind !== 'file') throw new SyncDataError('A referenced sync file is missing. No data was uploaded.');
      blob = remote.body;
    }
    const file = await validateBlob(blob, hash, kind, urlKey);
    await cacheBlob(hash, blob);
    return file;
  };
  const pages = new Map<string, BackupFile>();
  for (const [key, hash] of Object.entries(manifest.pages)) pages.set(key, await readBlob('page', hash, key));
  const settings = await readBlob('settings', manifest.settings);
  // A cached root only means the remote content was verified, never that a
  // local edit was acknowledged. The next run always snapshots the real DB.
  await cacheRoot(scope, body, etag);
  return { projection: { pages, settings }, manifest, etag, exists: true, body };
}

/** Page shards are immutable. Only the small root index uses compare-and-swap. */
export async function runSync(
  config: SyncConfig,
  state: SyncState,
  appVersion: string,
  isCurrent: () => Promise<boolean> = async () => true,
  options: { fullScan?: boolean } = {},
): Promise<{ result: SyncResult; state: SyncState }> {
  const base = normalizeCollectionUrl(config.url);
  const failure = (error: string, paused = state.autoPaused ?? '') => ({
    result: { ok: false, pulled, settingsPulled, pushed: false, error, uploadedBytes, changedPages: 0 },
    state: { ...state, lastError: error, autoPaused: paused, lastUploadBytes: uploadedBytes,
      lastChangedPages: 0, ...(lastUploadAt ? { lastUploadAt } : {}) },
  });
  let pulled = 0; let settingsPulled = 0; let uploadedBytes = 0; let lastUploadAt = 0;
  if (!base || !isConfigComplete(config)) return failure('Sync is not configured.');
  const client = new WebDavClient(config, base);
  const scope = await syncCacheScope(base, config.username);
  const ensureCurrent = async () => { if (!await isCurrent()) throw new SyncSupersededError(); };
  const uploaded = new Set<string>();
  let collectionsReady = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await ensureCurrent();
      const remote = await readSnapshot(client, scope, ensureCurrent, options.fullScan === true);
      await ensureCurrent();
      const local = await projectBackup(await repo.exportBackup(appVersion));
      const merged = mergeProjections(remote.projection, local);
      const blobs: EncodedBlob[] = [];
      const manifest: SyncManifest = { format: 'locus-backup', formatVersion: 4, pages: Object.create(null) as Record<string, string>, settings: '' };
      for (const [key, page] of merged.pages) {
        const blob = await encode(page, 'page', key);
        manifest.pages[key] = blob.hash;
        if (remote.manifest?.pages[key] !== blob.hash) blobs.push(blob);
      }
      const settings = await encode(merged.settings, 'settings');
      manifest.settings = settings.hash;
      if (remote.manifest?.settings !== settings.hash) blobs.push(settings);
      const body = stableJSON(manifest);
      if (byteLength(body) > MAX_SYNC_ROOT_BYTES) throw new SyncDataError('Sync index is too large.');
      const changedPages = blobs.filter((blob) => blob.kind === 'page').length;
      const needsWrite = !remote.manifest || stableJSON(remote.manifest) !== body;
      await ensureCurrent();
      const summary = await repo.importBackup(projectionBackup(merged), { preserveAnnotationIds: true });
      pulled += summary.annotationsAdded + summary.annotationsUpdated;
      settingsPulled += summary.settingsUpdated;
      await ensureCurrent();
      if (!needsWrite) return {
        result: { ok: true, pulled, settingsPulled, pushed: false, error: '', uploadedBytes, changedPages: 0 },
        state: { ...state, lastSyncAt: Date.now(), lastError: '', etag: remote.etag, autoPaused: '',
          lastUploadBytes: uploadedBytes, lastChangedPages: 0, ...(lastUploadAt ? { lastUploadAt } : {}) },
      };
      if (remote.exists && !strongEtag(remote.etag)) throw new SyncDataError('The server does not provide a safe sync version. Upload was stopped.');
      if (!remote.manifest && !collectionsReady) {
        if (!remote.exists) { await client.ensureCollection(); await ensureCurrent(); }
        await client.ensureCollection(SYNC_DIRECTORY); await ensureCurrent();
        collectionsReady = true;
      }
      for (const blob of blobs) {
        await ensureCurrent();
        const name = blobPath(blob.kind, blob.hash);
        if (!uploaded.has(name)) {
          try {
            uploadedBytes += byteLength(blob.body);
            await client.put(name, blob.body, 'absent');
            lastUploadAt = Date.now();
          } catch (error) {
            if (!(error instanceof WebDavError) || error.status !== 412) throw error;
            const existing = await client.read(name);
            await ensureCurrent();
            if (existing.kind !== 'file') throw new SyncDataError('An immutable sync file could not be verified.');
            await validateBlob(existing.body, blob.hash, blob.kind, blob.urlKey);
          }
          uploaded.add(name);
          await cacheBlob(blob.hash, blob.body);
        }
      }
      await ensureCurrent();
      uploadedBytes += byteLength(body);
      const etag = await client.put(LIBRARY_FILE, body, remote.exists ? { replaces: remote.etag } : 'absent');
      lastUploadAt = Date.now();
      await ensureCurrent();
      // This is the exact committed root, not a fresh post-request DB export.
      await cacheRoot(scope, body, etag);
      const now = Date.now();
      return {
        result: { ok: true, pulled, settingsPulled, pushed: true, error: '', uploadedBytes, changedPages },
        state: { ...state, lastSyncAt: now, lastError: '', etag, lastUploadBytes: uploadedBytes,
          lastUploadAt: now, lastChangedPages: changedPages, autoPaused: '' },
      };
    } catch (error) {
      if (error instanceof WebDavError && error.status === 412 && attempt < MAX_ATTEMPTS) continue;
      if (error instanceof SyncSupersededError) return failure('Sync settings changed. The previous sync was stopped.');
      if (error instanceof WebDavError) return failure(error.message, error.code === 'TrafficRateExhausted' ? 'quota' : state.autoPaused ?? '');
      if (error instanceof SyncDataError) return failure(error.message);
      if (error instanceof SyntaxError) return failure('Remote sync data is not valid JSON.');
      return failure('Sync could not finish. Check the connection and local storage.');
    }
  }
  return failure('The remote library kept changing. Run sync again.');
}

/** Connection checks only read. They do not create folders or upload a file. */
export async function testConnection(config: SyncConfig): Promise<{ ok: boolean; error: string }> {
  const base = normalizeCollectionUrl(config.url);
  if (!base) return { ok: false, error: 'That does not look like a WebDAV address.' };
  if (!isConfigComplete(config)) return { ok: false, error: 'Fill in the address, username and password.' };
  try {
    await new WebDavClient(config, base).read(LIBRARY_FILE);
    return { ok: true, error: '' };
  } catch (error) {
    if (error instanceof WebDavError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not reach the WebDAV server. Check the address and connection.' };
  }
}

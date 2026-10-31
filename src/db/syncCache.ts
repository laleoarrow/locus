import Dexie, { type Table } from 'dexie';
import { contentHash } from '@/domain/syncFormat';

interface CacheRecord { key: string; body: string; etag?: string }

/** Transfer cache only. Separate from the library and never part of a backup. */
class SyncCache extends Dexie {
  entries!: Table<CacheRecord, string>;
  constructor() {
    super('locus-sync-cache');
    this.version(1).stores({ entries: 'key' });
  }
}
export const syncCache = new SyncCache();

export async function syncCacheScope(url: string, username: string): Promise<string> {
  return contentHash(JSON.stringify([url, username]));
}
export async function getCachedRoot(scope: string): Promise<CacheRecord | undefined> {
  return syncCache.entries.get(`${scope}:root`);
}
export async function cacheRoot(scope: string, body: string, etag: string): Promise<void> {
  await syncCache.entries.put({ key: `${scope}:root`, body, etag });
}
export async function preserveLegacyRoot(scope: string, body: string): Promise<void> {
  await syncCache.entries.put({ key: `${scope}:legacy:${await contentHash(body)}`, body });
}
export async function getCachedBlob(hash: string): Promise<string | undefined> {
  return (await syncCache.entries.get(`blob:${hash}`))?.body;
}
export async function cacheBlob(hash: string, body: string): Promise<void> {
  await syncCache.entries.put({ key: `blob:${hash}`, body });
}

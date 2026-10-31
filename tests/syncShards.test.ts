import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import { syncCache } from '@/db/syncCache';
import { parseBackup, type BackupFile } from '@/domain/backup';
import { blobPath, contentHash, parseManifest, projectBackup, stableJSON, type SyncProjection } from '@/domain/syncFormat';
import { EMPTY_SYNC_STATE, type SyncConfig } from '@/domain/sync';
import { runSync } from '@/sync/engine';

const config: SyncConfig = { enabled: true, url: 'https://dav.test/folder/', username: 'test', password: 'test', schedule: 'daily', intervalMinutes: 1440 };
const root = 'locus-library.json';
class Dav {
  files = new Map<string, { body: string; etag: string }>();
  calls: { method: string; name: string; body: string; headers: Record<string, string> }[] = [];
  version = 0;
  hideEtag = false;
  failPage = false;
  quota = false;
  beforeRootPut?: () => Promise<void>;
  write(name: string, body: string) { this.files.set(name, { body, etag: `etag-${++this.version}` }); }
  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const name = new URL(url).pathname.replace(/^\/folder\//, '');
    const method = init.method ?? 'GET'; const body = String(init.body ?? '');
    const headers = init.headers as Record<string, string>;
    this.calls.push({ method, name, body, headers });
    if (method === 'MKCOL') return new Response(null, { status: 201 });
    if (method === 'GET') {
      const file = this.files.get(name);
      if (!file) return new Response(null, { status: 404 });
      const responseHeaders: Record<string, string> = this.hideEtag ? {} : { etag: file.etag };
      if (headers['If-None-Match'] === file.etag) return new Response(null, { status: 304, headers: responseHeaders });
      return new Response(file.body, { headers: responseHeaders });
    }
    if (method === 'PUT') {
      if (name.startsWith('locus-v4/page-') && this.failPage) return new Response(null, { status: 503 });
      if (this.quota) return new Response('<d:error><d:exception>TrafficRateExhausted</d:exception></d:error>', { status: 403 });
      if (name === root && this.beforeRootPut) { const hook = this.beforeRootPut; this.beforeRootPut = undefined; await hook(); }
      const file = this.files.get(name);
      if ((headers['If-None-Match'] === '*' && file) || (headers['If-Match'] && headers['If-Match'] !== file?.etag)) {
        return new Response(null, { status: 412 });
      }
      this.write(name, body);
      return new Response(null, { status: 201, headers: this.hideEtag ? {} : { etag: this.files.get(name)!.etag } });
    }
    throw new Error('Unexpected fixture request');
  };
  puts() { return this.calls.filter((call) => call.method === 'PUT'); }
}
let dav: Dav;
async function addPage(url: string, comment = 'note') {
  const source = await repo.ensureSource(url, 'Paper');
  return (await repo.createAnnotation({ sourceId: source.id, documentId: source.documentId, comment, color: 'yellow', anchor: {
    exact: 'selected quote', prefix: '', suffix: '', start: 0, end: 14,
    startPoint: { steps: [], textIndex: 0, offset: 0 }, endPoint: { steps: [], textIndex: 0, offset: 14 },
  } })).annotation;
}
async function seedProjection(projection: SyncProjection) {
  const pages: Record<string, string> = {};
  for (const [key, page] of projection.pages) {
    const body = stableJSON(page); const hash = await contentHash(body); pages[key] = hash;
    dav.write(blobPath('page', hash), body);
  }
  const body = stableJSON(projection.settings); const hash = await contentHash(body);
  dav.write(blobPath('settings', hash), body);
  dav.write(root, stableJSON({ format: 'locus-backup', formatVersion: 4, pages, settings: hash }));
}
async function remoteNotes() {
  const manifest = parseManifest(dav.files.get(root)!.body);
  return Object.values(manifest.pages).flatMap((hash) => (JSON.parse(dav.files.get(blobPath('page', hash))!.body) as BackupFile).annotations);
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await Promise.all(db.tables.map((table) => table.clear()));
  await syncCache.entries.clear();
  dav = new Dav(); vi.stubGlobal('fetch', dav.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('page-sharded WebDAV sync', () => {
  it('migrates legacy data only after writing required shards and preserves its exact local recovery copy', async () => {
    await addPage('https://example.test/a'); await repo.ensureSource('https://example.test/unannotated', 'Viewed');
    const legacy = JSON.stringify(await repo.exportBackup('0.8.1')); dav.write(root, legacy);
    const result = await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    expect(result.result.ok).toBe(true);
    const manifest = parseManifest(dav.files.get(root)!.body);
    expect(Object.keys(manifest.pages)).toEqual(['https://example.test/a']);
    expect(dav.puts().map((call) => call.name).at(-1)).toBe(root);
    expect(parseBackup(JSON.parse(dav.files.get(root)!.body))).toHaveProperty('error');
    expect((await syncCache.entries.toArray()).some((entry) => entry.key.includes(':legacy:') && entry.body === legacy)).toBe(true);
    expect(await db.sources.count()).toBe(2);
  });

  it('does not replace a legacy root if any shard upload fails', async () => {
    await addPage('https://example.test/a'); const legacy = JSON.stringify(await repo.exportBackup('0.8.1'));
    dav.write(root, legacy); const etag = dav.files.get(root)!.etag; dav.failPage = true;
    expect((await runSync(config, EMPTY_SYNC_STATE, '0.9.0')).result.ok).toBe(false);
    expect(dav.files.get(root)).toEqual({ body: legacy, etag });
    expect(dav.puts().some((call) => call.name === root)).toBe(false);
  });

  it.each(['legacy', 'local'])('never publishes malformed %s records as unreadable new shards', async (where) => {
    const annotation = await addPage('https://example.test/a');
    if (where === 'legacy') {
      const file = await repo.exportBackup('0.8.1');
      delete (file.annotations[0] as unknown as Record<string, unknown>).comment;
      dav.write(root, JSON.stringify(file));
      await Promise.all(db.tables.map((table) => table.clear()));
    } else {
      await db.annotations.put({ ...annotation, comment: undefined } as unknown as typeof annotation);
    }
    const before = dav.files.get(root);
    expect((await runSync(config, EMPTY_SYNC_STATE, '0.9.0')).result.ok).toBe(false);
    expect(dav.puts()).toHaveLength(0);
    expect(dav.files.get(root)).toEqual(before);
    if (where === 'legacy') expect(await db.annotations.count()).toBe(0);
  });

  it('uses one conditional root GET and zero PUTs for unchanged data, even after a visit or app update', async () => {
    await addPage('https://example.test/a'); const first = await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    expect(first.result.ok).toBe(true); dav.calls = [];
    await repo.ensureSource('https://example.test/a', 'Paper'); await repo.ensureSource('https://example.test/no-notes', 'Viewed');
    const second = await runSync(config, first.state, 'later-version');
    expect(second.result).toMatchObject({ ok: true, pushed: false, uploadedBytes: 0 });
    expect(second.state).toMatchObject({ lastUploadBytes: 0, lastChangedPages: 0, lastUploadAt: first.state.lastUploadAt });
    expect(dav.calls.map((call) => [call.method, call.name])).toEqual([['GET', root]]);
  });

  it('uploads only the changed page and root for a single note edit', async () => {
    const a = await addPage('https://example.test/a'); await addPage('https://example.test/b');
    const first = await runSync(config, EMPTY_SYNC_STATE, '0.9.0'); dav.calls = [];
    await repo.setComment(a.id, 'changed note');
    const second = await runSync(config, first.state, '0.9.0');
    expect(second.result).toMatchObject({ ok: true, changedPages: 1 });
    expect(dav.puts()).toHaveLength(2);
    expect(dav.puts()[0]!.name).toMatch(/^locus-v4\/page-/);
    expect(dav.puts()[1]!.name).toBe(root);
    expect((await remoteNotes()).find((row) => row.id === a.id)!.comment).toBe('changed note');
  });

  it('manually verifies every remote page and settings file despite a warm cache without re-uploading them', async () => {
    await addPage('https://example.test/a'); await addPage('https://example.test/b');
    const first = await runSync(config, EMPTY_SYNC_STATE, '0.9.2'); dav.calls = [];
    const full = await runSync(config, first.state, '0.9.2', undefined, { fullScan: true });
    expect(full.result).toMatchObject({ ok: true, pushed: false, uploadedBytes: 0 });
    expect(dav.calls).toHaveLength(4);
    expect(dav.calls.every((call) => call.method === 'GET' && !call.headers['If-None-Match'])).toBe(true);
  });

  it('a manual full scan detects a missing remote shard even when a valid local cache exists', async () => {
    await addPage('https://example.test/a'); const first = await runSync(config, EMPTY_SYNC_STATE, '0.9.2');
    const manifest = parseManifest(dav.files.get(root)!.body);
    dav.files.delete(blobPath('page', Object.values(manifest.pages)[0]!)); dav.calls = [];
    const full = await runSync(config, first.state, '0.9.2', undefined, { fullScan: true });
    expect(full.result.ok).toBe(false); expect(full.result.error).toContain('missing');
    expect(dav.puts()).toHaveLength(0);
  });

  it('downloads a new device snapshot once and does not republish it', async () => {
    await addPage('https://example.test/a'); await addPage('https://example.test/b');
    await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    await Promise.all(db.tables.map((table) => table.clear())); await syncCache.entries.clear(); dav.calls = [];
    const result = await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    expect(result.result.ok).toBe(true); expect(await db.annotations.count()).toBe(2);
    expect(dav.puts()).toHaveLength(0);
    expect(dav.calls.filter((call) => call.method === 'GET')).toHaveLength(4);
  });

  it('keeps concurrent remote pages and merges a remote recolour after a root CAS conflict', async () => {
    const annotation = await addPage('https://example.test/a');
    const first = await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    const remote = await repo.exportBackup('0.9.0');
    remote.annotations[0]!.color = 'pink'; remote.annotations[0]!.colorUpdatedAt = Date.now() + 10000;
    await addPage('https://example.test/remote-only');
    const withOther = await repo.exportBackup('0.9.0');
    remote.documents.push(...withOther.documents.filter((row) => !remote.documents.some((known) => known.id === row.id)));
    remote.sources.push(...withOther.sources.filter((row) => !remote.sources.some((known) => known.id === row.id)));
    remote.annotations.push(...withOther.annotations.filter((row) => row.id !== annotation.id));
    remote.anchors.push(...withOther.anchors.filter((row) => row.annotationId !== annotation.id));
    const other = remote.annotations.find((row) => row.id !== annotation.id)!;
    await db.annotations.delete(other.id); await db.anchors.where('annotationId').equals(other.id).delete();
    await repo.setComment(annotation.id, 'local edit');
    dav.beforeRootPut = async () => seedProjection(await projectBackup(remote));
    dav.calls = [];
    const result = await runSync(config, first.state, '0.9.0');
    expect(result.result.ok).toBe(true);
    expect(dav.puts().filter((call) => call.name === root)).toHaveLength(2);
    expect(result.result.uploadedBytes).toBe(dav.puts().reduce((sum, call) => sum + new TextEncoder().encode(call.body).byteLength, 0));
    expect(await remoteNotes()).toHaveLength(2);
    expect((await remoteNotes()).find((row) => row.id === annotation.id)).toMatchObject({ comment: 'local edit', color: 'pink' });
  });

  it('does not acknowledge an edit made while the final root upload is in flight', async () => {
    const annotation = await addPage('https://example.test/a');
    dav.beforeRootPut = async () => { await repo.setComment(annotation.id, 'edited during upload'); };
    const first = await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    expect((await remoteNotes())[0]!.comment).toBe('note'); dav.calls = [];
    const next = await runSync(config, first.state, '0.9.0');
    expect(next.result).toMatchObject({ ok: true, changedPages: 1 });
    expect((await remoteNotes())[0]!.comment).toBe('edited during upload');
  });

  it.each(['missing', 'corrupt'])('fails closed before importing or uploading a %s referenced shard', async (mode) => {
    await addPage('https://example.test/a'); await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    const manifest = parseManifest(dav.files.get(root)!.body); const path = blobPath('page', Object.values(manifest.pages)[0]!);
    if (mode === 'missing') dav.files.delete(path); else dav.write(path, 'corrupt');
    await Promise.all(db.tables.map((table) => table.clear())); await syncCache.entries.clear(); dav.calls = [];
    expect((await runSync(config, EMPTY_SYNC_STATE, '0.9.0')).result.ok).toBe(false);
    expect(await db.annotations.count()).toBe(0); expect(dav.puts()).toHaveLength(0);
  });

  it.each(['', 'W/"weak"', '*'])('refuses an existing root without a strong ETag (%s)', async (etag) => {
    await addPage('https://example.test/a'); dav.write(root, JSON.stringify(await repo.exportBackup('0.8.1')));
    dav.files.get(root)!.etag = etag;
    expect((await runSync(config, EMPTY_SYNC_STATE, '0.9.0')).result.ok).toBe(false);
    expect(dav.puts()).toHaveLength(0);
  });

  it('does not borrow a cached ETag when a changed 200 response omits its validator', async () => {
    const annotation = await addPage('https://example.test/a'); const first = await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    dav.write(root, dav.files.get(root)!.body); dav.hideEtag = true; dav.calls = [];
    await repo.setComment(annotation.id, 'changed');
    expect((await runSync(config, first.state, '0.9.0')).result.ok).toBe(false);
    expect(dav.puts()).toHaveLength(0);
  });

  it('pauses after a provider quota error without advancing the acknowledged sync time', async () => {
    await addPage('https://example.test/a'); dav.quota = true;
    const result = await runSync(config, { ...EMPTY_SYNC_STATE, lastSyncAt: 123 }, '0.9.0');
    expect(result.state).toMatchObject({ autoPaused: 'quota', lastSyncAt: 123 });
    expect(result.result.error).toContain('流量不足'); expect(dav.puts()).toHaveLength(1);
    expect(result.state.lastUploadBytes).toBe(new TextEncoder().encode(dav.puts()[0]!.body).byteLength);
    expect(result.state.lastUploadAt).toBeUndefined();
    dav.quota = false;
    expect((await runSync(config, result.state, '0.9.0')).state.autoPaused).toBe('');
  });

  it('does not infer destination blob existence from a cached copy on another destination', async () => {
    await addPage('https://example.test/a'); await runSync(config, EMPTY_SYNC_STATE, '0.9.0');
    dav.files.clear(); dav.calls = [];
    const result = await runSync({ ...config, username: 'another-account' }, EMPTY_SYNC_STATE, '0.9.0');
    expect(result.result.ok).toBe(true);
    expect(dav.puts().map((call) => call.name)).toHaveLength(3);
  });
});

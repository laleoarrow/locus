import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { syncCache } from '@/db/syncCache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '@/db/repo';
import { type BackupFile } from '@/domain/backup';
import { EMPTY_SYNC_STATE, type SyncConfig } from '@/domain/sync';
import { WebDavClient } from '@/lib/webdav';
import { runSync } from '@/sync/engine';

vi.mock('@/db/repo', () => ({ importBackup: vi.fn(), exportBackup: vi.fn() }));

const config: SyncConfig = {
  enabled: true, url: 'https://dav.example/folder/', username: 'fixture-user',
  password: 'fixture-password', schedule: 'daily', intervalMinutes: 1440,
};
const backup: BackupFile = {
  format: 'locus-backup', formatVersion: 3, exportedAt: 1, appVersion: '0.8.1',
  documents: [], sources: [], annotations: [], anchors: [], settings: [], pageSummaries: [],
};

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await syncCache.entries.clear();
  vi.mocked(repo.exportBackup).mockResolvedValue(backup);
  vi.mocked(repo.importBackup).mockResolvedValue({
    annotationsAdded: 1, annotationsUpdated: 0, annotationsSkipped: 0,
    sourcesLinked: 0, sourcesAdded: 0, settingsUpdated: 0, summariesUpdated: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('sync configuration changes during a request', () => {
  it.each(['destination changed', 'sync disabled'])('does not import or upload after a delayed GET when %s', async () => {
    let current = true;
    let release!: (response: Response) => void;
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      if (options.method === 'MKCOL') return Promise.resolve(new Response(null, { status: 201 }));
      if (options.method === 'GET') return new Promise<Response>((resolve) => { release = resolve; });
      return Promise.resolve(new Response(null, { status: 201 }));
    });
    vi.stubGlobal('fetch', fetcher);
    const pending = runSync(config, EMPTY_SYNC_STATE, '0.8.1', async () => current);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    current = false;
    release(new Response(JSON.stringify(backup), { headers: { etag: 'remote-etag' } }));
    const outcome = await pending;
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.error).toContain('settings changed');
    expect(repo.importBackup).not.toHaveBeenCalled();
    expect(repo.exportBackup).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(['GET']);
  });

  it('does not PUT when configuration changes while preparing the local export', async () => {
    let current = true;
    vi.mocked(repo.exportBackup).mockImplementation(async () => { current = false; return backup; });
    const fetcher = vi.fn((_url: string, options: RequestInit) => Promise.resolve(
      options.method === 'MKCOL' ? new Response(null, { status: 201 }) : new Response(null, { status: 404 }),
    ));
    vi.stubGlobal('fetch', fetcher);
    const outcome = await runSync(config, EMPTY_SYNC_STATE, '0.8.1', async () => current);
    expect(outcome.result.ok).toBe(false);
    expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(['GET']);
  });

  it('never makes a request when its configuration was already superseded', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const outcome = await runSync(config, EMPTY_SYNC_STATE, '0.8.1', async () => false);
    expect(outcome.result.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(repo.importBackup).not.toHaveBeenCalled();
  });
});

describe('WebDAV deadline', () => {
  it('keeps the deadline signal attached while reading a stalled response body', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn((_url: string, options: RequestInit) => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          options.signal?.addEventListener('abort', () => stream.error(new DOMException('Timed out', 'TimeoutError')));
        },
      }),
    )));
    vi.stubGlobal('fetch', fetcher);
    const client = new WebDavClient(config, config.url);
    const pending = expect(client.get('locus-library.json')).rejects.toThrow('Timed out');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(25_000);
    controller.abort();
    await pending;
  });
});

import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import type { BackupFile } from '../src/domain/backup';
import type { AnnotationRecord, AnnotationWithAnchor } from '../src/domain/types';
import { BASE_URL, expect, launchSeparateProfile, test } from './extension';
import { DAV_AUTH, davState, readRemoteLibrary, readRemoteManifest } from './sync-remote';

async function library(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await page.locator('.library-header').waitFor();
  return page;
}

async function configure(page: Page, url: string): Promise<void> {
  const result = await page.evaluate((url) => chrome.runtime.sendMessage({
    type: 'sync:save', patch: { enabled: true, url, username: 'tester', password: 'app-password' },
  }), url);
  expect(result.error).toBeUndefined();
}

async function sync(page: Page) {
  return page.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
}

async function note(page: Page, suffix: string, exact = 'A saved quotation'): Promise<AnnotationWithAnchor> {
  const result = await page.evaluate(({ url, exact }) => chrome.runtime.sendMessage({
    type: 'annotation:create', url, title: `Fixture ${url}`, color: 'yellow', comment: '',
    anchor: {
      kind: 'text', exact, prefix: '', suffix: '', start: 0, end: exact.length,
      startPoint: { steps: [{ tag: 'p', index: 0 }], textIndex: 0, offset: 0 },
      endPoint: { steps: [{ tag: 'p', index: 0 }], textIndex: 0, offset: exact.length },
    },
  }), { url: `${BASE_URL}/fixtures/nested.html?sync=${suffix}`, exact });
  return result.item as AnnotationWithAnchor;
}

async function comment(page: Page, id: string, value: string): Promise<void> {
  await page.evaluate(({ id, comment }) => chrome.runtime.sendMessage({ type: 'annotation:set-comment', id, comment }), { id, comment: value });
}

async function annotation(page: Page, id: string): Promise<AnnotationRecord> {
  return page.evaluate((id) => new Promise<AnnotationRecord>((resolve, reject) => {
    const open = indexedDB.open('locus');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction('annotations').objectStore('annotations').get(id);
      get.onsuccess = () => { db.close(); resolve(get.result as AnnotationRecord); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }), id);
}

function legacyLibrary(unusedCount: number): BackupFile {
  const time = 1_700_000_000_000;
  const result: BackupFile = {
    format: 'locus-backup', formatVersion: 3, appVersion: '0.8.1', exportedAt: time,
    documents: [], sources: [], annotations: [], anchors: [], pageSummaries: [],
    settings: [{ key: 'lastColor', value: 'yellow' }],
  };
  for (let index = 0; index < unusedCount + 3; index++) {
    const id = `legacy-${index}`;
    const url = `${BASE_URL}/fixtures/nested.html?legacy=${index}`;
    const title = index < 3 ? `Relevant page ${index}` : `Visited only ${index} ${'unused page metadata '.repeat(8)}`;
    result.documents.push({ id: `doc-${id}`, title, doi: '', createdAt: time, updatedAt: time });
    result.sources.push({ id, documentId: `doc-${id}`, urlKey: url, url, title, firstSeenAt: time, lastSeenAt: time });
    if (index < 2) {
      const exact = index === 0 ? 'Preserved live quotation' : 'Preserved deleted quotation';
      result.annotations.push({
        id: `annotation-${id}`, documentId: `doc-${id}`, sourceId: id, kind: 'text',
        color: 'yellow', comment: `Saved note ${index}`, exact,
        createdAt: time, updatedAt: time + index, colorUpdatedAt: time, deletedAt: index === 1 ? time + 1 : 0,
      });
      result.anchors.push({
        id: `anchor-${id}`, annotationId: `annotation-${id}`, exact, prefix: '', suffix: '', start: 0, end: exact.length,
        startPoint: { steps: [{ tag: 'p', index: 0 }], textIndex: 0, offset: 0 },
        endPoint: { steps: [{ tag: 'p', index: 0 }], textIndex: 0, offset: exact.length },
      });
    }
    if (index === 2) result.pageSummaries!.push({ sourceId: id, content: 'A page with only saved main content', updatedAt: time });
  }
  return result;
}

async function seedLegacy(request: APIRequestContext, url: string, backup: BackupFile): Promise<{ body: string; etag: string }> {
  expect((await request.fetch(url, { method: 'MKCOL', headers: DAV_AUTH })).status()).toBe(201);
  const body = JSON.stringify(backup);
  const response = await request.put(`${url}locus-library.json`, { headers: { ...DAV_AUTH, 'if-none-match': '*' }, data: body });
  expect(response.status()).toBe(201);
  return { body, etag: response.headers()['etag']! };
}

test('E66: legacy migration uploads only pages with annotations, tombstones or main content', async ({
  context, serviceWorker, extensionId, request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const url = `${BASE_URL}/dav/${randomUUID()}/`;
  const old = await seedLegacy(request, url, legacyLibrary(4000));
  const page = await library(context, extensionId);
  await configure(page, url);
  await request.get(`${BASE_URL}/__dav-stats-reset`);
  const outcome = await sync(page);
  expect(outcome.result.ok).toBe(true);
  const traffic = await davState(request, url);
  expect(traffic.uploadBytes).toBeLessThan(Buffer.byteLength(old.body) / 20);
  const manifest = await readRemoteManifest(request, url);
  expect(manifest.formatVersion).toBe(4);
  expect(Object.keys(manifest.pages)).toHaveLength(3);
  const remote = await readRemoteLibrary(request, url);
  expect(remote.sources).toHaveLength(3);
  expect(remote.documents).toHaveLength(3);
  expect(remote.annotations).toHaveLength(2);
  expect(remote.annotations.find((row) => row.deletedAt !== 0)?.comment).toBe('Saved note 1');
  const summarySource = remote.sources.find((source) => source.urlKey === `${BASE_URL}/fixtures/nested.html?legacy=2`);
  expect(summarySource).toBeDefined();
  expect(remote.pageSummaries).toEqual([{ sourceId: summarySource!.id, content: 'A page with only saved main content', updatedAt: 1_700_000_000_000 }]);
  expect(JSON.stringify(remote)).not.toContain('Visited only');
});

test('E67: unchanged sync and page revisits upload zero bytes; one note changes one page blob plus the manifest', async ({
  context, serviceWorker, extensionId, request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const url = `${BASE_URL}/dav/${randomUUID()}/`;
  const page = await library(context, extensionId);
  const one = await note(page, 'one');
  await note(page, 'two');
  await configure(page, url);
  expect((await sync(page)).result.ok).toBe(true);
  const before = await readRemoteManifest(request, url);

  await request.get(`${BASE_URL}/__dav-stats-reset`);
  const lastSyncAt = await page.evaluate(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'sync:status' });
    await chrome.storage.local.set({ 'sync.schedule': { revision: status.config.revision, nextSyncAt: Date.now() - 1000 } });
    await chrome.alarms.create('locus-sync', { when: Date.now() + 100 });
    return status.state.lastSyncAt as number;
  });
  await expect.poll(() => page.evaluate(async (previous) => {
    const status = await chrome.runtime.sendMessage({ type: 'sync:status' });
    return status.state.lastSyncAt > previous && status.connection.status === 'success';
  }, lastSyncAt)).toBe(true);
  let traffic = await davState(request, url);
  expect(traffic.requests.filter((entry) => entry.method === 'PUT')).toHaveLength(0);
  expect(traffic.uploadBytes).toBe(0);
  expect(traffic.requests.some((entry) => entry.method === 'GET' && entry.status === 304)).toBe(true);
  expect(traffic.requests.filter((entry) => entry.method === 'GET' && entry.path.includes('locus-v4/'))).toHaveLength(0);

  const sourceUrl = `${BASE_URL}/fixtures/nested.html?sync=one`;
  await page.evaluate((url) => chrome.runtime.sendMessage({ type: 'source:bootstrap', url, title: `Fixture ${url}` }), sourceUrl);
  await request.get(`${BASE_URL}/__dav-stats-reset`);
  expect((await sync(page)).result.ok).toBe(true);
  traffic = await davState(request, url);
  expect(traffic.requests.filter((entry) => entry.method === 'PUT')).toHaveLength(0);
  expect(traffic.uploadBytes).toBe(0);

  await comment(page, one.annotation.id, 'Only page one changed.');
  await request.get(`${BASE_URL}/__dav-stats-reset`);
  expect((await sync(page)).result.ok).toBe(true);
  traffic = await davState(request, url);
  const puts = traffic.requests.filter((entry) => entry.method === 'PUT');
  expect(puts).toHaveLength(2);
  expect(puts.filter((entry) => /\/locus-v4\/page-[a-f0-9]{64}\.json$/.test(entry.path))).toHaveLength(1);
  expect(puts.filter((entry) => entry.path.endsWith('/locus-library.json'))).toHaveLength(1);
  const after = await readRemoteManifest(request, url);
  expect(after.pages[sourceUrl]).not.toBe(before.pages[sourceUrl]);
  expect(after.pages[`${BASE_URL}/fixtures/nested.html?sync=two`]).toBe(before.pages[`${BASE_URL}/fixtures/nested.html?sync=two`]);
  expect(after.settings).toBe(before.settings);
  const remote = await readRemoteLibrary(request, url);
  expect(remote.annotations.find((row) => row.id === one.annotation.id)?.comment).toBe('Only page one changed.');
});

test('E68: concurrent manifest writers retain different pages and independent note/colour changes', async ({
  context, serviceWorker, extensionId, request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const url = `${BASE_URL}/dav/${randomUUID()}/`;
  const a = await library(context, extensionId);
  const first = await note(a, 'concurrent-a');
  const shared = await note(a, 'shared');
  await configure(a, url);
  expect((await sync(a)).result.ok).toBe(true);
  const installB = await launchSeparateProfile();
  try {
    const b = await library(installB.context, installB.extensionId);
    await configure(b, url);
    expect((await sync(b)).result.ok).toBe(true);
    const collide = async () => {
      await request.get(`${BASE_URL}/__dav-stats-reset`);
      const rootPath = `${new URL(url).pathname}locus-library.json`;
      await request.get(`${BASE_URL}/__dav-delay-next-put?ms=1800&path=${encodeURIComponent(rootPath)}`);
      const pendingA = sync(a);
      await expect.poll(async () => (await (await request.get(`${BASE_URL}/__dav-delay-status`)).json()).active).toBe(true);
      expect((await sync(b)).result.ok).toBe(true);
      expect((await pendingA).result.ok).toBe(true);
      expect((await davState(request, url)).requests.some((entry) => entry.path === rootPath && entry.status === 412)).toBe(true);
      expect((await sync(b)).result.ok).toBe(true);
    };

    await comment(a, first.annotation.id, 'Client A changed this page.');
    const second = await note(b, 'concurrent-b');
    await collide();
    let remote = await readRemoteLibrary(request, url);
    expect(remote.annotations.find((row) => row.id === first.annotation.id)?.comment).toBe('Client A changed this page.');
    expect(remote.annotations.some((row) => row.id === second.annotation.id)).toBe(true);

    const current = await annotation(a, shared.annotation.id);
    const recolored = await a.evaluate((row) => chrome.runtime.sendMessage({
      type: 'annotations:edit',
      expected: [{ id: row.id, updatedAt: row.updatedAt, colorUpdatedAt: row.colorUpdatedAt ?? row.createdAt, deletedAt: row.deletedAt }],
      action: { type: 'color', color: 'pink' },
    }), current);
    expect(recolored.updated).toBe(1);
    await comment(b, shared.annotation.id, 'Client B independently changed the note.');
    await collide();
    remote = await readRemoteLibrary(request, url);
    expect(remote.annotations.find((row) => row.id === shared.annotation.id)).toMatchObject({
      color: 'pink', comment: 'Client B independently changed the note.',
    });
    for (const client of [a, b]) {
      expect((await sync(client)).result.ok).toBe(true);
      expect(await annotation(client, shared.annotation.id)).toMatchObject({ color: 'pink', comment: 'Client B independently changed the note.' });
    }
  } finally { await installB.context.close(); }
});

test('E69: traffic quota errors pause automatic uploads until a successful manual retry', async ({
  context, serviceWorker, extensionId, request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const url = `${BASE_URL}/dav/${randomUUID()}/`;
  const page = await library(context, extensionId);
  const saved = await note(page, 'quota');
  await configure(page, url);
  expect((await sync(page)).result.ok).toBe(true);
  await request.post(`${BASE_URL}/__dav-fault`, { data: {
    prefix: new URL(url).pathname, method: 'PUT', status: 403, count: -1,
    body: '<error><code>TrafficRateExhausted</code><message>fixture upload traffic exhausted</message></error>',
  } });
  await comment(page, saved.annotation.id, 'Pending quota-limited change.');
  const refused = await sync(page);
  expect(refused.result.ok).toBe(false);
  expect(refused.state.autoPaused).toBe('quota');
  expect(refused.result.error).toMatch(/流量|quota|traffic/i);
  expect(refused.result.error).not.toContain('app password');
  await expect(page.locator('[data-status="sync"]')).toContainText('上传已暂停');

  await request.get(`${BASE_URL}/__dav-stats-reset`);
  await comment(page, saved.annotation.id, 'Latest local change remains safe while paused.');
  // A due alarm must also respect the quota pause, even with unsynced edits.
  await page.evaluate(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'sync:status' });
    await chrome.storage.local.set({ 'sync.schedule': { revision: status.config.revision, nextSyncAt: Date.now() - 1000 } });
    await chrome.alarms.create('locus-sync', { when: Date.now() + 100 });
  });
  await expect.poll(() => page.evaluate(async () => {
    const stored = await chrome.storage.local.get('sync.schedule');
    return (stored['sync.schedule'] as { nextSyncAt: number }).nextSyncAt;
  })).toBe(0);
  expect((await davState(request, url)).requests).toHaveLength(0);
  await request.post(`${BASE_URL}/__dav-fault`, { data: null });
  const recovered = await sync(page);
  expect(recovered.result.ok).toBe(true);
  expect(recovered.state.autoPaused).not.toBe('quota');
  await expect(page.locator('[data-status="sync"]')).not.toContainText('上传已暂停');
  expect((await readRemoteLibrary(request, url)).annotations.find((row) => row.id === saved.annotation.id)?.comment)
    .toBe('Latest local change remains safe while paused.');
});

test('E70: a failed legacy migration leaves the old root bytes and ETag untouched', async ({
  context, serviceWorker, extensionId, request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const url = `${BASE_URL}/dav/${randomUUID()}/`;
  const old = await seedLegacy(request, url, legacyLibrary(20));
  await request.post(`${BASE_URL}/__dav-fault`, { data: {
    prefix: `${new URL(url).pathname}locus-v4/page-`, method: 'PUT', status: 503, count: -1,
  } });
  const page = await library(context, extensionId);
  await configure(page, url);
  await request.get(`${BASE_URL}/__dav-stats-reset`);
  expect((await sync(page)).result.ok).toBe(false);
  const requests = (await davState(request, url)).requests;
  expect(requests.some((entry) => entry.method === 'PUT' && entry.path.endsWith('/locus-library.json'))).toBe(false);
  const root = await request.get(`${url}locus-library.json`, { headers: DAV_AUTH });
  expect(await root.text()).toBe(old.body);
  expect(root.headers()['etag']).toBe(old.etag);
});

test('E74: manual full sync rereads every remote page without rewriting unchanged content', async ({
  context, serviceWorker, extensionId, request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const url = `${BASE_URL}/dav/${randomUUID()}/`;
  const page = await library(context, extensionId);
  await note(page, 'full-scan-one');
  await note(page, 'full-scan-two');
  await configure(page, url);
  expect((await sync(page)).result.ok).toBe(true);
  const manifest = await readRemoteManifest(request, url);
  const expectedPaths = [
    `${new URL(url).pathname}locus-library.json`,
    ...Object.values(manifest.pages).map((hash) => `${new URL(url).pathname}locus-v4/page-${hash}.json`),
    `${new URL(url).pathname}locus-v4/settings-${manifest.settings}.json`,
  ];

  await request.get(`${BASE_URL}/__dav-stats-reset`);
  await page.locator('[data-status="sync"]').click();
  const dialog = page.getByRole('dialog', { name: 'Connection status · 连接状态' });
  const fullSync = dialog.locator('[data-status-action="sync-now"]');
  await expect(fullSync).toHaveText('全量同步');
  await expect(dialog.locator('[data-status-test="sync"]')).toBeVisible();
  await fullSync.click();
  await expect.poll(async () => {
    const traffic = await davState(request, url);
    return expectedPaths.every((path) => traffic.requests.some((entry) => entry.method === 'GET' && entry.path === path));
  }).toBe(true);
  await expect(fullSync).toBeEnabled();
  const traffic = await davState(request, url);
  expect(traffic.requests.filter((entry) => entry.method === 'PUT')).toHaveLength(0);
  expect(traffic.uploadBytes).toBe(0);
  await expect(dialog.locator('[data-status-sync="upload-bytes"]')).toContainText('0 B · 无需上传');
  const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:status' }));
  expect(status.connection.status).toBe('success');
  expect(status.state.lastError).toBe('');
});

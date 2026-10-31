import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import type { BackupFile } from '@/domain/backup';
import { contentHash, mergeProjections, parseManifest, projectBackup, projectionBackup, stableJSON, validateBlob } from '@/domain/syncFormat';

function pageFixture(alias = 'local', comment = 'note', time = 10): BackupFile {
  return {
    format: 'locus-backup', formatVersion: 3, exportedAt: 999, appVersion: '0.9.0',
    documents: [{ id: `d-${alias}`, title: 'Paper', doi: '', createdAt: 1, updatedAt: 100 }],
    sources: [{ id: `s-${alias}`, documentId: `d-${alias}`, urlKey: 'https://example.com/paper', url: 'https://example.com/paper#view', title: 'Paper', firstSeenAt: 1, lastSeenAt: 999 }],
    annotations: [{ id: 'annotation', sourceId: `s-${alias}`, documentId: `d-${alias}`, kind: 'text', color: 'yellow', colorUpdatedAt: 1,
      comment, exact: 'quote', createdAt: 1, updatedAt: time, deletedAt: 0 }],
    anchors: [{ id: `a-${alias}`, annotationId: 'annotation', exact: 'quote', prefix: '', suffix: '', start: 0, end: 5,
      startPoint: { steps: [], textIndex: 0, offset: 0 }, endPoint: { steps: [], textIndex: 0, offset: 5 } }],
    pageSummaries: [], settings: [],
  };
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await Promise.all(db.tables.map((table) => table.clear()));
});
afterEach(() => { vi.unstubAllGlobals(); });

const encoded = async (file: BackupFile) => stableJSON(projectionBackup(await projectBackup(file)));

describe('page sync projection', () => {
  it('ignores export metadata, visits, graph aliases and unannotated pages', async () => {
    const a = pageFixture('a'); const b = pageFixture('b');
    b.exportedAt = 123456; b.appVersion = 'future';
    b.sources[0]!.lastSeenAt = 123456; b.sources[0]!.firstSeenAt = 123456;
    b.documents[0]!.createdAt = 123456; b.documents[0]!.updatedAt = 123456;
    b.sources.push({ ...b.sources[0]!, id: 'unused', urlKey: 'https://example.com/unannotated' });
    expect(await encoded(a)).toBe(await encoded(b));
  });

  it('retains tombstones and cleared summaries even without live notes', async () => {
    const file = pageFixture(); file.annotations[0]!.deletedAt = 15;
    const tombstones = await projectBackup(file);
    expect(tombstones.pages.size).toBe(1);
    expect([...tombstones.pages.values()][0]!.annotations[0]!.deletedAt).toBe(15);
    file.annotations = []; file.anchors = [];
    file.pageSummaries = [{ sourceId: 's-local', content: '', updatedAt: 20 }];
    expect((await projectBackup(file)).pages.size).toBe(1);
  });

  it('merges base text and colour independently, associatively and commutatively', async () => {
    const a = pageFixture('a', 'A'); const b = pageFixture('b', 'B'); const c = pageFixture('c', 'C');
    b.annotations[0]!.color = 'pink'; b.annotations[0]!.colorUpdatedAt = 100;
    c.annotations[0]!.color = 'teal'; c.annotations[0]!.colorUpdatedAt = 2;
    const projections = await Promise.all([a, b, c].map(projectBackup));
    const [pa, pb, pc] = projections;
    const left = mergeProjections(mergeProjections(pa!, pb!), pc!);
    const right = mergeProjections(pa!, mergeProjections(pb!, pc!));
    expect(stableJSON(projectionBackup(left))).toBe(stableJSON(projectionBackup(right)));
    expect(stableJSON(projectionBackup(mergeProjections(pa!, pb!))))
      .toBe(stableJSON(projectionBackup(mergeProjections(pb!, pa!))));
    expect(projectionBackup(left).annotations[0]).toMatchObject({ comment: 'C', color: 'pink', colorUpdatedAt: 100 });
  });

  it('canonically unions setting lists and resolves metadata without locale-dependent order', async () => {
    const a = pageFixture('a'); const b = pageFixture('b');
    a.settings = [{ key: 'colors', value: ['pink', 'yellow'] }];
    b.settings = [{ key: 'colors', value: ['teal', 'pink'] }];
    b.sources[0]!.title = '另一标题'; b.documents[0]!.doi = '10.123/a';
    const pa = await projectBackup(a); const pb = await projectBackup(b);
    const ab = projectionBackup(mergeProjections(pa, pb)); const ba = projectionBackup(mergeProjections(pb, pa));
    expect(stableJSON(ab)).toBe(stableJSON(ba));
    expect(ab.settings[0]!.value).toEqual(['pink', 'teal', 'yellow']);
  });

  it('imports canonical aliases without changing the next network projection', async () => {
    const local = pageFixture('local'); await repo.importBackup(local);
    const projected = await projectBackup(local);
    await repo.importBackup(projectionBackup(projected), { preserveAnnotationIds: true });
    expect(await encoded(await repo.exportBackup('later'))).toBe(stableJSON(projectionBackup(projected)));
  });

  it('preserves distinct annotation IDs during sync while manual import retains its dedupe behavior', async () => {
    const local = pageFixture(); await repo.importBackup(local);
    const remote = pageFixture('remote'); remote.annotations[0]!.id = 'remote-annotation';
    remote.anchors[0]!.annotationId = 'remote-annotation';
    await repo.importBackup(remote);
    expect(await db.annotations.count()).toBe(1);
    await repo.importBackup(remote, { preserveAnnotationIds: true });
    expect(await db.annotations.count()).toBe(2);
  });

  it('repairs a missing anchor in either merge order and in an existing local row', async () => {
    const complete = pageFixture(); const missing = structuredClone(complete); missing.anchors = [];
    const a = await projectBackup(missing); const b = await projectBackup(complete);
    expect(stableJSON(projectionBackup(mergeProjections(a, b))))
      .toBe(stableJSON(projectionBackup(mergeProjections(b, a))));
    expect(projectionBackup(mergeProjections(a, b)).anchors).toHaveLength(1);
    await repo.importBackup(missing);
    await repo.importBackup(complete, { preserveAnnotationIds: true });
    expect(await db.anchors.count()).toBe(1);
  });

  it('verifies content hashes and rejects cross-page or dangling data', async () => {
    const projected = await projectBackup(pageFixture()); const page = [...projected.pages.values()][0]!;
    const body = stableJSON(page); const hash = await contentHash(body);
    await expect(validateBlob(body, hash, 'page', page.sources[0]!.urlKey)).resolves.toEqual(page);
    await expect(validateBlob(body + ' ', hash, 'page', page.sources[0]!.urlKey)).rejects.toThrow('integrity');
    await expect(validateBlob(body, hash, 'page', 'https://wrong.example')).rejects.toThrow('contents');
    const invalid = stableJSON({ ...page, annotations: [...page.annotations, { id: 'invalid' }] });
    await expect(validateBlob(invalid, await contentHash(invalid), 'page', page.sources[0]!.urlKey)).rejects.toThrow('contents');
  });

  it('rejects a correctly hashed shard missing required annotation or anchor field types', async () => {
    const projected = await projectBackup(pageFixture()); const page = [...projected.pages.values()][0]!;
    const missingComment = structuredClone(page) as unknown as { annotations: Record<string, unknown>[] };
    delete missingComment.annotations[0]!.comment;
    const invalid = stableJSON(missingComment);
    await expect(validateBlob(invalid, await contentHash(invalid), 'page', page.sources[0]!.urlKey)).rejects.toThrow('fields');
    const missingPoint = structuredClone(page) as unknown as { anchors: Record<string, unknown>[] };
    delete missingPoint.anchors[0]!.startPoint;
    const badAnchor = stableJSON(missingPoint);
    await expect(validateBlob(badAnchor, await contentHash(badAnchor), 'page', page.sources[0]!.urlKey)).rejects.toThrow('fields');
  });

  it('rejects arbitrary manifest file paths instead of treating them as remote references', () => {
    expect(() => parseManifest(JSON.stringify({ format: 'locus-backup', formatVersion: 4,
      pages: { 'https://example.com': '../../secret' }, settings: 'a'.repeat(64) }))).toThrow('index');
  });
});

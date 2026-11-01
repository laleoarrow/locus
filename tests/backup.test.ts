import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '@/db/repo';
import { getPageSummary, savePageSummaries } from '@/db/editing';
import { db } from '@/db/schema';
import { loadLibrary } from '@/db/library';
import { buildLibrary, EMPTY_FILTERS, filterLibrary } from '@/domain/library';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupFileName,
  parseBackup,
  type BackupFile,
} from '@/domain/backup';
import type { AnchorData, AnnotationRecord } from '@/domain/types';

const anchor: AnchorData = {
  exact: 'selected words',
  prefix: 'The ',
  suffix: ' after',
  start: 4,
  end: 18,
  startPoint: { steps: [{ tag: 'P', index: 0 }], textIndex: 0, offset: 4 },
  endPoint: { steps: [{ tag: 'P', index: 0 }], textIndex: 0, offset: 18 },
};

const URL_A = 'https://example.com/paper?id=1';

function annotationRow(id: string, kind: 'text' | 'image' = 'text'): AnnotationRecord {
  return { id, sourceId: 's', documentId: 'd', kind, color: 'yellow', comment: 'Note',
    exact: kind === 'text' ? anchor.exact : '', createdAt: 1, updatedAt: 1, deletedAt: 0 };
}

async function clearDb() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

beforeEach(clearDb);

describe('parseBackup (U19)', () => {
  const valid: BackupFile = {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    exportedAt: 1,
    appVersion: '0.4.0',
    documents: [],
    sources: [],
    annotations: [],
    anchors: [],
    pageSummaries: [],
    settings: [],
  };

  it('accepts a well-formed file', () => {
    const result = parseBackup(valid);
    expect('file' in result).toBe(true);
    expect(result).toMatchObject({ invalidRowsDropped: false });
  });

  it.each([1, 2])('imports legacy format v%s without page summaries', (formatVersion) => {
    const { pageSummaries: _, ...legacy } = valid;
    const { kind: _kind, ...oldAnnotation } = annotationRow('old-note');
    const result = parseBackup({ ...legacy, formatVersion,
      documents: [{ id: 'd', title: 'Old paper', createdAt: 1, updatedAt: 2 }],
      annotations: [{ ...oldAnnotation, color: 'green' }],
    });
    if (!('file' in result)) throw new Error('expected a legacy file');
    expect(result.file.pageSummaries).toEqual([]);
    expect(result.file.documents).toEqual([{ id: 'd', title: 'Old paper', doi: '', createdAt: 1, updatedAt: 2 }]);
    expect(result.file.annotations).toEqual([{ ...oldAnnotation, kind: 'text', color: 'green' }]);
    expect(result.file.annotations[0]).not.toHaveProperty('colorUpdatedAt');
    expect(result).toMatchObject({ invalidRowsDropped: false });
  });

  it.each(['documents', 'sources', 'annotations', 'anchors', 'pageSummaries'])
    ('reports dropped malformed %s rows while returning the recoverable file', (key) => {
      const result = parseBackup({ ...valid, [key]: [null, {}] });
      expect(result).toMatchObject({ invalidRowsDropped: true, file: { [key]: [] } });
    });

  it.each(['documents', 'sources', 'annotations', 'anchors', 'pageSummaries'])
    ('reports a present non-array %s collection rather than silently treating it as empty', (key) => {
      for (const value of [null, {}]) {
        const result = parseBackup({ ...valid, [key]: value });
        expect(result).toMatchObject({ invalidRowsDropped: true, file: { [key]: [] } });
      }
    });

  it('validates page summary content and conflict clocks', () => {
    const result = parseBackup({
      ...valid,
      formatVersion: 3,
      pageSummaries: [
        { sourceId: 's', content: 'Main findings', updatedAt: 12 },
        { sourceId: 'cleared', content: '', updatedAt: 15 },
        { sourceId: 'missing-content', updatedAt: 16 },
        { sourceId: 'bad-clock', content: 'x', updatedAt: Infinity },
        { sourceId: 'zero-clock', content: 'x', updatedAt: 0 },
        { sourceId: '', content: 'x', updatedAt: 17 },
      ],
    });
    if (!('file' in result)) throw new Error('expected a parsed file');
    expect(result.file.pageSummaries).toEqual([
      { sourceId: 's', content: 'Main findings', updatedAt: 12 },
      { sourceId: 'cleared', content: '', updatedAt: 15 },
    ]);
  });

  it('rejects unrelated JSON and newer formats', () => {
    expect(parseBackup({ hello: 'world' })).toEqual({ error: 'Not a Locus backup file.' });
    expect(parseBackup(null)).toEqual({ error: 'Not a Locus backup file.' });
    expect(parseBackup([])).toEqual({ error: 'Not a Locus backup file.' });
    expect(parseBackup({ ...valid, formatVersion: 99 })).toMatchObject({
      error: expect.stringContaining('newer Locus'),
    });
    expect(parseBackup({ ...valid, formatVersion: 'x' })).toEqual({
      error: 'Backup file has no version.',
    });
  });

  it('drops malformed rows instead of trusting them', () => {
    const result = parseBackup({
      ...valid,
      annotations: [
        annotationRow('ok'),
        { id: 'missing-fields' },
        'not an object',
      ],
      sources: [{ id: 's', documentId: 'd', urlKey: URL_A, url: URL_A, title: 'Paper', firstSeenAt: 1, lastSeenAt: 1 }, { id: 'bad' }],
      anchors: [{ ...anchor, id: 'a', annotationId: 'ok' }, { id: 'ids-only', annotationId: 'ok' }, {}],
    });
    if (!('file' in result)) throw new Error('expected a parsed file');
    expect(result.file.annotations).toHaveLength(1);
    expect(result.file.sources).toHaveLength(1);
    expect(result.file.anchors).toHaveLength(1);
  });

  it('retains legacy text paths and image anchors with optional identity evidence', () => {
    const legacyText = {
      ...anchor, id: 'text', annotationId: 'text-note', start: 1_000_000_000_000, end: 1_000_000_000_014,
      startPoint: { steps: [], textIndex: Number.MAX_SAFE_INTEGER, offset: 0 },
      endPoint: { steps: [], textIndex: Number.MAX_SAFE_INTEGER, offset: 0 },
    };
    const image = { id: 'image', annotationId: 'image-note', kind: 'image',
      src: 'https://example.com/figure.png', alt: '', imgIndex: 0, path: [] };
    const withCount = { ...image, id: 'counted-image', annotationId: 'counted-note', matchCount: 2 };
    const result = parseBackup({ ...valid, anchors: [legacyText, image, withCount],
      annotations: [annotationRow('text-note'), annotationRow('image-note', 'image'), annotationRow('counted-note', 'image')] });
    if (!('file' in result)) throw new Error('expected a parsed file');
    expect(result.file.anchors).toEqual([legacyText, image, withCount]);
  });

  it.each([
    ['missing start point', { startPoint: undefined }],
    ['missing end point', { endPoint: undefined }],
    ['empty quote', { exact: '' }],
    ['blank quote', { exact: ' \n\t' }],
    ['reversed range', { end: 2 }],
    ['empty range', { end: 4 }],
    ['fractional position', { start: 0.5 }],
    ['non-finite position', { end: NaN }],
    ['negative position', { start: -1 }],
    ['missing path steps', { startPoint: { textIndex: 0, offset: 0 } }],
    ['bad path step', { startPoint: { steps: [{ tag: 'P', index: -1 }], textIndex: 0, offset: 0 } }],
    ['empty path tag', { startPoint: { steps: [{ tag: '', index: 0 }], textIndex: 0, offset: 0 } }],
    ['fractional offset', { endPoint: { steps: [], textIndex: 0, offset: 0.5 } }],
    ['negative text node index', { endPoint: { steps: [], textIndex: -1, offset: 0 } }],
  ])('drops a text anchor with %s while preserving a valid neighbour', (_name, patch) => {
    const good = { ...anchor, id: 'good', annotationId: 'good-note' };
    const bad = { ...anchor, id: 'bad', annotationId: 'bad-note', ...patch };
    const result = parseBackup({ ...valid, anchors: [good, bad],
      annotations: [annotationRow('good-note'), annotationRow('bad-note')] });
    if (!('file' in result)) throw new Error('expected a parsed file');
    expect(result.file.anchors).toEqual([good]);
  });

  it.each([
    ['missing path', { path: undefined }],
    ['non-array path', { path: {} }],
    ['bad path step', { path: [{ tag: 'IMG', index: 0.5 }] }],
    ['empty source', { src: '' }],
    ['negative image index', { imgIndex: -1 }],
    ['non-finite image index', { imgIndex: Infinity }],
    ['zero match count', { matchCount: 0 }],
    ['negative match count', { matchCount: -1 }],
    ['fractional match count', { matchCount: 1.5 }],
    ['non-finite match count', { matchCount: Infinity }],
    ['string match count', { matchCount: '1' }],
  ])('drops an image anchor with %s while preserving a valid neighbour', (_name, patch) => {
    const good = { id: 'good-image', annotationId: 'good-note', kind: 'image',
      src: 'https://example.com/figure.png', alt: 'Figure', imgIndex: 0, path: [{ tag: 'IMG', index: 0 }] };
    const result = parseBackup({ ...valid, anchors: [good, { ...good, id: 'bad', annotationId: 'bad-note', ...patch }],
      annotations: [annotationRow('good-note', 'image'), annotationRow('bad-note', 'image')] });
    if (!('file' in result)) throw new Error('expected a parsed file');
    expect(result.file.anchors).toEqual([good]);
  });

  it('drops documents with unsafe required scalars without discarding a valid document', () => {
    const good = { id: 'd', title: '', doi: '', createdAt: 0, updatedAt: 0 };
    const patches: Record<string, unknown>[] = [
      { id: '' }, { title: undefined }, { title: 42 }, { createdAt: undefined },
      { createdAt: -1 }, { createdAt: Infinity }, { updatedAt: undefined }, { updatedAt: -1 },
      { updatedAt: NaN }, { doi: null },
    ];
    for (const patch of patches) {
      const result = parseBackup({ ...valid, documents: [good, { ...good, id: 'bad', ...patch }] });
      if (!('file' in result)) throw new Error('expected a parsed mixed backup');
      expect(result.file.documents, `invalid document ${Object.keys(patch)[0]}`).toEqual([good]);
    }
  });

  it('drops sources with unsafe required scalars without discarding a valid source', () => {
    const good = { id: 's', documentId: 'd', urlKey: URL_A, url: URL_A, title: '', firstSeenAt: 0, lastSeenAt: 0 };
    const patches: Record<string, unknown>[] = [
      { id: '' }, { documentId: '' }, { urlKey: '' }, { url: '' }, { url: undefined },
      { title: undefined }, { title: false }, { firstSeenAt: undefined }, { firstSeenAt: -1 },
      { firstSeenAt: NaN }, { lastSeenAt: undefined }, { lastSeenAt: -1 }, { lastSeenAt: Infinity },
    ];
    for (const patch of patches) {
      const result = parseBackup({ ...valid, sources: [good, { ...good, id: 'bad', ...patch }] });
      if (!('file' in result)) throw new Error('expected a parsed mixed backup');
      expect(result.file.sources, `invalid source ${Object.keys(patch)[0]}`).toEqual([good]);
    }
  });

  it('drops annotations with unsafe scalars and their otherwise well-formed anchors', () => {
    const good = { ...annotationRow('good'), comment: '', createdAt: 0, updatedAt: 0, colorUpdatedAt: 0 };
    const goodAnchor = { ...anchor, id: 'good-anchor', annotationId: good.id };
    const patches: Record<string, unknown>[] = [
      { id: '' }, { sourceId: '' }, { documentId: '' }, { kind: null }, { kind: 'video' },
      { color: '' }, { color: null }, { comment: undefined }, { comment: 42 },
      { exact: undefined }, { exact: '' }, { exact: ' \t' }, { createdAt: undefined },
      { createdAt: -1 }, { createdAt: Infinity }, { updatedAt: undefined }, { updatedAt: -1 },
      { updatedAt: NaN }, { deletedAt: undefined }, { deletedAt: -1 }, { deletedAt: Infinity },
      { colorUpdatedAt: -1 }, { colorUpdatedAt: Infinity }, { colorUpdatedAt: null },
    ];
    for (const patch of patches) {
      const result = parseBackup({ ...valid,
        annotations: [good, { ...good, id: 'bad', ...patch }],
        anchors: [goodAnchor, { ...anchor, id: 'bad-anchor', annotationId: 'bad' }],
      });
      if (!('file' in result)) throw new Error('expected a parsed mixed backup');
      expect(result.file.annotations, `invalid annotation ${Object.keys(patch)[0]}`).toEqual([good]);
      expect(result.file.anchors).toEqual([goodAnchor]);
    }
  });

  it('keeps only anchors linked to a valid annotation of the same kind', () => {
    const goodText = { ...anchor, id: 'text-anchor', annotationId: 'text' };
    const goodImage = { id: 'image-anchor', annotationId: 'image', kind: 'image',
      src: 'https://example.com/figure.png', alt: '', imgIndex: 0, path: [] };
    const result = parseBackup({ ...valid,
      annotations: [annotationRow('text'), annotationRow('image', 'image')],
      anchors: [goodText, goodImage,
        { ...goodText, id: 'missing-parent', annotationId: 'missing' },
        { ...goodText, id: 'wrong-text', annotationId: 'image' },
        { ...goodImage, id: 'wrong-image', annotationId: 'text' }],
    });
    if (!('file' in result)) throw new Error('expected a parsed mixed backup');
    expect(result.file.annotations).toHaveLength(2);
    expect(result.file.anchors).toEqual([goodText, goodImage]);
    expect(result).toMatchObject({ invalidRowsDropped: true });
  });

  it('never carries volatile settings across machines', () => {
    const result = parseBackup({
      ...valid,
      settings: [
        { key: 'customColors', value: [] },
        { key: 'updateInfo', value: { latestVersion: '9.9.9' } },
        { key: 'locus.llm.config', value: { apiKey: 'not-a-real-key' } },
      ],
    });
    if (!('file' in result)) throw new Error('expected a parsed file');
    expect(result.file.settings.map((s) => s.key)).toEqual(['customColors']);
    expect(result).toMatchObject({ invalidRowsDropped: false });
  });

  it('names the download by date', () => {
    expect(backupFileName(new Date(2026, 6, 30))).toBe('locus-backup-2026-07-30.json');
  });
});

describe('validated mixed backup import', () => {
  it('keeps valid notes searchable and refuses a malformed newer row with an existing ID', async () => {
    const source = await repo.ensureSource(URL_A, 'Searchable paper');
    const existing = await repo.createAnnotation({ sourceId: source.id, documentId: source.documentId,
      color: 'yellow', comment: 'Local note to preserve', anchor });
    const good = await repo.createAnnotation({ sourceId: source.id, documentId: source.documentId,
      color: 'teal', comment: 'Searchable valid neighbour', anchor: { ...anchor, exact: 'another phrase' } });
    const file = await repo.exportBackup('test');
    await clearDb();
    await repo.importBackup({ ...file, annotations: [existing.annotation], anchors: [existing.anchor] });
    const parsed = parseBackup({
      ...file,
      annotations: [
        { ...existing.annotation, comment: undefined, updatedAt: existing.annotation.updatedAt + 100 },
        good.annotation,
        { ...good.annotation, id: 'malformed-new', exact: null },
      ],
      anchors: [...file.anchors, { ...good.anchor, id: 'bad-anchor', annotationId: 'malformed-new' }],
      documents: [...file.documents, { id: 'bad-document', title: false, createdAt: 1, updatedAt: 2 }],
      sources: [...file.sources, { ...source, id: 'bad-source', title: null }],
    });
    if (!('file' in parsed)) throw new Error('expected a parsed mixed backup');
    expect(parsed.invalidRowsDropped).toBe(true);
    await repo.importBackup(parsed.file);

    expect(await db.annotations.get(existing.annotation.id)).toEqual(existing.annotation);
    expect(await db.anchors.where('annotationId').equals(existing.annotation.id).first()).toEqual(existing.anchor);
    expect(await db.annotations.get(good.annotation.id)).toEqual(good.annotation);
    expect(await db.annotations.get('malformed-new')).toBeUndefined();
    expect(await db.sources.get('bad-source')).toBeUndefined();
    const input = await loadLibrary();
    const search = () => filterLibrary(buildLibrary(input), { ...EMPTY_FILTERS, query: 'valid neighbour' });
    expect(search).not.toThrow();
    expect(search().flatMap((page) => page.annotations.map((row) => row.id))).toEqual([good.annotation.id]);
  });

  it('imports valid neighbours without replacing a local anchor with malformed data', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    const create = (exact: string, comment: string) => repo.createAnnotation({
      sourceId: source.id, documentId: source.documentId, color: 'yellow', comment,
      anchor: { ...anchor, exact },
    });
    const existing = await create('selected words', 'Local note');
    const good = await create('another phrase', 'Valid incoming note');
    const damaged = await create('broken passage', 'Keep this note even if its anchor is unusable');
    const file = await repo.exportBackup('test');
    await clearDb();
    await repo.importBackup({ ...file, annotations: [existing.annotation], anchors: [existing.anchor] });

    const raw = {
      ...file,
      annotations: file.annotations.map((row) => row.id === existing.annotation.id
        ? { ...row, comment: 'Newer valid note text', updatedAt: row.updatedAt + 100 } : row),
      anchors: file.anchors.map((row) => row.annotationId === existing.annotation.id
        ? { ...row, startPoint: undefined }
        : row.annotationId === damaged.annotation.id ? { ...row, endPoint: undefined } : row),
    };
    const parsed = parseBackup(raw);
    if (!('file' in parsed)) throw new Error('expected a parsed mixed backup');
    await repo.importBackup(parsed.file);

    expect(await db.anchors.where('annotationId').equals(existing.annotation.id).first()).toEqual(existing.anchor);
    expect((await db.annotations.get(existing.annotation.id))?.comment).toBe('Newer valid note text');
    expect(await db.anchors.where('annotationId').equals(good.annotation.id).first()).toEqual(good.anchor);
    expect((await db.annotations.get(good.annotation.id))?.comment).toBe('Valid incoming note');
    expect(await db.annotations.get(damaged.annotation.id)).toBeDefined();
    expect(await db.anchors.where('annotationId').equals(damaged.annotation.id).count()).toBe(0);
    expect((await repo.listForSource(source.id)).map((item) => item.annotation.id).sort())
      .toEqual([existing.annotation.id, good.annotation.id].sort());
  });
});

describe('page summary backup and merge', () => {
  it('round-trips page content separately from annotation notes', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    await repo.createAnnotation({
      sourceId: source.id,
      documentId: source.documentId,
      color: 'yellow',
      comment: 'A note about one passage',
      anchor,
    });
    await savePageSummaries([{ sourceId: source.id, content: '**Main findings**', expectedUpdatedAt: 0 }]);
    const saved = await getPageSummary(source.id);
    const file = await repo.exportBackup('test');
    expect(file.pageSummaries).toEqual([saved]);
    await clearDb();
    const imported = await repo.importBackup(file);
    expect(imported.summariesUpdated).toBe(1);
    expect(await getPageSummary(source.id)).toEqual(saved);
    expect((await repo.listForSource(source.id))[0]?.annotation.comment).toBe('A note about one passage');
    expect((await repo.importBackup(file)).summariesUpdated).toBe(0);
  });

  it('remaps summary source IDs without replacing local page metadata', async () => {
    const sourceA = await repo.ensureSource(URL_A, 'Remote title');
    await db.pageSummaries.put({ sourceId: sourceA.id, content: 'Newer remote summary', updatedAt: 200 });
    const remote = await repo.exportBackup('test');
    await clearDb();
    const sourceB = await repo.ensureSource(`${URL_A}#section`, 'Local title');
    await db.pageSummaries.put({ sourceId: sourceB.id, content: 'Older local summary', updatedAt: 100 });
    const result = await repo.importBackup(remote);
    expect(result.summariesUpdated).toBe(1);
    expect(await db.pageSummaries.toArray()).toEqual([
      { sourceId: sourceB.id, content: 'Newer remote summary', updatedAt: 200 },
    ]);
    expect(await db.sources.get(sourceB.id)).toEqual(sourceB);
    expect(await db.sources.count()).toBe(1);
  });

  it('retains a cleared summary when an older backup is imported', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    await savePageSummaries([{ sourceId: source.id, content: 'Old summary', expectedUpdatedAt: 0 }]);
    const old = await getPageSummary(source.id);
    const oldBackup = await repo.exportBackup('test');
    await savePageSummaries([{ sourceId: source.id, content: '', expectedUpdatedAt: old!.updatedAt }]);
    const cleared = await getPageSummary(source.id);
    const clearedBackup = await repo.exportBackup('test');
    expect(clearedBackup.pageSummaries).toEqual([cleared]);
    await clearDb();
    await repo.importBackup(clearedBackup);
    expect((await repo.importBackup(oldBackup)).summariesUpdated).toBe(0);
    expect(await getPageSummary(source.id)).toEqual(cleared);
  });

  it('converges for equal-clock edits and clearing in either import order', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    const base = await repo.exportBackup('test');
    for (const contents of [['Alpha', 'Zulu'], ['Zulu', 'Alpha'], ['', 'Zulu'], ['Zulu', '']]) {
      await db.pageSummaries.clear();
      for (const content of contents) {
        await repo.importBackup({
          ...base,
          pageSummaries: [{ sourceId: source.id, content, updatedAt: 123 }],
        });
      }
      expect((await getPageSummary(source.id))?.content).toBe(contents.includes('') ? '' : 'Zulu');
    }
  });

  it('ignores orphan summaries and excludes local LLM credentials on every backup path', async () => {
    await db.settings.put({ key: 'locus.llm.config', value: { apiKey: 'not-a-real-key' } });
    const file = await repo.exportBackup('test');
    expect(JSON.stringify(file)).not.toContain('not-a-real-key');
    await clearDb();
    await repo.importBackup({
      ...file,
      pageSummaries: [{ sourceId: 'missing-page', content: 'Orphan', updatedAt: 123 }],
      settings: [{ key: 'locus.llm.config', value: { apiKey: 'not-a-real-key' } }],
    });
    expect(await db.pageSummaries.count()).toBe(0);
    expect(await db.settings.get('locus.llm.config')).toBeUndefined();
  });
});

describe('export/import round trip (U20)', () => {
  it('restores an emptied library exactly', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    const created = await repo.createAnnotation({
      sourceId: source.id,
      documentId: source.documentId,
      color: 'yellow',
      comment: '**note**',
      anchor,
    });
    const file = await repo.exportBackup('0.4.0');
    expect(file.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(file.formatVersion).toBe(3);

    await clearDb();
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(0);

    const summary = await repo.importBackup(file);
    expect(summary.annotationsAdded).toBe(1);
    const { items } = await repo.listForUrl(URL_A);
    expect(items).toHaveLength(1);
    expect(items[0]?.annotation.id).toBe(created.annotation.id);
    expect(items[0]?.annotation.comment).toBe('**note**');
    expect(items[0]?.anchor).toMatchObject({ exact: 'selected words' });
  });

  it('is idempotent — importing twice adds nothing the second time', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    await repo.createAnnotation({
      sourceId: source.id,
      documentId: source.documentId,
      color: 'yellow',
      comment: '',
      anchor,
    });
    const file = await repo.exportBackup('0.4.0');
    const first = await repo.importBackup(file);
    const second = await repo.importBackup(file);
    expect(first.annotationsSkipped).toBe(1); // already identical locally
    expect(second.annotationsAdded).toBe(0);
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(1);
  });

  it('exports tombstones so deletions travel too (U21)', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    const created = await repo.createAnnotation({
      sourceId: source.id,
      documentId: source.documentId,
      color: 'yellow',
      comment: '',
      anchor,
    });
    // Machine A: an old backup where the annotation was still alive.
    const oldBackup = await repo.exportBackup('0.4.0');
    // Machine B (here): the annotation was deleted afterwards.
    await repo.tombstone(created.annotation.id);

    // Importing the older backup must NOT resurrect it.
    const summary = await repo.importBackup(oldBackup);
    expect(summary.annotationsSkipped).toBe(1);
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(0);
    expect((await db.annotations.get(created.annotation.id))?.deletedAt).toBeGreaterThan(0);
  });

  it('propagates a deletion made on the other machine', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    const created = await repo.createAnnotation({
      sourceId: source.id,
      documentId: source.documentId,
      color: 'yellow',
      comment: '',
      anchor,
    });
    await repo.tombstone(created.annotation.id);
    const backupWithDeletion = await repo.exportBackup('0.4.0');
    // Restore the alive state locally, then import the newer deletion.
    await repo.undelete(created.annotation.id);
    await db.annotations.update(created.annotation.id, { updatedAt: 1 });
    const summary = await repo.importBackup(backupWithDeletion);
    expect(summary.annotationsUpdated).toBe(1);
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(0);
  });

  it('merges a legacy remote deletion/note with a later local color change', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    const created = await repo.createAnnotation({
      sourceId: source.id,
      documentId: source.documentId,
      color: 'yellow',
      comment: 'old note',
      anchor,
    });
    const remote = await repo.exportBackup('0.6.2');

    await repo.setAnnotationColor(created.annotation.id, 'teal');
    const localColorChange = await db.annotations.get(created.annotation.id);
    const localColorAt = localColorChange?.colorUpdatedAt ?? 0;
    // A v0.6.x row has no colour clock. Its much newer updatedAt reflects a
    // note/deletion only and must not beat the actual v0.7 recolour.
    const remoteEditAt = localColorAt + 100;
    remote.annotations = remote.annotations.map((annotation) =>
      annotation.id === created.annotation.id
        ? {
            ...annotation,
            color: 'yellow',
            colorUpdatedAt: undefined,
            comment: 'newer remote note',
            deletedAt: remoteEditAt,
            updatedAt: remoteEditAt,
          }
        : annotation,
    );

    const summary = await repo.importBackup(remote);
    const merged = await db.annotations.get(created.annotation.id);
    expect(summary.annotationsUpdated).toBe(1);
    expect(merged).toMatchObject({
      color: 'teal',
      colorUpdatedAt: localColorAt,
      comment: 'newer remote note',
      deletedAt: remoteEditAt,
      updatedAt: remoteEditAt,
    });
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(0);
  });

  it('round-trips page colors and does not resurrect a removed color', async () => {
    const color = {
      key: 'c123456',
      label: '#123456',
      swatch: '#123456',
      bg: 'rgba(18, 52, 86, 0.45)',
    };
    await repo.addPageColor(URL_A, color);
    const beforeRemoval = await repo.exportBackup('0.5.1');
    await repo.removePageColor(URL_A, color.key);
    const afterRemoval = await repo.exportBackup('0.5.1');

    await clearDb();
    const restored = await repo.importBackup(afterRemoval);
    const stale = await repo.importBackup(beforeRemoval);
    expect(restored.settingsUpdated).toBe(2);
    expect(stale.settingsUpdated).toBe(0);
    expect(await repo.getPageColorKeys(URL_A)).toEqual([]);
    expect((await repo.getPrefs()).customColors).toContainEqual(color);
    expect(await repo.getPageColorKeys('https://example.com/other')).toEqual([]);
  });
});

describe('cross-machine merge (U22)', () => {
  it('attaches another machine\'s annotations to the local page via urlKey', async () => {
    // Machine A's library: same URL, but its own document/source UUIDs.
    const sourceA = await repo.ensureSource(URL_A, 'A Paper');
    await repo.createAnnotation({
      sourceId: sourceA.id,
      documentId: sourceA.documentId,
      color: 'teal',
      comment: 'from machine A',
      anchor: { ...anchor, exact: 'machine A text', start: 100, end: 114 },
    });
    const fromA = await repo.exportBackup('0.4.0');

    // Machine B: independent library, same page (fragment/tracking differ).
    await clearDb();
    const sourceB = await repo.ensureSource(`${URL_A}&utm_source=x#sec2`, 'A Paper');
    await repo.createAnnotation({
      sourceId: sourceB.id,
      documentId: sourceB.documentId,
      color: 'yellow',
      comment: 'from machine B',
      anchor,
    });

    const summary = await repo.importBackup(fromA);
    expect(summary.sourcesLinked).toBe(1);
    expect(summary.sourcesAdded).toBe(0);
    expect(summary.annotationsAdded).toBe(1);

    // Both annotations now live on B's single source — no duplicate page.
    expect(await db.sources.count()).toBe(1);
    expect(await db.documents.count()).toBe(1);
    const { items } = await repo.listForUrl(URL_A);
    expect(items.map((i) => i.annotation.comment).sort()).toEqual([
      'from machine A',
      'from machine B',
    ]);
    expect(items.every((i) => i.annotation.sourceId === sourceB.id)).toBe(true);
  });

  it('adds pages the local library has never seen', async () => {
    const source = await repo.ensureSource('https://other.example/x', 'Other');
    await repo.createAnnotation({
      sourceId: source.id,
      documentId: source.documentId,
      color: 'pink',
      comment: '',
      anchor,
    });
    const file = await repo.exportBackup('0.4.0');
    await clearDb();
    const summary = await repo.importBackup(file);
    expect(summary.sourcesAdded).toBe(1);
    expect((await repo.listForUrl('https://other.example/x')).items).toHaveLength(1);
  });

  it('backfills a DOI the local copy never detected', async () => {
    const sourceA = await repo.ensureSource(URL_A, 'A Paper');
    await repo.recordDoi(sourceA.documentId, '10.1097/aln.0000000000002960');
    await repo.createAnnotation({
      sourceId: sourceA.id,
      documentId: sourceA.documentId,
      color: 'yellow',
      comment: '',
      anchor,
    });
    const fromA = await repo.exportBackup('0.4.0');

    await clearDb();
    const sourceB = await repo.ensureSource(URL_A, 'A Paper');
    expect((await db.documents.get(sourceB.documentId))?.doi).toBe('');
    await repo.importBackup(fromA);
    expect((await db.documents.get(sourceB.documentId))?.doi).toBe(
      '10.1097/aln.0000000000002960',
    );
  });

  it('unions list-valued prefs without clobbering local ones', async () => {
    await repo.addCustomColor({
      key: 'caaaaaa',
      label: '#aaaaaa',
      swatch: '#aaaaaa',
      bg: 'rgba(170, 170, 170, 0.45)',
    });
    const file = await repo.exportBackup('0.4.0');
    await clearDb();
    await repo.addCustomColor({
      key: 'cbbbbbb',
      label: '#bbbbbb',
      swatch: '#bbbbbb',
      bg: 'rgba(187, 187, 187, 0.45)',
    });
    await repo.importBackup(file);
    const keys = (await repo.getPrefs()).customColors.map((c) => c.key).sort();
    expect(keys).toEqual(['caaaaaa', 'cbbbbbb']);
  });
});

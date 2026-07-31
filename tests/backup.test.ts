import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupFileName,
  parseBackup,
  type BackupFile,
} from '@/domain/backup';
import type { AnchorData } from '@/domain/types';

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
    settings: [],
  };

  it('accepts a well-formed file', () => {
    const result = parseBackup(valid);
    expect('file' in result).toBe(true);
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
        {
          id: 'ok',
          sourceId: 's',
          documentId: 'd',
          createdAt: 1,
          updatedAt: 1,
          deletedAt: 0,
        },
        { id: 'missing-fields' },
        'not an object',
      ],
      sources: [{ id: 's', documentId: 'd', urlKey: 'k' }, { id: 'bad' }],
      anchors: [{ id: 'a', annotationId: 'ok' }, {}],
    });
    if (!('file' in result)) throw new Error('expected a parsed file');
    expect(result.file.annotations).toHaveLength(1);
    expect(result.file.sources).toHaveLength(1);
    expect(result.file.anchors).toHaveLength(1);
  });

  it('never carries volatile settings across machines', () => {
    const result = parseBackup({
      ...valid,
      settings: [
        { key: 'customColors', value: [] },
        { key: 'updateInfo', value: { latestVersion: '9.9.9' } },
      ],
    });
    if (!('file' in result)) throw new Error('expected a parsed file');
    expect(result.file.settings.map((s) => s.key)).toEqual(['customColors']);
  });

  it('names the download by date', () => {
    expect(backupFileName(new Date(2026, 6, 30))).toBe('locus-backup-2026-07-30.json');
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
    expect(file.formatVersion).toBe(2);

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

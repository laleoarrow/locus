import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import {
  effectiveColorUpdatedAt,
  type AnchorData,
  type ColorKey,
  type CustomColor,
} from '@/domain/types';

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

async function createOne(color: ColorKey = 'yellow') {
  const source = await repo.ensureSource(URL_A, 'A Paper');
  return repo.createAnnotation({
    sourceId: source.id,
    documentId: source.documentId,
    color,
    comment: '',
    anchor,
  });
}

async function colorExpectation(color: ColorKey) {
  return (await db.annotations.where('deletedAt').equals(0).toArray())
    .filter((annotation) => annotation.color === color)
    .map((annotation) => ({
      id: annotation.id,
      updatedAt: annotation.updatedAt,
      colorUpdatedAt: effectiveColorUpdatedAt(annotation),
    }));
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('repo (U8–U10)', () => {
  it('creates source+document once per urlKey', async () => {
    const first = await repo.ensureSource(URL_A + '#frag', 'A Paper');
    const second = await repo.ensureSource(URL_A + '&utm_source=x', 'A Paper');
    expect(second.id).toBe(first.id);
    expect(await db.documents.count()).toBe(1);
  });

  it('creates annotation and anchor atomically and lists them (U8)', async () => {
    const created = await createOne();
    const { items } = await repo.listForUrl(URL_A);
    expect(items).toHaveLength(1);
    expect(items[0]?.annotation.id).toBe(created.annotation.id);
    expect(items[0]?.anchor).toMatchObject({ exact: 'selected words' });
  });

  it('tombstones on delete and restores on undelete; never removes rows (U9)', async () => {
    const created = await createOne();
    await repo.tombstone(created.annotation.id);
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(0);
    // Row still exists (tombstone), including its anchor.
    expect(await db.annotations.get(created.annotation.id)).toBeDefined();
    expect(await db.anchors.where('annotationId').equals(created.annotation.id).count()).toBe(1);
    await repo.undelete(created.annotation.id);
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(1);
  });

  it('deletes and restores a batch atomically (U37)', async () => {
    const first = await createOne();
    const second = await createOne('teal');

    await expect(
      repo.tombstoneMany([first.annotation.id, 'missing-annotation']),
    ).rejects.toThrow();
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(2);

    await repo.tombstoneMany([first.annotation.id, second.annotation.id]);
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(0);
    expect(await db.annotations.count()).toBe(2);

    await repo.undeleteMany([first.annotation.id, second.annotation.id]);
    expect((await repo.listForUrl(URL_A)).items).toHaveLength(2);
  });

  it('replaces a live color across the library, including detached but not deleted rows', async () => {
    const first = await createOne();
    const second = await createOne();
    const deleted = await createOne();
    const existingTarget = await createOne('teal');
    await repo.tombstone(deleted.annotation.id);
    await db.anchorStates.put({
      annotationId: second.annotation.id,
      detached: true,
      checkedAt: Date.now(),
    });

    const result = await repo.replaceAnnotationColor(
      'yellow',
      'teal',
      2,
      await colorExpectation('yellow'),
    );
    expect(result.updated).toBe(2);
    expect(result.annotationIds.sort()).toEqual(
      [first.annotation.id, second.annotation.id].sort(),
    );

    const rows = await db.annotations.toArray();
    expect(rows.filter((row) => row.deletedAt === 0 && row.color === 'teal')).toHaveLength(3);
    expect((await db.annotations.get(deleted.annotation.id))?.color).toBe('yellow');
    expect((await db.anchorStates.get(second.annotation.id))?.detached).toBe(true);
    expect((await db.annotations.get(existingTarget.annotation.id))?.updatedAt).toBe(
      existingTarget.annotation.updatedAt,
    );

    db.close();
    await db.open();
    expect((await db.annotations.get(first.annotation.id))?.color).toBe('teal');
    expect((await db.annotations.get(second.annotation.id))?.color).toBe('teal');
  });

  it('does nothing when source and target match or the source count is zero', async () => {
    const created = await createOne();
    const before = await db.annotations.get(created.annotation.id);

    await expect(
      repo.replaceAnnotationColor('yellow', 'yellow', 1, await colorExpectation('yellow')),
    ).resolves.toEqual({
      updated: 0,
      annotationIds: [],
    });
    await expect(repo.replaceAnnotationColor('pink', 'teal', 0, [])).resolves.toEqual({
      updated: 0,
      annotationIds: [],
    });
    expect(await db.annotations.get(created.annotation.id)).toEqual(before);
  });

  it('uses the same color mutation rule for a single live annotation', async () => {
    const first = await createOne();
    const second = await createOne();

    await expect(repo.setAnnotationColor(first.annotation.id, 'teal')).resolves.toBe(true);
    const recolored = await db.annotations.get(first.annotation.id);
    expect(recolored?.color).toBe('teal');
    expect((await db.annotations.get(second.annotation.id))?.color).toBe('yellow');
    expect(recolored?.updatedAt).toBe(first.annotation.updatedAt);
    expect(recolored?.colorUpdatedAt).toBeGreaterThan(
      effectiveColorUpdatedAt(first.annotation),
    );
  });

  it('accepts the exact preview for a legacy row whose note was edited later', async () => {
    const created = await createOne();
    const legacyUpdatedAt = created.annotation.updatedAt + 100;
    await db.annotations.update(created.annotation.id, {
      colorUpdatedAt: undefined,
      comment: 'edited before upgrading',
      updatedAt: legacyUpdatedAt,
    });

    await expect(
      repo.replaceAnnotationColor(
        'yellow',
        'teal',
        1,
        await colorExpectation('yellow'),
      ),
    ).resolves.toMatchObject({ updated: 1 });
    expect(await db.annotations.get(created.annotation.id)).toMatchObject({
      color: 'teal',
      comment: 'edited before upgrading',
      updatedAt: legacyUpdatedAt,
    });
  });

  it('rejects a stale preview snapshot and a target outside the existing palette', async () => {
    const first = await createOne();
    const second = await createOne();
    const before = await db.annotations.bulkGet([
      first.annotation.id,
      second.annotation.id,
    ]);

    await expect(
      repo.replaceAnnotationColor('yellow', 'teal', 1, [
        {
          id: first.annotation.id,
          updatedAt: first.annotation.updatedAt,
          colorUpdatedAt: effectiveColorUpdatedAt(first.annotation),
        },
      ]),
    ).rejects.toThrow(
      'annotations changed',
    );
    await expect(
      repo.replaceAnnotationColor(
        'yellow',
        'not-a-palette-color',
        2,
        await colorExpectation('yellow'),
      ),
    ).rejects.toThrow('not in the current Locus palette');
    expect(await db.annotations.bulkGet([first.annotation.id, second.annotation.id])).toEqual(
      before,
    );
  });

  it('rejects a different source set even when its live count is unchanged', async () => {
    const first = await createOne();
    const second = await createOne();
    const expected = await colorExpectation('yellow');

    await repo.tombstone(first.annotation.id);
    const replacement = await createOne();
    await expect(
      repo.replaceAnnotationColor('yellow', 'teal', 2, expected),
    ).rejects.toThrow('annotations changed');

    expect((await db.annotations.get(first.annotation.id))?.color).toBe('yellow');
    expect((await db.annotations.get(second.annotation.id))?.color).toBe('yellow');
    expect((await db.annotations.get(replacement.annotation.id))?.color).toBe('yellow');
  });

  it('rolls the whole color replacement back when a later row write fails', async () => {
    const first = await createOne();
    const second = await createOne();
    const before = await db.annotations.bulkGet([
      first.annotation.id,
      second.annotation.id,
    ]);
    let writes = 0;
    const failSecondWrite = () => {
      writes += 1;
      if (writes === 2) throw new Error('injected database failure');
    };
    db.annotations.hook('updating', failSecondWrite);
    try {
      await expect(
        repo.replaceAnnotationColor(
          'yellow',
          'teal',
          2,
          await colorExpectation('yellow'),
        ),
      ).rejects.toThrow('injected database failure');
    } finally {
      db.annotations.hook('updating').unsubscribe(failSecondWrite);
    }

    expect(await db.annotations.bulkGet([first.annotation.id, second.annotation.id])).toEqual(
      before,
    );
  });

  it('remembers the last-used color (U10)', async () => {
    expect(await repo.getLastColor()).toBe('yellow');
    await createOne('teal');
    expect(await repo.getLastColor()).toBe('teal');
  });

  it('persists prefs: placement, custom colors, site list, toggles (U15)', async () => {
    expect(await repo.getPrefs()).toEqual({
      placement: 'below',
      customColors: [],
      disabledSites: [],
      detectDoi: true,
      checkUpdates: true,
    });
    await repo.setPlacement('auto');
    const color = { key: 'c336699', label: '#336699', swatch: '#336699', bg: 'rgba(51, 102, 153, 0.45)' };
    await repo.addCustomColor(color);
    await repo.addCustomColor(color); // dedupe
    await repo.setSiteDisabled('https://example.com', true);
    await repo.setSiteDisabled('https://example.com', true); // dedupe
    await repo.setDetectDoi(false);
    const prefs = await repo.getPrefs();
    expect(prefs).toEqual({
      placement: 'auto',
      customColors: [color],
      disabledSites: ['https://example.com'],
      detectDoi: false,
      checkUpdates: true,
    });
    await repo.setSiteDisabled('https://example.com', false);
    await repo.removeCustomColor('c336699');
    expect((await repo.getPrefs()).customColors).toEqual([]);
    expect((await repo.getPrefs()).disabledSites).toEqual([]);
  });

  it('keeps manually added colors on their page and preserves page removals', async () => {
    const colors: CustomColor[] = ['#111111', '#222222', '#333333'].map((hex) => ({
      key: `c${hex.slice(1)}`,
      label: hex,
      swatch: hex,
      bg: 'rgba(1, 1, 1, 0.45)',
    }));
    for (const color of colors) await repo.addPageColor(URL_A, color);

    expect(await repo.getPageColorKeys(URL_A)).toEqual(colors.map((color) => color.key));
    expect(await repo.getPageColorKeys(`${URL_A}#section`)).toEqual(
      colors.map((color) => color.key),
    );
    expect(await repo.getPageColorKeys('https://example.com/other')).toEqual([]);
    expect((await repo.getPrefs()).customColors.map((color) => color.key)).toEqual(
      colors.map((color) => color.key),
    );

    await repo.removePageColor(URL_A, colors[1]?.key ?? '');
    expect(await repo.getPageColorKeys(URL_A)).toEqual([colors[0]?.key, colors[2]?.key]);
    // Removing a toolbar choice must not remove the rendering definition.
    expect((await repo.getPrefs()).customColors).toHaveLength(3);
  });

  it('lazily seeds a legacy page with at most two custom colors it already uses', async () => {
    const colors: CustomColor[] = ['#441111', '#442222', '#443333'].map((hex) => ({
      key: `c${hex.slice(1)}`,
      label: hex,
      swatch: hex,
      bg: 'rgba(68, 1, 1, 0.45)',
    }));
    for (const color of colors) {
      await repo.addCustomColor(color);
      await createOne(color.key);
    }

    expect(await repo.getPageColorKeys(URL_A)).toEqual([
      colors[0]?.key,
      colors[1]?.key,
    ]);
    expect(await repo.getPageColorKeys('https://example.com/new-page')).toEqual([]);
  });

  it('persists the Library group mode and rejects an invalid stored value (U36)', async () => {
    expect(await repo.getLibraryMode()).toBe('page');
    await repo.setLibraryMode('timeline');
    expect(await repo.getLibraryMode()).toBe('timeline');

    await db.settings.put({ key: 'libraryGroupMode', value: 'columns' });
    expect(await repo.getLibraryMode()).toBe('page');
  });

  it('records DOIs and finds annotated alternate versions (U18)', async () => {
    const a = await repo.ensureSource('https://publisher.example/paper', 'Paper (publisher)');
    const b = await repo.ensureSource('https://mirror.example/pmc/1', 'Paper (mirror)');
    await repo.recordDoi(a.documentId, '10.1097/aln.0000000000002960');
    await repo.recordDoi(b.documentId, '10.1097/aln.0000000000002960');
    // No annotations on A yet → no alt version for B.
    expect(await repo.findAltVersion('10.1097/aln.0000000000002960', b.documentId)).toBeNull();
    await repo.createAnnotation({
      sourceId: a.id,
      documentId: a.documentId,
      color: 'yellow',
      comment: '',
      anchor,
    });
    const alt = await repo.findAltVersion('10.1097/aln.0000000000002960', b.documentId);
    expect(alt?.url).toBe('https://publisher.example/paper');
    expect(alt?.count).toBe(1);
    // A sees no alternate (B has no annotations).
    expect(await repo.findAltVersion('10.1097/aln.0000000000002960', a.documentId)).toBeNull();
  });

  it('stores image annotations with kind and alt as exact (U11)', async () => {
    const source = await repo.ensureSource(URL_A, 'A Paper');
    const created = await repo.createAnnotation({
      sourceId: source.id,
      documentId: source.documentId,
      color: 'yellow',
      comment: '',
      anchor: {
        kind: 'image',
        src: 'https://example.com/fig1.png',
        alt: 'study diagram',
        imgIndex: 0,
        path: [{ tag: 'ARTICLE', index: 0 }, { tag: 'IMG', index: 0 }],
      },
    });
    expect(created.annotation.kind).toBe('image');
    expect(created.annotation.exact).toBe('study diagram');
    const { items } = await repo.listForUrl(URL_A);
    expect(items[0]?.anchor.kind).toBe('image');
  });
});

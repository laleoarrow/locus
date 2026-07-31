import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import type { AnchorData, ColorKey, CustomColor } from '@/domain/types';

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

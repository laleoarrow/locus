import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import { parsePageNoteZip } from '@/domain/pagenote';
import type { CustomColor } from '@/domain/types';

const PAGE_URL = 'https://example.com/paper?utm_source=pagenote#results';

async function clearDb() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

beforeEach(clearDb);

async function pageNoteZip({
  lights = [],
  notes = [],
  prefix = '',
}: {
  lights?: Record<string, unknown>[];
  notes?: Record<string, unknown>[];
  prefix?: string;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    `${prefix}webpage/page.json`,
    JSON.stringify({
      version: 12,
      tables: {
        webpage: [
          {
            key: 'page-1',
            url: PAGE_URL,
            source: PAGE_URL,
            title: 'Imported paper',
            createAt: 100,
            updateAt: 200,
            deleted: false,
          },
        ],
      },
    }),
  );
  zip.file(
    `${prefix}light/lights.json`,
    JSON.stringify({ version: 12, tables: { light: lights } }),
  );
  zip.file(
    `${prefix}note.json`,
    JSON.stringify({ version: 12, tables: { note: notes } }),
  );
  return zip.generateAsync({ type: 'uint8array' });
}

function light(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'light-1',
    webpageKey: 'page-1',
    url: PAGE_URL,
    source: PAGE_URL,
    text: 'Mediator',
    pre: 'This is more than thirty-two characters of prefix context: ',
    suffix: ' followed by enough suffix context to identify the quote',
    bg: '#FFE534',
    tip: '**PageNote tip**',
    createAt: 120,
    updateAt: 140,
    deleted: false,
    lightType: 'light',
    ...overrides,
  };
}

describe('PageNote ZIP adapter', () => {
  it('preserves pages, quotes, comments, colors, timestamps, and import warnings', async () => {
    const archive = await pageNoteZip({
      prefix: 'manual.v10.pagenote/',
      lights: [
        light({ comment: 'Second note field' }),
        light({
          key: 'light-2',
          pre: 'A different prefix for the same selected word',
          suffix: ' and a different suffix',
        }),
        light({
          key: 'light-3',
          text: 'selected',
          tip: '',
          noteKey: 'linked-note',
          bg: '#A6FFE9',
          lightType: 'del',
          textPosition: { start: 42, end: 50 },
        }),
      ],
      notes: [
        {
          key: 'linked-note',
          markdown: 'Note stored in the PageNote note table',
          deleted: false,
        },
        {
          key: 'page-note',
          source: PAGE_URL,
          markdown: 'Standalone body',
          deleted: false,
        },
        {
          key: 'global-memo',
          source: '',
          markdown: '',
          tiptap: { type: 'doc', content: [{ type: 'paragraph' }] },
          deleted: false,
        },
      ],
    });

    const result = await parsePageNoteZip(archive, '0.4.1');
    if (!('file' in result)) throw new Error(result.error);

    expect(result.file.appVersion).toBe('PageNote → Locus 0.4.1');
    expect(result.file.documents).toHaveLength(1);
    expect(result.file.sources).toHaveLength(1);
    expect(result.file.sources[0]).toMatchObject({
      url: PAGE_URL,
      urlKey: 'https://example.com/paper',
      title: 'Imported paper',
    });
    expect(result.file.annotations).toHaveLength(3);
    expect(result.file.annotations[0]).toMatchObject({
      id: 'pagenote:light:light-1',
      exact: 'Mediator',
      comment: '**PageNote tip**\n\nSecond note field',
      color: 'cffe534',
      createdAt: 120,
      updatedAt: 140,
    });
    const firstAnchor = result.file.anchors[0];
    const secondAnchor = result.file.anchors[1];
    const positionedAnchor = result.file.anchors[2];
    if (
      !firstAnchor ||
      !secondAnchor ||
      !positionedAnchor ||
      firstAnchor.kind === 'image' ||
      secondAnchor.kind === 'image' ||
      positionedAnchor.kind === 'image'
    ) {
      throw new Error('expected text anchors');
    }
    expect(firstAnchor).toMatchObject({
      exact: 'Mediator',
      prefix: expect.stringMatching(/^.{32}$/s),
      suffix: ' followed by enough suffix conte',
    });
    expect(firstAnchor.start).not.toBe(secondAnchor.start);
    expect(positionedAnchor).toMatchObject({ start: 42, end: 50 });
    expect(result.file.annotations[2]?.comment).toBe(
      'Note stored in the PageNote note table',
    );

    const colors = result.file.settings[0]?.value as CustomColor[];
    expect(colors.map((color) => color.key).sort()).toEqual(['ca6ffe9', 'cffe534']);
    expect(result.stats).toEqual({
      highlights: 3,
      deletedHighlights: 0,
      highlightNotes: 3,
      recordsSkipped: 0,
      emptyNotesSkipped: 1,
      standaloneNotesSkipped: 1,
      degradedStrikethroughs: 1,
    });
  });

  it('uses stable IDs so repeated imports are idempotent and newer PageNote edits win', async () => {
    const firstResult = await parsePageNoteZip(
      await pageNoteZip({
        lights: [
          light(),
          light({
            key: 'light-2',
            pre: 'Different occurrence prefix',
            suffix: 'Different occurrence suffix',
          }),
        ],
      }),
      '0.4.1',
    );
    if (!('file' in firstResult)) throw new Error(firstResult.error);

    const first = await repo.importBackup(firstResult.file);
    const repeated = await repo.importBackup(firstResult.file);
    expect(first.annotationsAdded).toBe(2);
    expect(repeated.annotationsAdded).toBe(0);
    expect(repeated.annotationsSkipped).toBe(2);
    expect((await repo.listForUrl('https://example.com/paper')).items).toHaveLength(2);

    const updatedResult = await parsePageNoteZip(
      await pageNoteZip({
        lights: [
          light({ tip: 'Updated note', updateAt: 300 }),
          light({
            key: 'light-2',
            pre: 'Different occurrence prefix',
            suffix: 'Different occurrence suffix',
          }),
        ],
      }),
      '0.4.1',
    );
    if (!('file' in updatedResult)) throw new Error(updatedResult.error);
    const updated = await repo.importBackup(updatedResult.file);
    expect(updated.annotationsUpdated).toBe(1);
    expect((await db.annotations.get('pagenote:light:light-1'))?.comment).toBe('Updated note');
  });

  it('uses the linked note timestamp when its body changes', async () => {
    const makeArchive = (markdown: string, updateAt: number) =>
      pageNoteZip({
        lights: [light({ tip: '', noteKey: 'linked-note' })],
        notes: [{ key: 'linked-note', markdown, updateAt, deleted: false }],
      });
    const first = await parsePageNoteZip(await makeArchive('First body', 150), '0.4.1');
    if (!('file' in first)) throw new Error(first.error);
    await repo.importBackup(first.file);
    expect((await db.annotations.get('pagenote:light:light-1'))?.comment).toBe('First body');

    const second = await parsePageNoteZip(await makeArchive('Revised body', 300), '0.4.1');
    if (!('file' in second)) throw new Error(second.error);
    expect((await repo.importBackup(second.file)).annotationsUpdated).toBe(1);
    expect((await db.annotations.get('pagenote:light:light-1'))?.comment).toBe('Revised body');

    const deleted = await parsePageNoteZip(
      await pageNoteZip({
        lights: [light({ tip: '', noteKey: 'linked-note' })],
        notes: [{ key: 'linked-note', markdown: '', updateAt: 400, deleted: true }],
      }),
      '0.4.1',
    );
    if (!('file' in deleted)) throw new Error(deleted.error);
    expect((await repo.importBackup(deleted.file)).annotationsUpdated).toBe(1);
    expect((await db.annotations.get('pagenote:light:light-1'))?.comment).toBe('');
  });

  it('keeps linked-note time separate from the PageNote highlight color clock', async () => {
    const makeArchive = (
      bg: string,
      highlightUpdatedAt: number,
      markdown: string,
      noteUpdatedAt: number,
    ) =>
      pageNoteZip({
        lights: [
          light({
            tip: '',
            noteKey: 'linked-note',
            bg,
            updateAt: highlightUpdatedAt,
          }),
        ],
        notes: [
          {
            key: 'linked-note',
            markdown,
            updateAt: noteUpdatedAt,
            deleted: false,
          },
        ],
      });

    const first = await parsePageNoteZip(
      await makeArchive('#FFE534', 140, 'First body', 150),
      '0.7.0',
    );
    if (!('file' in first)) throw new Error(first.error);
    await repo.importBackup(first.file);
    await db.annotations.update('pagenote:light:light-1', {
      color: 'teal',
      colorUpdatedAt: 200,
    });

    const noteOnly = await parsePageNoteZip(
      await makeArchive('#FFE534', 140, 'Revised body', 300),
      '0.7.0',
    );
    if (!('file' in noteOnly)) throw new Error(noteOnly.error);
    await repo.importBackup(noteOnly.file);
    expect(await db.annotations.get('pagenote:light:light-1')).toMatchObject({
      color: 'teal',
      colorUpdatedAt: 200,
      comment: 'Revised body',
      updatedAt: 300,
    });

    const recolored = await parsePageNoteZip(
      await makeArchive('#112233', 400, 'Revised body', 300),
      '0.7.0',
    );
    if (!('file' in recolored)) throw new Error(recolored.error);
    await repo.importBackup(recolored.file);
    expect(await db.annotations.get('pagenote:light:light-1')).toMatchObject({
      color: 'c112233',
      colorUpdatedAt: 400,
      comment: 'Revised body',
      updatedAt: 400,
    });
  });

  it('rejects unrelated ZIPs and skips deleted or incomplete highlights', async () => {
    const unrelated = new JSZip();
    unrelated.file('readme.txt', 'not PageNote');
    expect(
      await parsePageNoteZip(await unrelated.generateAsync({ type: 'uint8array' }), '0.4.1'),
    ).toEqual({ error: 'That ZIP is not a PageNote backup.' });

    const result = await parsePageNoteZip(
      await pageNoteZip({
        lights: [
          light({ key: 'deleted', deleted: true }),
          light({ key: 'no-url', url: '', source: '', webpageKey: '' }),
          light({ key: 'blank', text: '   ' }),
        ],
      }),
      '0.4.1',
    );
    if (!('file' in result)) throw new Error(result.error);
    expect(result.file.annotations).toHaveLength(1);
    expect(result.file.annotations[0]?.deletedAt).toBeGreaterThan(0);
    expect(result.stats.deletedHighlights).toBe(1);
    expect(result.stats.recordsSkipped).toBe(2);
  });

  it('propagates PageNote deletions and never resurrects them from an older ZIP', async () => {
    const active = await parsePageNoteZip(
      await pageNoteZip({
        lights: [light({ key: 'light-delete', updateAt: 150 })],
      }),
      '0.4.1',
    );
    if (!('file' in active)) throw new Error(active.error);
    await repo.importBackup(active.file);
    expect((await repo.listForUrl('https://example.com/paper')).items).toHaveLength(1);

    const deleted = await parsePageNoteZip(
      await pageNoteZip({
        lights: [light({ key: 'light-delete', updateAt: 200, deleted: true })],
      }),
      '0.4.1',
    );
    if (!('file' in deleted)) throw new Error(deleted.error);
    expect((await repo.importBackup(deleted.file)).annotationsUpdated).toBe(1);
    expect((await repo.listForUrl('https://example.com/paper')).items).toHaveLength(0);

    expect((await repo.importBackup(active.file)).annotationsSkipped).toBe(1);
    expect((await repo.listForUrl('https://example.com/paper')).items).toHaveLength(0);
  });

  it('rejects an oversized JSON entry before reading its contents', async () => {
    const zip = new JSZip();
    zip.file('light/huge.json', 'x'.repeat(5 * 1024 * 1024 + 1));
    const result = await parsePageNoteZip(
      await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
      '0.4.1',
    );
    expect(result).toEqual({ error: 'PageNote entry is too large: light/huge.json' });
  });
});

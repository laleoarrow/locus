import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editAnnotations, getPageSummary, savePageSummaries } from '@/db/editing';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import type { AnnotationEditExpectation } from '@/domain/editing';
import { effectiveColorUpdatedAt, type AnchorData, type AnnotationRecord } from '@/domain/types';

const anchor: AnchorData = {
  exact: 'selected words',
  prefix: 'The ',
  suffix: ' after',
  start: 4,
  end: 18,
  startPoint: { steps: [{ tag: 'P', index: 0 }], textIndex: 0, offset: 4 },
  endPoint: { steps: [{ tag: 'P', index: 0 }], textIndex: 0, offset: 18 },
};

async function createOne(comment = ''): Promise<AnnotationRecord> {
  const source = await repo.ensureSource('https://example.com/selected-edits', 'A Paper');
  const { annotation } = await repo.createAnnotation({
    sourceId: source.id,
    documentId: source.documentId,
    color: 'yellow',
    comment,
    anchor,
  });
  return annotation;
}

function expected(annotation: AnnotationRecord): AnnotationEditExpectation {
  return {
    id: annotation.id,
    updatedAt: annotation.updatedAt,
    colorUpdatedAt: effectiveColorUpdatedAt(annotation),
    deletedAt: annotation.deletedAt,
  };
}

async function readAnnotation(id: string): Promise<AnnotationRecord> {
  const annotation = await db.annotations.get(id);
  if (!annotation) throw new Error(`Missing annotation ${id}`);
  return annotation;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('selected annotation edits', () => {
  it('keeps existing note/delete/restore mutations monotonic within the same millisecond', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const original = await createOne('original note');
      await repo.setComment(original.id, 'edited note');
      const edited = await readAnnotation(original.id);
      expect(edited.updatedAt).toBeGreaterThan(original.updatedAt);
      expect(edited).toMatchObject({ comment: 'edited note', deletedAt: 0, colorUpdatedAt: original.colorUpdatedAt });
      await expect(editAnnotations([expected(original)], { type: 'comment', mode: 'replace', comment: 'stale note' })).rejects.toThrow();

      await repo.tombstone(original.id);
      const deleted = await readAnnotation(original.id);
      expect(deleted.updatedAt).toBeGreaterThan(edited.updatedAt);
      expect(deleted.deletedAt).toBe(deleted.updatedAt);
      expect(deleted).toMatchObject({ comment: 'edited note', colorUpdatedAt: original.colorUpdatedAt });
      await expect(editAnnotations([expected(edited)], { type: 'restore' })).rejects.toThrow();

      await repo.undelete(original.id);
      const restored = await readAnnotation(original.id);
      expect(restored.updatedAt).toBeGreaterThan(deleted.updatedAt);
      expect(restored).toMatchObject({ comment: 'edited note', deletedAt: 0, colorUpdatedAt: original.colorUpdatedAt });
      await expect(editAnnotations([expected(deleted)], { type: 'delete' })).rejects.toThrow();
      // Restoring returns to the same content/state, but must not revive an
      // expectation captured before the intervening delete and restore.
      await expect(editAnnotations([expected(edited)], { type: 'comment', mode: 'replace', comment: 'stale note' })).rejects.toThrow();
      expect(await readAnnotation(original.id)).toEqual(restored);
    } finally {
      clock.mockRestore();
    }
  });

  it('recolors only selected rows using the independent color clock', async () => {
    const first = await createOne('first note');
    const second = await createOne('second note');
    const untouched = await createOne('unselected note');
    const futureClock = Date.now() + 10_000;
    await db.annotations.update(first.id, { colorUpdatedAt: futureClock });
    const before = await readAnnotation(first.id);
    const anchorsBefore = await db.anchors.toArray();

    const result = await editAnnotations([expected(before), expected(second)], { type: 'color', color: 'teal' });

    expect(result.updated).toBe(2);
    expect(result.annotationIds.sort()).toEqual([first.id, second.id].sort());
    const recolored = await readAnnotation(first.id);
    expect(recolored.colorUpdatedAt).toBeGreaterThan(futureClock);
    expect(recolored).toEqual({ ...before, color: 'teal', colorUpdatedAt: recolored.colorUpdatedAt });
    expect(await readAnnotation(second.id)).toMatchObject({ color: 'teal', comment: second.comment, updatedAt: second.updatedAt });
    expect(await readAnnotation(untouched.id)).toEqual(untouched);
    expect(await db.anchors.toArray()).toEqual(anchorsBefore);
  });

  it('accepts the effective legacy color clock without changing the note clock', async () => {
    const annotation = await createOne('legacy note');
    await db.annotations.update(annotation.id, { colorUpdatedAt: undefined });
    const legacy = await readAnnotation(annotation.id);

    await editAnnotations([expected(legacy)], { type: 'color', color: 'pink' });

    expect(await readAnnotation(annotation.id)).toMatchObject({
      color: 'pink',
      updatedAt: legacy.updatedAt,
      comment: legacy.comment,
    });
    expect((await readAnnotation(annotation.id)).colorUpdatedAt).toBeGreaterThan(legacy.createdAt);
  });

  it('appends a trimmed note and preserves existing text and unselected rows', async () => {
    const first = await createOne('  original  ');
    const second = await createOne();
    const untouched = await createOne('untouched');

    await editAnnotations([expected(first), expected(second)], { type: 'comment', mode: 'append', comment: ' \n new note \n ' });

    const appended = await readAnnotation(first.id);
    expect(appended.comment).toBe('  original  \n\nnew note');
    expect(appended.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(appended.colorUpdatedAt).toBe(first.colorUpdatedAt);
    expect((await readAnnotation(second.id)).comment).toBe('new note');
    expect(await readAnnotation(untouched.id)).toEqual(untouched);
  });

  it('preserves literal replacement text and allows an intentional empty replacement', async () => {
    const annotation = await createOne('old note');
    await editAnnotations([expected(annotation)], { type: 'comment', mode: 'replace', comment: '  replacement\n' });
    const replaced = await readAnnotation(annotation.id);
    expect(replaced.comment).toBe('  replacement\n');

    await editAnnotations([expected(replaced)], { type: 'comment', mode: 'replace', comment: '' });
    const cleared = await readAnnotation(annotation.id);
    expect(cleared.comment).toBe('');
    expect(cleared.updatedAt).toBeGreaterThan(replaced.updatedAt);
    expect(cleared.colorUpdatedAt).toBe(annotation.colorUpdatedAt);
  });

  it('does not advance clocks for unchanged color, blank append, or unchanged replacement', async () => {
    const annotation = await createOne('original');
    for (const action of [
      { type: 'color', color: 'yellow' },
      { type: 'comment', mode: 'append', comment: ' \n ' },
      { type: 'comment', mode: 'replace', comment: 'original' },
      { type: 'restore' },
    ] as const) {
      await expect(editAnnotations([expected(annotation)], action)).resolves.toEqual({ updated: 0, annotationIds: [] });
      expect(await readAnnotation(annotation.id)).toEqual(annotation);
    }
  });

  it('deletes and restores selected rows without removing anchors or changing other rows', async () => {
    const first = await createOne('keep this note');
    const second = await createOne();
    const untouched = await createOne();
    const futureClock = Date.now() + 10_000;
    await db.annotations.update(first.id, { updatedAt: futureClock });
    const before = await readAnnotation(first.id);
    const anchorsBefore = await db.anchors.toArray();

    await editAnnotations([expected(before), expected(second)], { type: 'delete' });
    const deleted = await readAnnotation(first.id);
    expect(deleted.deletedAt).toBeGreaterThan(futureClock);
    expect(deleted.updatedAt).toBe(deleted.deletedAt);
    expect(deleted.comment).toBe(first.comment);
    expect(deleted.colorUpdatedAt).toBe(first.colorUpdatedAt);
    await expect(editAnnotations([expected(deleted)], { type: 'delete' })).resolves.toEqual({ updated: 0, annotationIds: [] });
    expect(await readAnnotation(first.id)).toEqual(deleted);

    await editAnnotations([expected(deleted), expected(await readAnnotation(second.id))], { type: 'restore' });
    const restored = await readAnnotation(first.id);
    expect(restored.deletedAt).toBe(0);
    expect(restored.updatedAt).toBeGreaterThan(deleted.updatedAt);
    expect(restored.colorUpdatedAt).toBe(first.colorUpdatedAt);
    expect(await readAnnotation(untouched.id)).toEqual(untouched);
    expect(await db.annotations.count()).toBe(3);
    expect(await db.anchors.toArray()).toEqual(anchorsBefore);
  });

  it.each(['updatedAt', 'colorUpdatedAt', 'deletedAt'] as const)('rejects the whole batch when a selected %s no longer matches', async (field) => {
    const first = await createOne();
    const second = await createOne();
    const preview = [expected(first), expected(second)];
    await db.annotations.update(second.id, { [field]: preview[1]![field] + 1 });
    const before = await db.annotations.toArray();

    await expect(editAnnotations(preview, { type: 'comment', mode: 'replace', comment: 'must not save' })).rejects.toThrow();

    expect(await db.annotations.toArray()).toEqual(before);
  });

  it('rejects missing or duplicate selections before writing any rows', async () => {
    const annotation = await createOne();
    const preview = expected(annotation);
    await expect(editAnnotations([preview, { ...preview, id: 'missing' }], { type: 'delete' })).rejects.toThrow();
    await expect(editAnnotations([preview, preview], { type: 'delete' })).rejects.toThrow();
    expect(await readAnnotation(annotation.id)).toEqual(annotation);
  });

  it('rejects comment and color edits to deleted rows without partly editing live selections', async () => {
    const live = await createOne();
    const deleted = await createOne();
    await repo.tombstone(deleted.id);
    const preview = [expected(live), expected(await readAnnotation(deleted.id))];
    const before = await db.annotations.toArray();

    await expect(editAnnotations(preview, { type: 'comment', mode: 'append', comment: 'new' })).rejects.toThrow();
    await expect(editAnnotations(preview, { type: 'color', color: 'teal' })).rejects.toThrow();
    expect(await db.annotations.toArray()).toEqual(before);
  });
});

describe('page summaries', () => {
  it('upgrades an existing v3 library without changing its saved annotations', async () => {
    const annotation = await createOne('saved before upgrading');
    const documents = await db.documents.toArray();
    const sources = await db.sources.toArray();
    const anchors = await db.anchors.toArray();
    await db.delete();
    const legacy = new Dexie('locus');
    legacy.version(3).stores({
      documents: 'id, updatedAt, doi',
      sources: 'id, urlKey, documentId',
      annotations: 'id, sourceId, documentId, createdAt, deletedAt',
      anchors: 'id, annotationId',
      settings: 'key',
      anchorStates: 'annotationId, detached',
    });
    try {
      await legacy.table('documents').bulkPut(documents);
      await legacy.table('sources').bulkPut(sources);
      await legacy.table('annotations').put(annotation);
      await legacy.table('anchors').bulkPut(anchors);
    } finally {
      legacy.close();
      await db.open();
    }

    expect(await readAnnotation(annotation.id)).toEqual(annotation);
    expect(await db.sources.toArray()).toEqual(sources);
    expect(await db.documents.toArray()).toEqual(documents);
    expect(await db.anchors.toArray()).toEqual(anchors);
    await expect(savePageSummaries([
      { sourceId: annotation.sourceId, content: 'new page content', expectedUpdatedAt: 0 },
    ])).resolves.toEqual({ updated: 1 });
    expect((await getPageSummary(annotation.sourceId))?.content).toBe('new page content');
    expect(await readAnnotation(annotation.id)).toEqual(annotation);
  });

  it('saves separately from annotations and retains an empty row when cleared', async () => {
    const annotation = await createOne('annotation note');
    expect(await getPageSummary(annotation.sourceId)).toBeUndefined();

    await expect(savePageSummaries([{ sourceId: annotation.sourceId, content: '主要内容', expectedUpdatedAt: 0 }])).resolves.toEqual({ updated: 1 });
    const saved = await getPageSummary(annotation.sourceId);
    expect(saved).toMatchObject({ sourceId: annotation.sourceId, content: '主要内容' });
    expect(saved?.updatedAt).toBeGreaterThan(0);
    await savePageSummaries([{ sourceId: annotation.sourceId, content: '', expectedUpdatedAt: saved!.updatedAt }]);
    const cleared = await getPageSummary(annotation.sourceId);
    expect(cleared?.content).toBe('');
    expect(cleared?.updatedAt).toBeGreaterThan(saved!.updatedAt);
    expect(await readAnnotation(annotation.id)).toEqual(annotation);
  });

  it('does not advance the summary clock for unchanged content', async () => {
    const source = await repo.ensureSource('https://example.com/summary', 'Summary');
    await savePageSummaries([{ sourceId: source.id, content: 'same', expectedUpdatedAt: 0 }]);
    const saved = await getPageSummary(source.id);

    await expect(savePageSummaries([{ sourceId: source.id, content: 'same', expectedUpdatedAt: saved!.updatedAt }])).resolves.toEqual({ updated: 0 });
    expect(await getPageSummary(source.id)).toEqual(saved);
  });

  it('rejects a stale summary batch atomically, including expectations of no prior summary', async () => {
    const first = await repo.ensureSource('https://example.com/summary-a', 'A');
    const second = await repo.ensureSource('https://example.com/summary-b', 'B');
    await savePageSummaries([{ sourceId: first.id, content: 'original A', expectedUpdatedAt: 0 }]);
    const saved = await getPageSummary(first.id);
    await savePageSummaries([{ sourceId: second.id, content: 'new B', expectedUpdatedAt: 0 }]);
    const secondSaved = await getPageSummary(second.id);

    await expect(savePageSummaries([
      { sourceId: first.id, content: 'must not save', expectedUpdatedAt: saved!.updatedAt },
      { sourceId: second.id, content: 'stale B', expectedUpdatedAt: 0 },
    ])).rejects.toThrow();
    expect(await getPageSummary(first.id)).toEqual(saved);
    expect(await getPageSummary(second.id)).toEqual(secondSaved);

    await expect(savePageSummaries([{ sourceId: first.id, content: 'old edit', expectedUpdatedAt: saved!.updatedAt - 1 }])).rejects.toThrow();
    expect(await getPageSummary(first.id)).toEqual(saved);
  });

  it('rejects missing sources and duplicate source changes without partial writes', async () => {
    const source = await repo.ensureSource('https://example.com/summary', 'Summary');
    const change = { sourceId: source.id, content: 'must not save', expectedUpdatedAt: 0 };
    await expect(savePageSummaries([change, { ...change, sourceId: 'missing' }])).rejects.toThrow();
    await expect(savePageSummaries([change, change])).rejects.toThrow();
    expect(await getPageSummary(source.id)).toBeUndefined();
    expect(await getPageSummary('missing')).toBeUndefined();
  });
});

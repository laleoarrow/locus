import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
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

async function createOne(color: 'yellow' | 'blue' = 'yellow') {
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
    expect(items[0]?.anchor.exact).toBe('selected words');
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

  it('remembers the last-used color (U10)', async () => {
    expect(await repo.getLastColor()).toBe('yellow');
    await createOne('blue');
    expect(await repo.getLastColor()).toBe('blue');
  });
});

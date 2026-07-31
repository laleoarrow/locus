import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadLibrary, recordAnchorStates } from '@/db/library';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import type { AnchorData } from '@/domain/types';

const anchor: AnchorData = {
  exact: 'selected words',
  prefix: '',
  suffix: '',
  start: 0,
  end: 14,
  startPoint: { steps: [], textIndex: 0, offset: 0 },
  endPoint: { steps: [], textIndex: 0, offset: 14 },
};

async function seed() {
  const source = await repo.ensureSource('https://example.com/paper', 'A Paper');
  const created = await repo.createAnnotation({
    sourceId: source.id,
    documentId: source.documentId,
    color: 'yellow',
    comment: '',
    anchor,
  });
  return created.annotation.id;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('loadLibrary (U33)', () => {
  it('returns every table the view model needs', async () => {
    const id = await seed();
    const input = await loadLibrary();
    expect(input.annotations.map((a) => a.id)).toEqual([id]);
    expect(input.anchors).toHaveLength(1);
    expect(input.sources).toHaveLength(1);
    expect(input.documents).toHaveLength(1);
    expect(input.detached).toEqual({});
  });

  it('surfaces recorded detached state', async () => {
    const id = await seed();
    await recordAnchorStates([{ annotationId: id, detached: true }]);
    expect((await loadLibrary()).detached).toEqual({ [id]: true });
  });
});

describe('recordAnchorStates (U34)', () => {
  it('writes only when the state actually changes', async () => {
    const id = await seed();
    await recordAnchorStates([{ annotationId: id, detached: true }]);
    const first = await db.anchorStates.get(id);
    expect(first?.detached).toBe(true);

    // Re-reporting the same state must not rewrite the row.
    await recordAnchorStates([{ annotationId: id, detached: true }]);
    expect((await db.anchorStates.get(id))?.checkedAt).toBe(first?.checkedAt);

    // A real change is written through.
    await recordAnchorStates([{ annotationId: id, detached: false }]);
    expect((await db.anchorStates.get(id))?.detached).toBe(false);
  });

  it('ignores an empty report', async () => {
    await recordAnchorStates([]);
    expect(await db.anchorStates.count()).toBe(0);
  });
});

describe('anchor state is local-only (U35)', () => {
  it('never appears in an exported backup', async () => {
    const id = await seed();
    await recordAnchorStates([{ annotationId: id, detached: true }]);
    const file = await repo.exportBackup('test');
    // Serialize the whole file: the state must not be reachable anywhere in it.
    expect(JSON.stringify(file)).not.toContain('anchorStates');
    expect(Object.keys(file)).not.toContain('anchorStates');
    expect(JSON.stringify(file)).not.toContain('checkedAt');
  });

  it('survives an import without being clobbered', async () => {
    const id = await seed();
    await recordAnchorStates([{ annotationId: id, detached: true }]);
    const file = await repo.exportBackup('test');
    await repo.importBackup(file);
    expect((await db.anchorStates.get(id))?.detached).toBe(true);
  });
});

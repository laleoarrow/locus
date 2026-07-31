import type { LibraryInput } from '@/domain/library';
import { db } from './schema';

/**
 * Read side of the library page: one pass over the database producing
 * everything `domain/library.ts` needs.
 *
 * Loading the whole library is deliberate. Cross-dimension filtering (site ×
 * colour × time × keyword) does not map onto IndexedDB's single-index model, so
 * a paged version would still finish the job in memory. See the design note in
 * docs/superpowers/specs/2026-07-31-annotation-library-design.md for the scale
 * ceiling and what to do if it is ever reached.
 */
export async function loadLibrary(): Promise<LibraryInput> {
  const [annotations, anchors, sources, documents, states] = await Promise.all([
    db.annotations.toArray(),
    db.anchors.toArray(),
    db.sources.toArray(),
    db.documents.toArray(),
    db.anchorStates.toArray(),
  ]);
  const detached: Record<string, boolean> = {};
  for (const state of states) {
    if (state.detached) detached[state.annotationId] = true;
  }
  return { annotations, anchors, sources, documents, detached };
}

/**
 * Record which annotations a page could not re-anchor. Writes only the rows
 * that actually changed, so a page load that resolves everything as before
 * costs no writes at all.
 */
export async function recordAnchorStates(
  states: { annotationId: string; detached: boolean }[],
): Promise<void> {
  if (states.length === 0) return;
  const now = Date.now();
  const ids = states.map((s) => s.annotationId);
  const existing = new Map(
    (await db.anchorStates.where('annotationId').anyOf(ids).toArray()).map((s) => [
      s.annotationId,
      s.detached,
    ]),
  );
  const changed = states.filter((state) => existing.get(state.annotationId) !== state.detached);
  if (changed.length === 0) return;
  await db.anchorStates.bulkPut(
    changed.map((state) => ({ ...state, checkedAt: now })),
  );
}

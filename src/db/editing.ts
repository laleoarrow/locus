import { BUILTIN_COLOR_KEYS, customColorFromKey } from '@/domain/colors';
import type { AnnotationEditAction, AnnotationEditExpectation, SummaryChange } from '@/domain/editing';
import {
  effectiveColorUpdatedAt,
  type AnnotationRecord,
  type CustomColor,
  type PageSummaryRecord,
} from '@/domain/types';
import { db } from './schema';

const STALE_ANNOTATIONS = 'The selected annotations changed. Review the selection and try again.';
const STALE_SUMMARIES = 'The page content changed. Review the current content and try again.';

function validClock(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Apply exactly the reviewed selection, or reject the entire batch. */
export async function editAnnotations(
  expected: AnnotationEditExpectation[],
  action: AnnotationEditAction,
): Promise<{ updated: number; annotationIds: string[] }> {
  const ids = new Set<string>();
  for (const row of expected) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
      !validClock(row.updatedAt) || !validClock(row.colorUpdatedAt) || !validClock(row.deletedAt)) {
      throw new Error('The annotation selection is invalid.');
    }
    ids.add(row.id);
  }
  if (action.type === 'comment' &&
    (typeof action.comment !== 'string' || !['append', 'replace'].includes(action.mode))) {
    throw new Error('Choose whether to append or replace the note.');
  }
  if (!['color', 'comment', 'delete', 'restore'].includes(action.type)) {
    throw new Error('Unknown annotation action.');
  }

  return db.transaction('rw', db.annotations, db.settings, async () => {
    const rows = await db.annotations.bulkGet([...ids]);
    const annotations = rows.map((annotation, index) => {
      const snapshot = expected[index];
      if (!annotation || !snapshot || annotation.updatedAt !== snapshot.updatedAt ||
        effectiveColorUpdatedAt(annotation) !== snapshot.colorUpdatedAt ||
        annotation.deletedAt !== snapshot.deletedAt) throw new Error(STALE_ANNOTATIONS);
      if ((action.type === 'color' || action.type === 'comment') && annotation.deletedAt !== 0) {
        throw new Error('Restore deleted annotations before editing them.');
      }
      return annotation;
    });

    if (action.type === 'color') {
      const catalog = await db.settings.get('customColors');
      const colors = Array.isArray(catalog?.value) ? catalog.value as CustomColor[] : [];
      if (typeof action.color !== 'string' ||
        (!(BUILTIN_COLOR_KEYS as readonly string[]).includes(action.color) &&
          !customColorFromKey(action.color) && !colors.some((color) => color.key === action.color))) {
        throw new Error('Target color is not in the current Locus palette.');
      }
    }

    const now = Date.now();
    const changed: AnnotationRecord[] = [];
    for (const annotation of annotations) {
      const updatedAt = Math.max(now, annotation.updatedAt + 1, annotation.deletedAt + 1);
      switch (action.type) {
        case 'color':
          if (annotation.color !== action.color) changed.push({
            ...annotation,
            color: action.color,
            colorUpdatedAt: Math.max(now, effectiveColorUpdatedAt(annotation) + 1),
          });
          break;
        case 'comment': {
          const appended = action.comment.trim();
          const comment = action.mode === 'replace' ? action.comment : appended
            ? `${annotation.comment}${annotation.comment ? '\n\n' : ''}${appended}`
            : annotation.comment;
          if (comment !== annotation.comment) changed.push({ ...annotation, comment, updatedAt });
          break;
        }
        case 'delete':
          if (annotation.deletedAt === 0) changed.push({ ...annotation, deletedAt: updatedAt, updatedAt });
          break;
        case 'restore':
          if (annotation.deletedAt !== 0) changed.push({ ...annotation, deletedAt: 0, updatedAt });
          break;
      }
    }
    if (changed.length) await db.annotations.bulkPut(changed);
    return { updated: changed.length, annotationIds: changed.map((annotation) => annotation.id) };
  });
}

/** Save page-level content without changing source or annotation metadata. */
export async function savePageSummaries(changes: SummaryChange[]): Promise<{ updated: number }> {
  const ids = new Set<string>();
  for (const change of changes) {
    if (!change || typeof change.sourceId !== 'string' || !change.sourceId || ids.has(change.sourceId) ||
      typeof change.content !== 'string' || !validClock(change.expectedUpdatedAt)) {
      throw new Error('The page content preview is invalid.');
    }
    ids.add(change.sourceId);
  }
  return db.transaction('rw', db.sources, db.pageSummaries, async () => {
    const sources = await db.sources.bulkGet([...ids]);
    const previous = await db.pageSummaries.bulkGet([...ids]);
    const updates: PageSummaryRecord[] = [];
    const now = Date.now();
    changes.forEach((change, index) => {
      if (!sources[index]) throw new Error('The selected page no longer exists.');
      const saved = previous[index];
      if ((saved?.updatedAt ?? 0) !== change.expectedUpdatedAt) throw new Error(STALE_SUMMARIES);
      if (saved?.content === change.content) return;
      updates.push({
        sourceId: change.sourceId,
        content: change.content,
        updatedAt: Math.max(now, (saved?.updatedAt ?? 0) + 1),
      });
    });
    if (updates.length) await db.pageSummaries.bulkPut(updates);
    return { updated: updates.length };
  });
}

export async function getPageSummary(sourceId: string): Promise<PageSummaryRecord | undefined> {
  return db.pageSummaries.get(sourceId);
}

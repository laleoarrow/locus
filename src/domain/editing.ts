import type { ColorKey } from './types';

export type AnnotationEditAction =
  | { type: 'color'; color: ColorKey }
  | { type: 'comment'; comment: string; mode: 'append' | 'replace' }
  | { type: 'delete' }
  | { type: 'restore' };

/** Exact preview state; colour has a clock independent of notes/deletion. */
export interface AnnotationEditExpectation {
  id: string;
  updatedAt: number;
  colorUpdatedAt: number;
  deletedAt: number;
}

export interface SummaryChange {
  sourceId: string;
  content: string;
  /** Zero means the page has no saved summary yet. */
  expectedUpdatedAt: number;
}

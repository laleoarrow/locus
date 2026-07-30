import type { AnchorData } from '../types';
import { buildDomPoint } from './domPath';
import { offsetsToRange, rangeToOffsets, type TextIndex } from './textIndex';

/** How much surrounding context to store on each side of the quote. */
export const CONTEXT_LENGTH = 32;

/**
 * Capture an anchor from a live selection Range (milestone item 9: exact
 * text, prefix, suffix, character positions, DOM paths).
 */
export function captureAnchor(range: Range, index: TextIndex, root: Element): AnchorData | null {
  const offsets = rangeToOffsets(index, range);
  if (!offsets) return null;
  const { start, end } = offsets;
  const exact = index.text.slice(start, end);
  if (exact.trim().length === 0) return null;

  // Normalize to text-node boundaries before computing DOM paths, so element
  // boundaries (e.g. from triple-click) serialize the same way they resolve.
  const normalized = offsetsToRange(index, start, end);
  if (!normalized) return null;
  const startPoint = buildDomPoint(normalized.startContainer as Text, normalized.startOffset, root);
  const endPoint = buildDomPoint(normalized.endContainer as Text, normalized.endOffset, root);
  if (!startPoint || !endPoint) return null;

  return {
    exact,
    prefix: index.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: index.text.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
    startPoint,
    endPoint,
  };
}

import type { AnchorData } from '../types';
import { resolveDomPoint } from './domPath';
import { offsetsToRange, type TextIndex } from './textIndex';

export type ResolveStrategy = 'dom-path' | 'position' | 'quote';

export interface ResolvedAnchor {
  range: Range;
  strategy: ResolveStrategy;
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Strategy 3: find the quote by exact text, disambiguating repeated
 * occurrences with stored prefix/suffix context. With multiple candidates we
 * refuse to guess (returns null → detached) unless one candidate has solid
 * context corroboration and strictly beats the runner-up.
 */
function findByQuote(anchor: AnchorData, index: TextIndex): number | null {
  const { exact, prefix, suffix } = anchor;
  const candidates: number[] = [];
  for (let i = index.text.indexOf(exact); i !== -1; i = index.text.indexOf(exact, i + 1)) {
    candidates.push(i);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  // Ambiguous quote: the winner needs real context corroboration (a couple of
  // spaces matching by accident must not count) and must strictly beat the
  // runner-up — otherwise we detach instead of guessing.
  const MIN_CONTEXT = 4;
  let best: number | null = null;
  let bestContext = -1;
  let secondContext = -1;
  for (const candidate of candidates) {
    const actualPrefix = index.text.slice(Math.max(0, candidate - prefix.length), candidate);
    const actualSuffix = index.text.slice(candidate + exact.length, candidate + exact.length + suffix.length);
    const context = commonSuffixLength(actualPrefix, prefix) + commonPrefixLength(actualSuffix, suffix);
    if (context > bestContext) {
      secondContext = bestContext;
      best = candidate;
      bestContext = context;
    } else if (context > secondContext) {
      secondContext = context;
    }
  }
  return bestContext >= MIN_CONTEXT && bestContext > secondContext ? best : null;
}

/**
 * Anchor recovery. Strategies run in order (DOM path → character position →
 * context quote search); the first candidate whose text equals `exact` wins.
 * Returns null when nothing verifies — the annotation is then *detached*.
 */
export function resolveAnchor(anchor: AnchorData, index: TextIndex, root: Element): ResolvedAnchor | null {
  const doc = root.ownerDocument;
  if (!doc) return null;

  const start = resolveDomPoint(anchor.startPoint, root);
  const end = resolveDomPoint(anchor.endPoint, root);
  if (start && end) {
    try {
      const range = doc.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      if (range.toString() === anchor.exact) return { range, strategy: 'dom-path' };
    } catch {
      // fall through to the next strategy
    }
  }

  if (index.text.slice(anchor.start, anchor.end) === anchor.exact) {
    const range = offsetsToRange(index, anchor.start, anchor.end);
    if (range) return { range, strategy: 'position' };
  }

  const hit = findByQuote(anchor, index);
  if (hit !== null) {
    const range = offsetsToRange(index, hit, hit + anchor.exact.length);
    if (range) return { range, strategy: 'quote' };
  }

  return null;
}

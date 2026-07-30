import { COLOR_KEYS, COLORS } from '@/domain/colors';
import type { ColorKey } from '@/domain/types';

const STYLE_ID = 'locus-style';

export function supportsCustomHighlights(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'
  );
}

/**
 * One <style> in <head> carrying the ::highlight() rules (and the fallback
 * mark rules). This never touches article text and has zero layout cost:
 * highlight pseudo styles cannot affect layout, and fallback marks zero out
 * every box property.
 */
function injectPageStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  const rules = COLOR_KEYS.map((key) => `::highlight(locus-${key}) { background-color: ${COLORS[key].bg}; }`);
  rules.push(
    'mark.locus-mark { background-color: transparent; color: inherit; font: inherit; margin: 0; padding: 0; border: 0; }',
  );
  for (const key of COLOR_KEYS) {
    rules.push(`mark.locus-mark[data-locus-color="${key}"] { background-color: ${COLORS[key].bg}; }`);
  }
  style.textContent = rules.join('\n');
  doc.head.appendChild(style);
}

function textNodesInRange(range: Range): Text[] {
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    return [range.startContainer as Text];
  }
  const doc = range.startContainer.ownerDocument;
  if (!doc) return [];
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (range.intersectsNode(node)) nodes.push(node as Text);
  }
  return nodes;
}

interface Entry {
  color: ColorKey;
  /** Live range (Custom Highlight mode). */
  range: Range | null;
  /** Wrapper elements (fallback mode). */
  marks: HTMLElement[];
}

/**
 * Renders highlights. Primary path is the CSS Custom Highlight API (no DOM
 * mutation at all); the fallback wraps text-node slices in zero-box <mark>
 * elements and is only used where the API is unavailable.
 */
export class HighlightRenderer {
  private readonly useApi: boolean;
  private readonly highlights = new Map<ColorKey, Highlight>();
  private readonly entries = new Map<string, Entry>();
  /** Observers can ignore mutations we caused ourselves (fallback mode). */
  private selfMutationUntil = 0;

  constructor(private readonly doc: Document) {
    this.useApi = supportsCustomHighlights();
    injectPageStyle(doc);
    if (this.useApi) {
      for (const key of COLOR_KEYS) {
        const highlight = new Highlight();
        this.highlights.set(key, highlight);
        CSS.highlights.set(`locus-${key}`, highlight);
      }
    }
  }

  isSelfMutation(): boolean {
    return performance.now() < this.selfMutationUntil;
  }

  private markSelfMutation(): void {
    this.selfMutationUntil = performance.now() + 50;
  }

  set(id: string, color: ColorKey, range: Range): void {
    this.clear(id);
    if (this.useApi) {
      this.highlights.get(color)?.add(range);
      this.entries.set(id, { color, range, marks: [] });
      return;
    }
    this.markSelfMutation();
    const marks: HTMLElement[] = [];
    for (const node of textNodesInRange(range)) {
      const startOffset = node === range.startContainer ? range.startOffset : 0;
      const endOffset = node === range.endContainer ? range.endOffset : node.data.length;
      if (endOffset <= startOffset) continue;
      const middle = startOffset > 0 ? node.splitText(startOffset) : node;
      if (endOffset - startOffset < middle.data.length) middle.splitText(endOffset - startOffset);
      const mark = this.doc.createElement('mark');
      mark.className = 'locus-mark';
      mark.dataset['locusId'] = id;
      mark.dataset['locusColor'] = color;
      middle.parentNode?.insertBefore(mark, middle);
      mark.appendChild(middle);
      marks.push(mark);
    }
    this.entries.set(id, { color, range: null, marks });
  }

  clear(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (entry.range) {
      this.highlights.get(entry.color)?.delete(entry.range);
      return;
    }
    this.markSelfMutation();
    for (const mark of entry.marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
    }
  }

  clearAll(): void {
    for (const id of [...this.entries.keys()]) this.clear(id);
  }

  /** Current on-page range for an id, or null if not rendered. */
  getRange(id: string): Range | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.range) return entry.range;
    const first = entry.marks[0];
    const last = entry.marks[entry.marks.length - 1];
    if (!first || !last) return null;
    const range = this.doc.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    return range;
  }
}

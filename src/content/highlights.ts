import { buildPalette, type PaletteEntry } from '@/domain/colors';
import type { ColorKey } from '@/domain/types';

const STYLE_ID = 'locus-style';

export function supportsCustomHighlights(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'
  );
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
  /** Image annotation target + its overlay ring. */
  image: HTMLImageElement | null;
  ring: HTMLElement | null;
}

const RING_CSS = `
:host { all: initial; }
.ring {
  position: absolute;
  pointer-events: none;
  border-radius: 6px;
  border: 3px solid var(--ring-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring-color) 35%, transparent),
              0 2px 12px color-mix(in srgb, var(--ring-color) 45%, transparent);
}
`;

/**
 * Renders highlights. Primary path is the CSS Custom Highlight API (no DOM
 * mutation at all); the fallback wraps text-node slices in zero-box <mark>
 * elements and is only used where the API is unavailable.
 */
export class HighlightRenderer {
  private readonly useApi: boolean;
  private readonly highlights = new Map<ColorKey, Highlight>();
  private readonly entries = new Map<string, Entry>();
  private palette = new Map<ColorKey, PaletteEntry>();
  private readonly style: HTMLStyleElement;
  /** Shadow layer holding image rings, isolated from page CSS. */
  private readonly ringLayer: ShadowRoot;
  /** Observers can ignore mutations we caused ourselves (fallback mode). */
  private selfMutationUntil = 0;

  constructor(private readonly doc: Document) {
    this.useApi = supportsCustomHighlights();
    // One <style> in <head> carrying ::highlight() and fallback mark rules —
    // it never touches article text and has zero layout cost.
    this.style = doc.createElement('style');
    this.style.id = STYLE_ID;
    doc.head.appendChild(this.style);
    this.setPalette(buildPalette([]));
    const ringHost = doc.createElement('div');
    ringHost.id = 'locus-ring-host';
    ringHost.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483645;';
    this.ringLayer = ringHost.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = RING_CSS;
    this.ringLayer.appendChild(style);
    doc.documentElement.appendChild(ringHost);
  }

  /** Sync rules and Highlight registrations with the current palette. */
  setPalette(entries: PaletteEntry[]): void {
    this.palette = new Map(entries.map((entry) => [entry.key, entry]));
    const rules = entries.map(
      (entry) => `::highlight(locus-${entry.key}) { background-color: ${entry.bg}; }`,
    );
    rules.push(
      'mark.locus-mark { background-color: transparent; color: inherit; font: inherit; margin: 0; padding: 0; border: 0; }',
    );
    for (const entry of entries) {
      rules.push(
        `mark.locus-mark[data-locus-color="${entry.key}"] { background-color: ${entry.bg}; }`,
      );
    }
    this.style.textContent = rules.join('\n');
    if (this.useApi) {
      for (const entry of entries) {
        if (!this.highlights.has(entry.key)) {
          const highlight = new Highlight();
          this.highlights.set(entry.key, highlight);
          CSS.highlights.set(`locus-${entry.key}`, highlight);
        }
      }
    }
  }

  /** A palette key valid for rendering (unknown keys fall back to the first entry). */
  effectiveColor(key: ColorKey): ColorKey {
    if (this.palette.has(key)) return key;
    const first = this.palette.keys().next();
    return first.done ? key : first.value;
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
      this.entries.set(id, { color, range, marks: [], image: null, ring: null });
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
    this.entries.set(id, { color, range: null, marks, image: null, ring: null });
  }

  /** Render an image annotation as a glowing ring overlay around the img. */
  setImage(id: string, color: ColorKey, image: HTMLImageElement): void {
    this.clear(id);
    const spec = this.palette.get(this.effectiveColor(color));
    const ring = this.doc.createElement('div');
    ring.className = 'ring';
    ring.setAttribute('data-locus-ring', id);
    ring.style.setProperty('--ring-color', spec?.swatch ?? '#ffe600');
    this.ringLayer.appendChild(ring);
    const entry: Entry = { color, range: null, marks: [], image, ring };
    this.entries.set(id, entry);
    this.positionRing(entry);
  }

  private positionRing(entry: Entry): void {
    if (!entry.image || !entry.ring) return;
    const view = this.doc.defaultView;
    if (!view) return;
    const rect = entry.image.getBoundingClientRect();
    entry.ring.style.left = `${rect.left + view.scrollX - 4}px`;
    entry.ring.style.top = `${rect.top + view.scrollY - 4}px`;
    entry.ring.style.width = `${rect.width + 2}px`;
    entry.ring.style.height = `${rect.height + 2}px`;
    entry.ring.style.display = rect.width === 0 && rect.height === 0 ? 'none' : '';
  }

  /** Re-align rings with their images (after layout/DOM changes). */
  repositionRings(): void {
    for (const entry of this.entries.values()) this.positionRing(entry);
  }

  /** The image element an annotation is ringed around, if any. */
  getImage(id: string): HTMLImageElement | null {
    return this.entries.get(id)?.image ?? null;
  }

  clear(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.ring?.remove();
    if (entry.range) {
      this.highlights.get(entry.color)?.delete(entry.range);
      return;
    }
    if (entry.marks.length === 0) return;
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

  /** Current on-page range for an id (text or image), or null if not rendered. */
  getRange(id: string): Range | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.range) return entry.range;
    if (entry.image) {
      const range = this.doc.createRange();
      range.selectNode(entry.image);
      return range;
    }
    const first = entry.marks[0];
    const last = entry.marks[entry.marks.length - 1];
    if (!first || !last) return null;
    const range = this.doc.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    return range;
  }

  /** Hit-test a viewport point against all rendered annotations. */
  annotationAtPoint(x: number, y: number): string | null {
    for (const [id, entry] of this.entries) {
      const range = this.getRange(id);
      if (!range) continue;
      for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return id;
      }
    }
    return null;
  }
}

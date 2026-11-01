import { buildPalette, type PaletteEntry } from '@/domain/colors';
import type { ColorKey } from '@/domain/types';

const STYLE_ID = 'locus-style';

interface ImageGeometry {
  rect: DOMRect;
  clip: { left: number; top: number; right: number; bottom: number };
}

/** All caches live for this synchronous read phase, never across layout changes. */
function imageGeometryReader(doc: Document): (image: HTMLImageElement) => ImageGeometry | null {
  const view = doc.defaultView;
  if (!view) return () => null;
  const viewport = { left: 0, top: 0,
    right: doc.documentElement.clientWidth || view.innerWidth,
    bottom: doc.documentElement.clientHeight || view.innerHeight };
  const styles = new Map<Element, CSSStyleDeclaration>();
  const bounds = new Map<Element, { left: number; top: number; right: number; bottom: number }>();
  const images = new Map<HTMLImageElement, ImageGeometry | null>();
  return (image) => {
    if (images.has(image)) return images.get(image)!;
    images.set(image, null);
    if (!image.isConnected || image.ownerDocument !== doc) return null;
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
      rect.left >= viewport.right || rect.top >= viewport.bottom) return null;
    const clip = { ...viewport };
    for (let element: Element | null = image; element;) {
      let style = styles.get(element);
      if (!style) { style = view.getComputedStyle(element); styles.set(element, style); }
      if (style.display === 'none' || (element === image &&
        (style.visibility === 'hidden' || style.visibility === 'collapse')) ||
        style.opacity === '0' || style.contentVisibility === 'hidden') return null;
      // Root scrolling already clips to the viewport above; its moving document
      // rect must not be combined with its viewport-sized clientHeight again.
      if (element !== image && element !== doc.documentElement && element !== doc.scrollingElement) {
        const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow);
        const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow);
        if (clipsX || clipsY) {
          let box = bounds.get(element);
          if (!box) {
            const rect = element.getBoundingClientRect();
            const left = rect.left + element.clientLeft;
            const top = rect.top + element.clientTop;
            box = { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
            bounds.set(element, box);
          }
          if (clipsX) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
          if (clipsY) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
        }
      }
      const root = element.getRootNode();
      element = element.assignedSlot ?? element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    if (Math.max(rect.left, clip.left) >= Math.min(rect.right, clip.right) ||
      Math.max(rect.top, clip.top) >= Math.min(rect.bottom, clip.bottom)) return null;
    const geometry = { rect, clip };
    images.set(image, geometry);
    return geometry;
  };
}

/** Viewport geometry shared by image rings and hit testing. */
export function imageGeometry(image: HTMLImageElement, doc: Document): ImageGeometry | null {
  return imageGeometryReader(doc)(image);
}

export function supportsCustomHighlights(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'
  );
}

/** True only when two non-collapsed DOM ranges share actual content. */
export function rangesOverlap(first: Range, second: Range): boolean {
  if (first.collapsed || second.collapsed) return false;
  try {
    return (
      first.compareBoundaryPoints(Range.START_TO_END, second) > 0 &&
      first.compareBoundaryPoints(Range.END_TO_START, second) < 0
    );
  } catch {
    // Ranges from different documents, or detached ranges in a changing page,
    // cannot overlap.
    return false;
  }
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
  private imageResizeObserver: ResizeObserver | null = null;
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
    const previous = [...this.palette.values()];
    if (previous.length === entries.length && entries.every((entry, index) => {
      const current = previous[index]!;
      return current.key === entry.key && current.label === entry.label &&
        current.swatch === entry.swatch && current.bg === entry.bg;
    })) return;
    this.palette = new Map(entries.map((entry) => [entry.key, { ...entry }]));
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

  /** Change presentation without discarding a live range, marks or image ring. */
  recolor(id: string, color: ColorKey): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const next = this.effectiveColor(color);
    if (entry.range && entry.color !== next) {
      this.highlights.get(entry.color)?.delete(entry.range);
      this.highlights.get(next)?.add(entry.range);
    }
    for (const mark of entry.marks) {
      if (mark.dataset['locusColor'] !== next) mark.dataset['locusColor'] = next;
    }
    if (entry.ring) {
      const swatch = this.palette.get(next)?.swatch ?? '#ffe600';
      if (entry.ring.style.getPropertyValue('--ring-color') !== swatch) entry.ring.style.setProperty('--ring-color', swatch);
    }
    entry.color = next;
    return true;
  }

  /** Render an image annotation as a glowing ring overlay around the img. */
  setImage(id: string, color: ColorKey, image: HTMLImageElement, deferPosition = false): void {
    this.clear(id);
    const spec = this.palette.get(this.effectiveColor(color));
    const ring = this.doc.createElement('div');
    ring.className = 'ring';
    ring.setAttribute('data-locus-ring', id);
    ring.style.setProperty('--ring-color', spec?.swatch ?? '#ffe600');
    this.ringLayer.appendChild(ring);
    const entry: Entry = { color, range: null, marks: [], image, ring };
    this.entries.set(id, entry);
    if (image.isConnected && typeof ResizeObserver !== 'undefined') {
      this.imageResizeObserver ??= new ResizeObserver((records) => {
        const changed = new Set(records.map((record) => record.target));
        this.positionRings([...this.entries.values()].filter((current) => current.image && changed.has(current.image)));
      });
      this.imageResizeObserver.observe(image);
    }
    if (!deferPosition) this.positionRings([entry]);
  }

  private unobserveImage(image: HTMLImageElement): void {
    this.imageResizeObserver?.unobserve(image);
    if (![...this.entries.values()].some((entry) => entry.image?.isConnected)) {
      this.imageResizeObserver?.disconnect();
      this.imageResizeObserver = null;
    }
  }

  private positionRings(entries: Iterable<Entry>): void {
    const targets = [...entries].filter((entry) => entry.image && entry.ring);
    if (targets.length === 0) return;
    const view = this.doc.defaultView;
    if (!view) return;
    const read = imageGeometryReader(this.doc);
    const scrollX = view.scrollX;
    const scrollY = view.scrollY;
    // Finish every layout read before applying any ring styles.
    const measured = targets.map((entry) => ({ entry, geometry: read(entry.image!) }));
    for (const { entry, geometry } of measured) {
      const style = entry.ring!.style;
      const display = geometry ? '' : 'none';
      if (style.display !== display) style.display = display;
      if (!entry.image!.isConnected) this.unobserveImage(entry.image!);
      if (!geometry) continue;
      const { rect, clip } = geometry;
      const values = {
        left: `${rect.left + scrollX - 4}px`,
        top: `${rect.top + scrollY - 4}px`,
        width: `${rect.width + 2}px`,
        height: `${rect.height + 2}px`,
        // Clip the original outline, not an invented border at a scroller edge.
        clipPath: `inset(${clip.top - rect.top + 4}px ${rect.right + 4 - clip.right}px ${rect.bottom + 4 - clip.bottom}px ${clip.left - rect.left + 4}px)`,
      };
      for (const key of Object.keys(values) as (keyof typeof values)[]) {
        if (style[key] !== values[key]) style[key] = values[key];
      }
    }
  }

  /** Re-align rings with their images (after layout/DOM changes). */
  repositionRings(): void {
    this.positionRings(this.entries.values());
  }

  /** The image element an annotation is ringed around, if any. */
  getImage(id: string): HTMLImageElement | null {
    const image = this.entries.get(id)?.image;
    return image?.isConnected ? image : null;
  }

  clear(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.ring?.remove();
    if (entry.image && ![...this.entries.values()].some((current) => current.image === entry.image)) {
      this.unobserveImage(entry.image);
    }
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
      if (!entry.image.isConnected || !entry.image.parentNode) return null;
      const range = this.doc.createRange();
      range.selectNode(entry.image);
      return range;
    }
    const first = entry.marks[0];
    const last = entry.marks[entry.marks.length - 1];
    if (!first?.isConnected || !last?.isConnected) return null;
    const range = this.doc.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    return range;
  }

  /** Text annotation ids whose live ranges overlap the supplied page selection. */
  annotationIdsIntersecting(selectionRange: Range): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.image) continue;
      const annotationRange = this.getRange(id);
      if (annotationRange && rangesOverlap(selectionRange, annotationRange)) ids.push(id);
    }
    return ids;
  }

  /** Hit-test a viewport point against all rendered annotations. */
  annotationAtPoint(x: number, y: number): string | null {
    let readImage: ReturnType<typeof imageGeometryReader> | undefined;
    for (const [id, entry] of this.entries) {
      if (entry.image) {
        readImage ??= imageGeometryReader(this.doc);
        const geometry = readImage(entry.image);
        if (geometry && x >= Math.max(geometry.rect.left, geometry.clip.left) &&
          x <= Math.min(geometry.rect.right, geometry.clip.right) &&
          y >= Math.max(geometry.rect.top, geometry.clip.top) &&
          y <= Math.min(geometry.rect.bottom, geometry.clip.bottom)) return id;
        continue;
      }
      const range = this.getRange(id);
      if (!range) continue;
      for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return id;
      }
    }
    return null;
  }
}

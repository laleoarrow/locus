import { LOCUS_HOST_ID } from '@/domain/anchor/textIndex';
import type { Box } from '@/domain/placement';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

function isOwnUI(element: Element): boolean {
  return element.id === LOCUS_HOST_ID || element.id === 'locus-ring-host';
}

function parentElement(node: Node): Element | null {
  const root = node.getRootNode();
  const slot = node instanceof Element || node instanceof Text ? node.assignedSlot : null;
  return slot ?? node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

function shadowRoot(element: Element): ShadowRoot | null {
  return element.shadowRoot ?? (
    element instanceof HTMLElement && typeof chrome !== 'undefined'
      ? chrome.dom?.openOrClosedShadowRoot?.(element) ?? null
      : null
  );
}

function floating(style: CSSStyleDeclaration, inherited: boolean, inShadow: boolean): boolean {
  return style.position === 'fixed' || style.position === 'sticky' || (
    style.position === 'absolute' && (inherited || inShadow || Number(style.zIndex) > 0)
  ) || (style.position === 'relative' && Number(style.zIndex) >= 1000);
}

/** Cache floating subtrees; animation ticks only measure those, not the whole article. */
export class FloatingObstacles {
  private readonly candidates = new Map<Element, boolean>();
  private readonly roots = new Set<ShadowRoot>();
  private readonly shadowless = new Set<Element>();
  private readonly dirty = new Set<Element | ShadowRoot>();
  private observer: MutationObserver | null = null;
  private nextShadowCheck = 0;

  constructor(private readonly doc: Document) {}

  start(): void {
    if (this.observer || !this.doc.defaultView) return;
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target && isOwnUI(target)) continue;
        if (target?.tagName === 'STYLE' || (record.type === 'childList' &&
          [...record.addedNodes, ...record.removedNodes].some((node) =>
            node instanceof Element && (node.tagName === 'STYLE' || node.tagName === 'LINK')))) {
          const root = record.target.getRootNode();
          this.dirty.add(root instanceof ShadowRoot ? root : this.doc.documentElement);
        } else if (record.type === 'attributes' && target) {
          this.dirty.add(target);
        } else if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (node instanceof Element) this.dirty.add(node);
          }
        }
      }
    });
    this.observe(this.doc.documentElement);
    this.scan(this.doc.documentElement, false, false);
    this.nextShadowCheck = Date.now() + 1000;
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.candidates.clear();
    this.roots.clear();
    this.shadowless.clear();
    this.dirty.clear();
  }

  private observe(root: Element | ShadowRoot): void {
    this.observer?.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
      characterData: true,
    });
  }

  private scan(element: Element, inherited: boolean, inShadow: boolean): void {
    if (isOwnUI(element) || SKIP_TAGS.has(element.tagName)) return;
    const style = this.doc.defaultView!.getComputedStyle(element);
    const ownOverlay = floating(style, inherited, inShadow);
    const overlay = inherited || ownOverlay;
    if (overlay) this.candidates.set(element, ownOverlay);
    else this.candidates.delete(element);
    for (const child of element.children) this.scan(child, overlay, inShadow);
    const shadow = shadowRoot(element);
    if (shadow) {
      this.shadowless.delete(element);
      if (!this.roots.has(shadow)) {
        this.roots.add(shadow);
        this.observe(shadow);
      }
      for (const child of shadow.children) this.scan(child, overlay, true);
    } else if (element instanceof HTMLElement) {
      this.shadowless.add(element);
    }
  }

  private inheritedOverlay(element: Element): boolean {
    for (let parent = parentElement(element); parent; parent = parentElement(parent)) {
      if (floating(this.doc.defaultView!.getComputedStyle(parent), false,
        parent.getRootNode() instanceof ShadowRoot)) return true;
    }
    return false;
  }

  collect(anchorNode?: Node): Box[] {
    const view = this.doc.defaultView;
    if (!view || !this.observer) return [];
    // attachShadow() itself emits no DOM mutation. Probe cached hosts at a
    // slower cadence; this does not recompute styles across the article.
    if (Date.now() >= this.nextShadowCheck) {
      this.nextShadowCheck = Date.now() + 1000;
      for (const host of this.shadowless) {
        if (!host.isConnected) this.shadowless.delete(host);
        else if (shadowRoot(host)) this.dirty.add(host);
      }
    }
    for (const root of this.dirty) {
      if (!root.isConnected) continue;
      if (root instanceof ShadowRoot) {
        const inherited = this.inheritedOverlay(root.host) ||
          floating(view.getComputedStyle(root.host), false, false);
        for (const child of root.children) this.scan(child, inherited, true);
      } else {
        this.scan(root, this.inheritedOverlay(root), root.getRootNode() instanceof ShadowRoot);
      }
    }
    this.dirty.clear();

    const anchorAncestors = new Set<Element>();
    for (let node = anchorNode instanceof Element ? anchorNode : anchorNode ? parentElement(anchorNode) : null;
      node; node = parentElement(node)) anchorAncestors.add(node);
    const independent = new Map<Element, boolean>();
    const isRival = (element: Element): boolean => {
      // The selected card is reading content. Its static descendants do not
      // inherit obstacle status, but a floating toolbar inside it still does.
      if (anchorAncestors.has(element)) return false;
      const cached = independent.get(element);
      if (cached !== undefined) return cached;
      const parent = parentElement(element);
      const value = this.candidates.get(element) === true || (!!parent && isRival(parent));
      independent.set(element, value);
      return value;
    };
    const visible = new Map<Element, boolean>();
    const isVisible = (element: Element): boolean => {
      const cached = visible.get(element);
      if (cached !== undefined) return cached;
      const style = view.getComputedStyle(element);
      const parent = parentElement(element);
      const value = style.display !== 'none' && style.visibility !== 'hidden' &&
        style.opacity !== '0' && (!parent || isVisible(parent));
      visible.set(element, value);
      return value;
    };
    const boxes: Box[] = [];
    for (const element of this.candidates.keys()) {
      if (!element.isConnected) {
        this.candidates.delete(element);
        continue;
      }
      if (anchorNode && !isRival(element)) continue;
      if (!isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 ||
        rect.width * rect.height >= view.innerWidth * view.innerHeight * 0.6 ||
        rect.right <= 0 || rect.bottom <= 0 || rect.left >= view.innerWidth || rect.top >= view.innerHeight) continue;
      // A wrapper and its controls describe one obstacle, unless a child
      // protrudes beyond it. Keep the larger box without double-counting.
      if (boxes.some((box) => contains(box, rect))) continue;
      for (let i = boxes.length - 1; i >= 0; i--) {
        if (contains(rect, boxes[i]!)) boxes.splice(i, 1);
      }
      boxes.push(rect);
    }
    return boxes;
  }
}

function contains(outer: Box, inner: Box): boolean {
  return outer.left <= inner.left && outer.top <= inner.top &&
    outer.right >= inner.right && outer.bottom >= inner.bottom;
}

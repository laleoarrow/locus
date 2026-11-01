import type { DomPathStep, ImageAnchorData } from '../types';
import { isImageAnchorData } from './validate';

/**
 * Prefer the displayed resource over a shared srcset fallback. The saved alt
 * text can distinguish repeated URLs when their position changes.
 */

function buildPath(el: Element, root: Element): DomPathStep[] | null {
  const steps: DomPathStep[] = [];
  let current: Element | null = el;
  while (current && current !== root) {
    let index = 0;
    for (let sib = current.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.tagName === current.tagName) index++;
    }
    steps.unshift({ tag: current.tagName, index });
    current = current.parentElement;
  }
  return current === root ? steps : null;
}

function resolvePath(steps: DomPathStep[], root: Element): Element | null {
  let el: Element = root;
  for (const step of steps) {
    let seen = 0;
    let next: Element | null = null;
    for (const child of el.children) {
      if (child.tagName === step.tag) {
        if (seen === step.index) {
          next = child;
          break;
        }
        seen++;
      }
    }
    if (!next) return null;
    el = next;
  }
  return el;
}

function imageSource(img: HTMLImageElement): string {
  return img.currentSrc || (img.getAttribute('src')?.trim() ? img.src : '');
}

function sameSrcImages(src: string, root: Element): HTMLImageElement[] {
  return [...root.querySelectorAll('img')].filter((image) => imageSource(image) === src);
}

export type ImageIndex = ReadonlyMap<string, {
  images: readonly HTMLImageElement[];
  byAlt: ReadonlyMap<string, readonly HTMLImageElement[]>;
}>;

/** A snapshot for one synchronous resolution batch; never retain across DOM changes. */
export function buildImageIndex(root: Element): ImageIndex {
  const index = new Map<string, { images: HTMLImageElement[]; byAlt: Map<string, HTMLImageElement[]> }>();
  for (const image of root.querySelectorAll('img')) {
    const src = imageSource(image);
    let group = index.get(src);
    if (!group) { group = { images: [], byAlt: new Map() }; index.set(src, group); }
    group.images.push(image);
    const alt = image.alt;
    const matching = group.byAlt.get(alt);
    if (matching) matching.push(image);
    else group.byAlt.set(alt, [image]);
  }
  return index;
}

export function captureImageAnchor(img: HTMLImageElement, root: Element): ImageAnchorData | null {
  const path = buildPath(img, root);
  const src = imageSource(img);
  if (!path || !src) return null;
  const candidates = sameSrcImages(src, root);
  const imgIndex = candidates.indexOf(img);
  if (imgIndex < 0) return null;
  return {
    kind: 'image',
    src,
    alt: img.alt,
    imgIndex,
    matchCount: candidates.filter((candidate) => candidate.alt === img.alt).length,
    path,
  };
}

export function resolveImageAnchor(anchor: ImageAnchorData, root: Element, index?: ImageIndex): HTMLImageElement | null {
  if (!isImageAnchorData(anchor)) return null;
  const group = index?.get(anchor.src);
  const candidates = index ? group?.images ?? [] : sameSrcImages(anchor.src, root);
  const withAlt = index ? group?.byAlt.get(anchor.alt) ?? [] : candidates.filter((image) => image.alt === anchor.alt);
  if (anchor.matchCount !== undefined && anchor.matchCount !== withAlt.length) return null;
  if (withAlt.length === 1 && (anchor.alt || anchor.matchCount === 1 ||
    (candidates.length === 1 && anchor.imgIndex === 0))) return withAlt[0]!;
  const byPath = resolvePath(anchor.path, root);
  if (byPath instanceof HTMLImageElement && byPath.alt === anchor.alt &&
    candidates[anchor.imgIndex] === byPath) return byPath;
  // An index alone is not identity once a repeated image's path is gone.
  return null;
}

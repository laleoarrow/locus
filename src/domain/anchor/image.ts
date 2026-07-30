import type { DomPathStep, ImageAnchorData } from '../types';

/**
 * Image anchoring: an image is identified by its absolute src, its index
 * among same-src images, and a DOM path. Recovery prefers the path (verified
 * against src), then falls back to src matching.
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

function sameSrcImages(src: string, root: Element): HTMLImageElement[] {
  return [...root.querySelectorAll('img')].filter((img) => img.src === src);
}

export function captureImageAnchor(img: HTMLImageElement, root: Element): ImageAnchorData | null {
  const path = buildPath(img, root);
  if (!path) return null;
  const src = img.src;
  return {
    kind: 'image',
    src,
    alt: img.alt,
    imgIndex: sameSrcImages(src, root).indexOf(img),
    path,
  };
}

export function resolveImageAnchor(anchor: ImageAnchorData, root: Element): HTMLImageElement | null {
  const byPath = resolvePath(anchor.path, root);
  if (byPath instanceof HTMLImageElement && byPath.src === anchor.src) return byPath;
  const candidates = sameSrcImages(anchor.src, root);
  if (candidates.length === 0) return null;
  return candidates[Math.min(Math.max(anchor.imgIndex, 0), candidates.length - 1)] ?? null;
}

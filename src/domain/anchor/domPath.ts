import type { DomPathStep, DomPoint } from '../types';

/**
 * DOM-point serialization for range endpoints. Paths are element steps from a
 * root element (normally <body>) keyed by tag name + index among same-tag
 * siblings, so attribute/class churn on publisher pages does not break them.
 */

export function buildDomPoint(textNode: Text, offset: number, root: Element): DomPoint | null {
  const parent = textNode.parentElement;
  if (!parent) return null;

  let textIndex = 0;
  for (const child of parent.childNodes) {
    if (child === textNode) break;
    if (child.nodeType === Node.TEXT_NODE) textIndex++;
  }

  const steps: DomPathStep[] = [];
  let el: Element | null = parent;
  while (el && el !== root) {
    let index = 0;
    for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.tagName === el.tagName) index++;
    }
    steps.unshift({ tag: el.tagName, index });
    el = el.parentElement;
  }
  if (el !== root) return null; // textNode is not under root
  return { steps, textIndex, offset };
}

export function resolveDomPoint(point: DomPoint, root: Element): { node: Text; offset: number } | null {
  let el: Element = root;
  for (const step of point.steps) {
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
  let seenText = 0;
  for (const child of el.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    if (seenText === point.textIndex) {
      const node = child as Text;
      return point.offset <= node.data.length ? { node, offset: point.offset } : null;
    }
    seenText++;
  }
  return null;
}

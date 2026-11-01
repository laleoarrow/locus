import type { AnchorData, AnchorRecord, DomPathStep, DomPoint, ImageAnchorData } from '../types';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function index(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function path(value: unknown): value is DomPathStep[] {
  if (!Array.isArray(value)) return false;
  for (const step of value) {
    if (!object(step) || !nonempty(step.tag) || !index(step.index)) return false;
  }
  return true;
}

function point(value: unknown): value is DomPoint {
  return object(value) && path(value.steps) && index(value.textIndex) && index(value.offset);
}

/** Empty paths and large safe positions also represent legacy quote-only anchors. */
export function isAnchorData(value: unknown): value is AnchorData {
  return object(value) && (value.kind === undefined || value.kind === 'text') &&
    nonempty(value.exact) && typeof value.prefix === 'string' && typeof value.suffix === 'string' &&
    index(value.start) && index(value.end) && value.end > value.start &&
    point(value.startPoint) && point(value.endPoint);
}

export function isImageAnchorData(value: unknown): value is ImageAnchorData {
  return object(value) && value.kind === 'image' && nonempty(value.src) && typeof value.alt === 'string' &&
    index(value.imgIndex) && path(value.path) &&
    (value.matchCount === undefined || (index(value.matchCount) && value.matchCount > 0));
}

export function isAnchorRecord(value: unknown): value is AnchorRecord {
  return object(value) && nonempty(value.id) && nonempty(value.annotationId) &&
    (isAnchorData(value) || isImageAnchorData(value));
}

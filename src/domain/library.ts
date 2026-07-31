import type {
  AnchorRecord,
  AnnotationRecord,
  ColorKey,
  DocumentRecord,
  SourceRecord,
} from './types';

/**
 * The library view: every annotation across every site, reshaped for browsing.
 *
 * Pure — no DOM, no chrome.*, no database. Grouping, filtering, searching and
 * sorting all happen here so they can be unit-tested directly, and so the three
 * display modes are three projections of one dataset rather than three queries.
 */

export type GroupMode = 'page' | 'site' | 'timeline';

export interface LibraryAnnotation {
  id: string;
  sourceId: string;
  documentId: string;
  color: ColorKey;
  /** The annotated text, or the image's alt text. */
  quote: string;
  note: string;
  isImage: boolean;
  /** Image source, when this annotates a figure. */
  imageSrc: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  /** Last known anchoring state; false unless a content script reported it. */
  detached: boolean;
}

export interface LibraryPage {
  sourceId: string;
  documentId: string;
  url: string;
  urlKey: string;
  title: string;
  /** '' when the URL cannot be parsed. */
  origin: string;
  doi: string;
  annotations: LibraryAnnotation[];
  /** Newest annotation activity on this page, for ordering. */
  lastActivityAt: number;
}

export interface LibrarySite {
  origin: string;
  /** Host without the scheme, for display. */
  label: string;
  pages: LibraryPage[];
  annotationCount: number;
  lastActivityAt: number;
}

export interface TimelineDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  entries: { page: LibraryPage; annotation: LibraryAnnotation }[];
}

export interface LibraryFilters {
  query: string;
  colors: ColorKey[];
  origins: string[];
  from: number | null;
  to: number | null;
  /** Recycle-bin view: show tombstoned annotations *instead of* live ones. */
  deletedOnly: boolean;
  detachedOnly: boolean;
}

export const EMPTY_FILTERS: LibraryFilters = {
  query: '',
  colors: [],
  origins: [],
  from: null,
  to: null,
  deletedOnly: false,
  detachedOnly: false,
};

export interface LibraryInput {
  annotations: AnnotationRecord[];
  anchors: AnchorRecord[];
  sources: SourceRecord[];
  documents: DocumentRecord[];
  /** annotationId → true when last seen detached. */
  detached: Record<string, boolean>;
}

/**
 * Origin of a URL, or '' when there isn't a usable one. Note that `URL.origin`
 * yields the *string* `"null"` for opaque schemes (`about:`, `data:`, `blob:`
 * of an opaque origin), which must be treated as unknown rather than shown as
 * a site called "null".
 */
export function originOf(url: string): string {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? '' : origin;
  } catch {
    return '';
  }
}

/** Host for display, falling back to a readable label for unparseable URLs. */
export function siteLabel(origin: string): string {
  if (origin === '') return 'Unknown site';
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Local calendar day key, `YYYY-MM-DD`. */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Build the page-grouped view. Annotations whose anchor row is missing are
 * skipped, matching `listForSource`; pages with no annotations are dropped.
 */
export function buildLibrary(input: LibraryInput): LibraryPage[] {
  const anchorByAnnotation = new Map(input.anchors.map((a) => [a.annotationId, a]));
  const documentById = new Map(input.documents.map((d) => [d.id, d]));
  const bySource = new Map<string, LibraryAnnotation[]>();

  for (const annotation of input.annotations) {
    const anchor = anchorByAnnotation.get(annotation.id);
    if (!anchor) continue;
    const entry: LibraryAnnotation = {
      id: annotation.id,
      sourceId: annotation.sourceId,
      documentId: annotation.documentId,
      color: annotation.color,
      quote: annotation.exact,
      note: annotation.comment,
      isImage: anchor.kind === 'image',
      imageSrc: anchor.kind === 'image' ? anchor.src : '',
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
      deleted: annotation.deletedAt !== 0,
      detached: input.detached[annotation.id] === true,
    };
    const list = bySource.get(annotation.sourceId);
    if (list) list.push(entry);
    else bySource.set(annotation.sourceId, [entry]);
  }

  const pages: LibraryPage[] = [];
  for (const source of input.sources) {
    const annotations = bySource.get(source.id);
    if (!annotations || annotations.length === 0) continue;
    annotations.sort((a, b) => a.createdAt - b.createdAt);
    const document = documentById.get(source.documentId);
    pages.push({
      sourceId: source.id,
      documentId: source.documentId,
      url: source.url,
      urlKey: source.urlKey,
      title: document?.title || source.title || source.url,
      origin: originOf(source.url),
      doi: document?.doi ?? '',
      annotations,
      lastActivityAt: annotations.reduce((max, a) => Math.max(max, a.updatedAt), 0),
    });
  }
  pages.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return pages;
}

function matchesQuery(page: LibraryPage, annotation: LibraryAnnotation, needle: string): boolean {
  if (needle === '') return true;
  const lower = needle.toLowerCase();
  return (
    annotation.quote.toLowerCase().includes(lower) ||
    annotation.note.toLowerCase().includes(lower) ||
    page.title.toLowerCase().includes(lower)
  );
}

/**
 * Apply the filter bar. Pages left with no matching annotations disappear, so
 * an empty result is genuinely empty rather than a list of empty cards.
 */
export function filterLibrary(pages: LibraryPage[], filters: LibraryFilters): LibraryPage[] {
  const query = filters.query.trim();
  const colors = new Set(filters.colors);
  const origins = new Set(filters.origins);
  const out: LibraryPage[] = [];

  for (const page of pages) {
    if (origins.size > 0 && !origins.has(page.origin)) continue;
    const annotations = page.annotations.filter((annotation) => {
      if (annotation.deleted !== filters.deletedOnly) return false;
      if (filters.detachedOnly && !annotation.detached) return false;
      if (colors.size > 0 && !colors.has(annotation.color)) return false;
      if (filters.from !== null && annotation.createdAt < filters.from) return false;
      if (filters.to !== null && annotation.createdAt > filters.to) return false;
      return matchesQuery(page, annotation, query);
    });
    if (annotations.length === 0) continue;
    out.push({
      ...page,
      annotations,
      lastActivityAt: annotations.reduce((max, a) => Math.max(max, a.updatedAt), 0),
    });
  }
  out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return out;
}

/** Collapse pages into per-origin groups, newest activity first. */
export function groupBySite(pages: LibraryPage[]): LibrarySite[] {
  const byOrigin = new Map<string, LibraryPage[]>();
  for (const page of pages) {
    const list = byOrigin.get(page.origin);
    if (list) list.push(page);
    else byOrigin.set(page.origin, [page]);
  }
  const sites = [...byOrigin].map(([origin, group]) => ({
    origin,
    label: siteLabel(origin),
    pages: [...group].sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    annotationCount: group.reduce((total, page) => total + page.annotations.length, 0),
    lastActivityAt: group.reduce((max, page) => Math.max(max, page.lastActivityAt), 0),
  }));
  sites.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return sites;
}

/** Flatten to a newest-first stream, split into local calendar days. */
export function toTimeline(pages: LibraryPage[]): TimelineDay[] {
  const entries = pages.flatMap((page) =>
    page.annotations.map((annotation) => ({ page, annotation })),
  );
  entries.sort((a, b) => b.annotation.createdAt - a.annotation.createdAt);
  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const day = dayKey(entry.annotation.createdAt);
    const current = days[days.length - 1];
    if (current && current.day === day) current.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
}

/** Distinct origins present, for the site filter. */
export function availableOrigins(pages: LibraryPage[]): { origin: string; label: string; count: number }[] {
  return groupBySite(pages).map((site) => ({
    origin: site.origin,
    label: site.label,
    count: site.annotationCount,
  }));
}

export function countAnnotations(pages: LibraryPage[]): number {
  return pages.reduce((total, page) => total + page.annotations.length, 0);
}

/**
 * Split text around case-insensitive matches of `needle`, so the UI can mark
 * hits without doing its own (escaping-prone) string surgery.
 */
export function highlightParts(text: string, needle: string): { text: string; hit: boolean }[] {
  const query = needle.trim();
  if (query === '') return [{ text, hit: false }];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let index = 0;
  for (;;) {
    const at = lowerText.indexOf(lowerQuery, index);
    if (at === -1) break;
    if (at > index) parts.push({ text: text.slice(index, at), hit: false });
    parts.push({ text: text.slice(at, at + query.length), hit: true });
    index = at + query.length;
  }
  if (index < text.length) parts.push({ text: text.slice(index), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

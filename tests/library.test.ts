import { describe, expect, it } from 'vitest';
import {
  availableOrigins,
  buildLibrary,
  buildTimeline,
  daysBetween,
  eraKeyOf,
  eraLabelOf,
  relativeDayLabel,
  countAnnotations,
  dayKey,
  EMPTY_FILTERS,
  filterLibrary,
  groupBySite,
  highlightParts,
  originOf,
  siteFamily,
  siteLabel,
  toTimeline,
  type LibraryInput,
} from '@/domain/library';
import type {
  AnchorRecord,
  AnnotationRecord,
  ColorKey,
  DocumentRecord,
  SourceRecord,
} from '@/domain/types';

const DAY = 86_400_000;
const T0 = new Date(2026, 6, 30, 10, 0, 0).getTime();

function doc(id: string, title: string, doi = ''): DocumentRecord {
  return { id, title, doi, createdAt: T0, updatedAt: T0 };
}

function source(id: string, documentId: string, url: string, title = ''): SourceRecord {
  return { id, documentId, urlKey: url, url, title, firstSeenAt: T0, lastSeenAt: T0 };
}

function annotation(
  id: string,
  sourceId: string,
  documentId: string,
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    id,
    sourceId,
    documentId,
    kind: 'text',
    color: 'yellow',
    comment: '',
    exact: `quote ${id}`,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: 0,
    ...overrides,
  };
}

function textAnchor(annotationId: string): AnchorRecord {
  return {
    id: `anchor-${annotationId}`,
    annotationId,
    exact: 'x',
    prefix: '',
    suffix: '',
    start: 0,
    end: 1,
    startPoint: { steps: [], textIndex: 0, offset: 0 },
    endPoint: { steps: [], textIndex: 0, offset: 1 },
  };
}

function imageAnchor(annotationId: string, src: string): AnchorRecord {
  return { id: `anchor-${annotationId}`, annotationId, kind: 'image', src, alt: 'fig', imgIndex: 0, path: [] };
}

/** Two sites, three pages, five annotations — the fixture most tests build on. */
function library(): LibraryInput {
  const annotations = [
    annotation('a1', 's1', 'd1', { exact: 'mitochondria powerhouse', comment: 'check this' }),
    annotation('a2', 's1', 'd1', { color: 'teal', createdAt: T0 + 1000, updatedAt: T0 + 1000 }),
    annotation('a3', 's2', 'd2', { color: 'pink', createdAt: T0 + DAY, updatedAt: T0 + DAY }),
    annotation('a4', 's3', 'd3', { createdAt: T0 + 2 * DAY, updatedAt: T0 + 2 * DAY }),
    annotation('a5', 's1', 'd1', { createdAt: T0 + 2000, deletedAt: T0 + 5000, updatedAt: T0 + 5000 }),
  ];
  return {
    annotations,
    anchors: [
      textAnchor('a1'),
      textAnchor('a2'),
      imageAnchor('a3', 'https://pmc.example/fig1.png'),
      textAnchor('a4'),
      textAnchor('a5'),
    ],
    sources: [
      source('s1', 'd1', 'https://journal.example/paper-1'),
      source('s2', 'd2', 'https://pmc.example/article-2'),
      source('s3', 'd3', 'https://journal.example/paper-3'),
    ],
    documents: [doc('d1', 'Mitochondrial Function', '10.1/aaa'), doc('d2', 'PMC Mirror'), doc('d3', 'Third Paper')],
    detached: { a4: true },
  };
}

describe('originOf / siteLabel (U27)', () => {
  it('extracts origins and falls back for unparseable URLs', () => {
    expect(originOf('https://journal.example/paper-1?x=1#y')).toBe('https://journal.example');
    expect(originOf('not a url')).toBe('');
    expect(siteLabel('https://journal.example')).toBe('journal');
    expect(siteLabel('')).toBe('Unknown site');
  });

  it('collapses host variants into readable site families', () => {
    expect(siteFamily('https://www.nature.com')).toBe('nature');
    expect(siteFamily('https://advanced.onlinelibrary.wiley.com')).toBe('wiley');
    expect(siteFamily('https://recover.genomicsengland.co.uk')).toBe('genomicsengland');
    expect(siteFamily('https://github.com')).toBe('github');
    expect(siteFamily('https://kaz-yos.github.io')).toBe('github');
    expect(siteFamily('http://localhost:8137')).toBe('localhost');
    expect(siteFamily('http://127.0.0.1:8137')).toBe('127.0.0.1');
  });
});

describe('buildLibrary (U28)', () => {
  it('groups annotations under their page, newest page first', () => {
    const pages = buildLibrary(library());
    expect(pages.map((p) => p.sourceId)).toEqual(['s3', 's2', 's1']);
    expect(pages.find((p) => p.sourceId === 's1')?.annotations.map((a) => a.id)).toEqual([
      'a1',
      'a2',
      'a5',
    ]);
  });

  it('carries title, doi, origin, image source and detached state', () => {
    const pages = buildLibrary(library());
    const first = pages.find((p) => p.sourceId === 's1');
    expect(first?.title).toBe('Mitochondrial Function');
    expect(first?.doi).toBe('10.1/aaa');
    expect(first?.origin).toBe('https://journal.example');
    const image = pages.find((p) => p.sourceId === 's2')?.annotations[0];
    expect(image?.isImage).toBe(true);
    expect(image?.imageSrc).toBe('https://pmc.example/fig1.png');
    expect(pages.find((p) => p.sourceId === 's3')?.annotations[0]?.detached).toBe(true);
  });

  it('skips annotations with no anchor row, and pages left empty', () => {
    const input = library();
    input.anchors = input.anchors.filter((a) => a.annotationId !== 'a4');
    const pages = buildLibrary(input);
    expect(pages.some((p) => p.sourceId === 's3')).toBe(false);
  });

  it('handles an empty library', () => {
    const pages = buildLibrary({
      annotations: [],
      anchors: [],
      sources: [],
      documents: [],
      detached: {},
    });
    expect(pages).toEqual([]);
    expect(countAnnotations(pages)).toBe(0);
    expect(groupBySite(pages)).toEqual([]);
    expect(toTimeline(pages)).toEqual([]);
  });

  it('buckets an unparseable source URL under an unknown origin', () => {
    const input = library();
    input.sources = [...input.sources, source('s9', 'd9', 'about:blank-ish nonsense')];
    input.documents = [...input.documents, doc('d9', 'Odd')];
    input.annotations = [...input.annotations, annotation('a9', 's9', 'd9')];
    input.anchors = [...input.anchors, textAnchor('a9')];
    const pages = buildLibrary(input);
    const odd = pages.find((p) => p.sourceId === 's9');
    expect(odd?.origin).toBe('');
    expect(groupBySite(pages).some((s) => s.label === 'Unknown site')).toBe(true);
  });
});

describe('filterLibrary (U29)', () => {
  const pages = buildLibrary(library());

  it('hides tombstones by default and shows only them in the bin view', () => {
    const live = filterLibrary(pages, EMPTY_FILTERS);
    expect(countAnnotations(live)).toBe(4);
    expect(live.flatMap((p) => p.annotations).some((a) => a.deleted)).toBe(false);

    const bin = filterLibrary(pages, { ...EMPTY_FILTERS, deletedOnly: true });
    expect(countAnnotations(bin)).toBe(1);
    expect(bin[0]?.annotations[0]?.id).toBe('a5');
  });

  it('searches quote, note and page title, case-insensitively', () => {
    expect(countAnnotations(filterLibrary(pages, { ...EMPTY_FILTERS, query: 'POWERHOUSE' }))).toBe(1);
    expect(countAnnotations(filterLibrary(pages, { ...EMPTY_FILTERS, query: 'check this' }))).toBe(1);
    // A title match keeps every live annotation on that page.
    expect(countAnnotations(filterLibrary(pages, { ...EMPTY_FILTERS, query: 'mitochondrial' }))).toBe(2);
    expect(countAnnotations(filterLibrary(pages, { ...EMPTY_FILTERS, query: 'nothing here' }))).toBe(0);
  });

  it('filters by colour, site family and detached state', () => {
    const teal = filterLibrary(pages, { ...EMPTY_FILTERS, colors: ['teal' as ColorKey] });
    expect(teal.flatMap((p) => p.annotations).map((a) => a.id)).toEqual(['a2']);

    const pmc = filterLibrary(pages, { ...EMPTY_FILTERS, origins: ['pmc'] });
    expect(pmc.map((p) => p.sourceId)).toEqual(['s2']);

    const detached = filterLibrary(pages, { ...EMPTY_FILTERS, detachedOnly: true });
    expect(detached.flatMap((p) => p.annotations).map((a) => a.id)).toEqual(['a4']);
  });

  it('filters by date range on creation time', () => {
    const recent = filterLibrary(pages, { ...EMPTY_FILTERS, from: T0 + DAY });
    expect(recent.flatMap((p) => p.annotations).map((a) => a.id).sort()).toEqual(['a3', 'a4']);
    const early = filterLibrary(pages, { ...EMPTY_FILTERS, to: T0 + 2000 });
    expect(early.flatMap((p) => p.annotations).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('combines filters and drops pages left with nothing', () => {
    const combined = filterLibrary(pages, {
      ...EMPTY_FILTERS,
      origins: ['journal'],
      colors: ['yellow' as ColorKey],
      query: 'quote',
    });
    // s1 disappears: its only live yellow annotation is the 'mitochondria
    // powerhouse' one, which the query does not match.
    expect(combined.map((p) => p.sourceId)).toEqual(['s3']);
    expect(countAnnotations(combined)).toBe(1);
  });
});

describe('groupBySite (U30)', () => {
  it('collapses pages by site family with counts, newest first', () => {
    const sites = groupBySite(filterLibrary(buildLibrary(library()), EMPTY_FILTERS));
    expect(sites.map((s) => s.label)).toEqual(['journal', 'pmc']);
    const journal = sites[0];
    expect(journal?.pages.map((p) => p.sourceId)).toEqual(['s3', 's1']);
    expect(journal?.annotationCount).toBe(3);
  });

  it('lists distinct origins for the filter bar', () => {
    const origins = availableOrigins(filterLibrary(buildLibrary(library()), EMPTY_FILTERS));
    expect(origins.map((o) => [o.label, o.count])).toEqual([
      ['journal', 3],
      ['pmc', 1],
    ]);
  });

  it('merges different subdomains and suffixes under one family', () => {
    const input = library();
    input.sources = [
      source('s1', 'd1', 'https://github.com/laleoarrow/locus'),
      source('s2', 'd2', 'https://kaz-yos.github.io/demo'),
      source('s3', 'd3', 'https://www.nature.com/articles/example'),
    ];
    const pages = filterLibrary(buildLibrary(input), EMPTY_FILTERS);
    const sites = groupBySite(pages);

    expect(sites.map((site) => [site.origin, site.annotationCount])).toEqual([
      ['nature', 1],
      ['github', 3],
    ]);
    expect(
      filterLibrary(pages, { ...EMPTY_FILTERS, origins: ['github'] }).map(
        (page) => page.sourceId,
      ),
    ).toEqual(['s2', 's1']);
  });
});

describe('toTimeline (U31)', () => {
  it('streams newest first, split by local day', () => {
    const days = toTimeline(filterLibrary(buildLibrary(library()), EMPTY_FILTERS));
    expect(days.map((d) => d.day)).toEqual([
      dayKey(T0 + 2 * DAY),
      dayKey(T0 + DAY),
      dayKey(T0),
    ]);
    expect(days[0]?.entries.map((e) => e.annotation.id)).toEqual(['a4']);
    // Same-day annotations stay together, newest first.
    expect(days[2]?.entries.map((e) => e.annotation.id)).toEqual(['a2', 'a1']);
    expect(days[0]?.entries[0]?.page.sourceId).toBe('s3');
  });
});

describe('highlightParts (U32)', () => {
  it('splits around every case-insensitive match', () => {
    expect(highlightParts('The Powerhouse of the cell', 'powerhouse')).toEqual([
      { text: 'The ', hit: false },
      { text: 'Powerhouse', hit: true },
      { text: ' of the cell', hit: false },
    ]);
  });

  it('handles repeats, no match, and an empty needle', () => {
    expect(highlightParts('aXaXa', 'x').filter((p) => p.hit)).toHaveLength(2);
    expect(highlightParts('nothing', 'zzz')).toEqual([{ text: 'nothing', hit: false }]);
    expect(highlightParts('text', '  ')).toEqual([{ text: 'text', hit: false }]);
  });
});

describe('timeline structure (U39)', () => {
  const TODAY = '2026-07-31';

  /** Minimal TimelineDay: only `day` and the entry count matter here. */
  function tlDay(day: string, count: number) {
    return {
      day,
      entries: Array.from({ length: count }, (_, i) => ({
        page: { title: `page ${i}` },
        annotation: { id: `${day}-${i}` },
      })),
    } as unknown as Parameters<typeof buildTimeline>[0][number];
  }

  it('counts whole days back, including across months and years', () => {
    expect(daysBetween('2026-07-31', TODAY)).toBe(0);
    expect(daysBetween('2026-07-30', TODAY)).toBe(1);
    expect(daysBetween('2026-06-30', TODAY)).toBe(31);
    expect(daysBetween('2025-07-31', TODAY)).toBe(365);
    // A future day is negative rather than silently clamped.
    expect(daysBetween('2026-08-02', TODAY)).toBe(-2);
  });

  it('labels the recent past in words and older days by date', () => {
    expect(relativeDayLabel('2026-07-31', TODAY)).toBe('Today');
    expect(relativeDayLabel('2026-07-30', TODAY)).toBe('Yesterday');
    expect(relativeDayLabel('2026-07-28', TODAY)).toBe('3 days ago');
    expect(relativeDayLabel('2026-07-25', TODAY)).toBe('6 days ago');
    // Beyond a week the phrasing stops helping, so it becomes a date.
    expect(relativeDayLabel('2026-07-24', TODAY)).not.toContain('days ago');
  });

  it('groups consecutive days into one era per calendar month', () => {
    const eras = buildTimeline(
      [tlDay('2026-07-31', 2), tlDay('2026-07-19', 1), tlDay('2026-06-21', 1), tlDay('2026-04-27', 3)],
      TODAY,
    );
    expect(eras.map((era) => era.key)).toEqual(['2026-07', '2026-06', '2026-04']);
    expect(eras.map((era) => era.days.length)).toEqual([2, 1, 1]);
    expect(eras.map((era) => era.count)).toEqual([3, 1, 3]);
    expect(eraKeyOf('2026-04-27')).toBe('2026-04');
    expect(eraLabelOf('2026-04-27')).toContain('2026');
  });

  it('ranks depth by position so an uneven history still recedes evenly', () => {
    // Three days, but the last one is a year old: depth must not collapse to
    // two extremes just because the elapsed time does.
    const eras = buildTimeline(
      [tlDay('2026-07-31', 1), tlDay('2026-07-30', 1), tlDay('2025-07-30', 1)],
      TODAY,
    );
    const depths = eras.flatMap((era) => era.days).map((day) => day.depth);
    expect(depths).toEqual([0, 0.5, 1]);
  });

  it('carries per-day counts and both labels through', () => {
    const [era] = buildTimeline([tlDay('2026-07-30', 4)], TODAY);
    const day = era?.days[0];
    expect(day?.count).toBe(4);
    expect(day?.daysAgo).toBe(1);
    expect(day?.label).toBe('Yesterday');
    expect(day?.fullDate).toContain('2026');
  });

  it('handles a single day and an empty history without dividing by zero', () => {
    expect(buildTimeline([tlDay('2026-07-31', 1)], TODAY)[0]?.days[0]?.depth).toBe(0);
    expect(buildTimeline([], TODAY)).toEqual([]);
  });
});

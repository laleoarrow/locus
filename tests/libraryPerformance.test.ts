import 'fake-indexeddb/auto';
import { act, createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationRow } from '@/entrypoints/library/components/AnnotationRow';
import { NoteDraftProvider } from '@/entrypoints/library/components/NoteDraftContext';
import { App } from '@/entrypoints/library/App';
import { loadLibrary } from '@/db/library';
import { db } from '@/db/schema';
import { groupBySite, toTimeline, type LibraryAnnotation, type LibraryInput, type LibraryPage } from '@/domain/library';
import { markdownToHtml } from '@/lib/markdown';

vi.mock('@/messaging/protocol', () => ({ requestBg: vi.fn(async () => undefined) }));
vi.mock('@/entrypoints/library/components/ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('@/lib/markdown', async (original) => {
  const actual = await original<typeof import('@/lib/markdown')>();
  return { ...actual, markdownToHtml: vi.fn(actual.markdownToHtml) };
});
vi.mock('@/domain/library', async (original) => {
  const actual = await original<typeof import('@/domain/library')>();
  return { ...actual, groupBySite: vi.fn(actual.groupBySite), toTimeline: vi.fn(actual.toTimeline) };
});

let host: HTMLDivElement;
let root: Root;
const observerDisconnect = vi.fn();

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() { observerDisconnect(); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

const annotation: LibraryAnnotation = {
  id: 'a0', sourceId: 's0', documentId: 'd0', color: 'yellow', quote: 'Synthetic excerpt',
  note: '**Saved note**', isImage: false, imageSrc: '', createdAt: 10, updatedAt: 10,
  colorUpdatedAt: 10, deletedAt: 0, deleted: false, detached: false,
};
const page: LibraryPage = {
  sourceId: 's0', documentId: 'd0', url: 'https://example.test/page', urlKey: 'https://example.test/page',
  title: 'Synthetic page', origin: 'https://example.test', doi: '', annotations: [annotation], lastActivityAt: 10,
};

async function settleUntil(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (check()) return;
  }
  expect(check()).toBe(true);
}

async function seedMetadata(count = 1_000) {
  const documents = Array.from({ length: count }, (_, index) => ({
    id: `d${index}`, title: `Paper ${index}`, doi: '', createdAt: 1, updatedAt: 1,
  }));
  const sources = documents.map((document, index) => ({
    id: `s${index}`, documentId: document.id, title: document.title,
    url: `https://example.test/paper/${index}`, urlKey: `https://example.test/paper/${index}`,
    firstSeenAt: 1, lastSeenAt: 1,
  }));
  await db.documents.bulkPut(documents); await db.sources.bulkPut(sources);
  await addAnnotation(0); await addAnnotation(1, true);
}
async function addAnnotation(index: number, deleted = false) {
  await db.transaction('rw', db.annotations, db.anchors, async () => {
    await db.annotations.put({ id: `a${index}`, sourceId: `s${index}`, documentId: `d${index}`, kind: 'text',
      color: 'yellow', comment: `**Note ${index}**`, exact: 'quote', createdAt: 10 + index, updatedAt: 10 + index,
      deletedAt: deleted ? 20 : 0 });
    await db.anchors.put({ id: `anchor${index}`, annotationId: `a${index}`, exact: 'quote', prefix: '', suffix: '',
      start: 0, end: 5, startPoint: { steps: [], textIndex: 0, offset: 0 }, endPoint: { steps: [], textIndex: 0, offset: 5 } });
  });
}

describe('Library work budget', () => {
  it('only renders the edited row while typing among 200 Markdown notes', async () => {
    const commits = new Map<string, number>();
    const rows = Array.from({ length: 200 }, (_, index) => createElement(Profiler, {
      id: `a${index}`, key: `a${index}`, onRender: (id: string) => commits.set(id, (commits.get(id) ?? 0) + 1),
    }, createElement(AnnotationRow, { page, annotation: { ...annotation, id: `a${index}` }, query: '', customColors: [] })));
    await act(async () => root.render(createElement(NoteDraftProvider, { children: createElement('ul', {}, rows) })));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="edit"]')!.click());
    commits.clear(); vi.mocked(markdownToHtml).mockClear();
    for (let key = 0; key < 20; key++) {
      await act(async () => {
        const textarea = host.querySelector('textarea')!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, `Draft ${key}`);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const unrelated = [...commits].filter(([id]) => id !== 'a0').reduce((total, [, count]) => total + count, 0);
    console.info('Library 200 rows / 20 keys:', { edited: commits.get('a0'), unrelated, markdown: vi.mocked(markdownToHtml).mock.calls.length });
    expect(commits.get('a0')).toBe(20);
    expect(unrelated).toBe(0);
    expect(markdownToHtml).not.toHaveBeenCalled();
    expect(host.querySelector('textarea')?.value).toBe('Draft 19');
  });

  it('loads metadata only for pages with annotations while retaining deleted rows', async () => {
    await seedMetadata();
    const input = await loadLibrary();
    console.info('Library 1000 visits / 2 annotated pages:', { sources: input.sources.length, documents: input.documents.length });
    expect(input.sources.map((source) => source.id).sort()).toEqual(['s0', 's1']);
    expect(input.documents.map((document) => document.id).sort()).toEqual(['d0', 'd1']);
    expect(input.annotations).toHaveLength(2);
    expect(input.annotations.some((row) => row.deletedAt !== 0)).toBe(true);
  });

  it('ignores unrelated visits but observes metadata edits and new annotations immediately', async () => {
    await seedMetadata();
    const reads = vi.fn(loadLibrary);
    let latest: LibraryInput | undefined;
    const subscription = liveQuery(reads).subscribe((value) => { latest = value; });
    try {
      await vi.waitFor(() => expect(latest?.annotations).toHaveLength(2));
      const firstReads = reads.mock.calls.length;
      await db.sources.update('s999', { lastSeenAt: 2 });
      await db.documents.update('d999', { title: 'An unrelated visited page' });
      await new Promise((resolve) => setTimeout(resolve, 60));
      console.info('Unrelated visit triggered Library reads:', reads.mock.calls.length - firstReads);
      expect(reads).toHaveBeenCalledTimes(firstReads);
      await db.documents.update('d0', { title: 'Changed title', doi: '10.1234/test' });
      await vi.waitFor(() => expect(latest?.documents.find((row) => row.id === 'd0')?.doi).toBe('10.1234/test'));
      await db.sources.update('s0', { title: 'Changed source' });
      await vi.waitFor(() => expect(latest?.sources.find((row) => row.id === 's0')?.title).toBe('Changed source'));
      await addAnnotation(999);
      await vi.waitFor(() => expect(latest?.sources.some((row) => row.id === 's999')).toBe(true));
      expect(latest?.annotations).toHaveLength(3);
    } finally { subscription.unsubscribe(); }
  });

  it.each(['site', 'timeline'] as const)('reuses the %s projection and Markdown when selection changes', async (mode) => {
    await seedMetadata(2);
    await db.settings.put({ key: 'libraryGroupMode', value: mode });
    await act(async () => root.render(createElement(App)));
    await settleUntil(() => host.querySelector('.annotation') !== null);
    const projection = mode === 'site' ? groupBySite : toTimeline;
    vi.mocked(projection).mockClear(); vi.mocked(markdownToHtml).mockClear(); observerDisconnect.mockClear();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-selection="start"]')!.click());
    console.info(`Library ${mode} selection:`, { projections: vi.mocked(projection).mock.calls.length,
      markdown: vi.mocked(markdownToHtml).mock.calls.length, observerDisconnects: observerDisconnect.mock.calls.length });
    expect(projection).not.toHaveBeenCalled();
    expect(markdownToHtml).not.toHaveBeenCalled();
    expect(observerDisconnect).not.toHaveBeenCalled();
    await act(async () => { await db.documents.update('d0', { title: 'New live title' }); });
    await settleUntil(() => host.textContent?.includes('New live title') === true);
    expect(projection).toHaveBeenCalled();
  });
});

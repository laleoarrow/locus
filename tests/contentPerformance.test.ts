import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocusContent } from '@/entrypoints/content';
import { HighlightRenderer } from '@/content/highlights';
import * as textIndex from '@/domain/anchor/textIndex';
import { captureAnchor } from '@/domain/anchor/capture';
import { captureImageAnchor } from '@/domain/anchor/image';
import type { AnnotationWithAnchor, Prefs } from '@/domain/types';
import type { BgRequest, TabMessage } from '@/messaging/protocol';

vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (value: unknown) => value }));
const prefs: Prefs = { placement: 'below', customColors: [], disabledSites: [], detectDoi: true, checkUpdates: false };
let items: AnnotationWithAnchor[];
let handler: (message: TabMessage, sender: unknown, respond: (value?: unknown) => void) => unknown;
let request: ReturnType<typeof vi.fn>;

function item(id: string, image = false): AnnotationWithAnchor {
  const paragraph = document.querySelector('p')!;
  const range = document.createRange(); range.selectNodeContents(paragraph);
  const anchor = image ? captureImageAnchor(document.querySelector('img')!, document.body)!
    : captureAnchor(range, textIndex.buildTextIndex(document.body), document.body)!;
  return { annotation: { id, sourceId: 's', documentId: 'd', kind: image ? 'image' : 'text',
    color: 'yellow', comment: 'before', exact: image ? 'figure' : paragraph.textContent!, createdAt: 1, updatedAt: 1, deletedAt: 0 },
  anchor: { ...anchor, id: `anchor-${id}`, annotationId: id } };
}
function controls(reader: LocusContent) {
  return reader as unknown as { refresh(): Promise<void>; openNoteFor(id: string, rect: DOMRect): void };
}
beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = ''; document.body.innerHTML = '<p>A specific saved excerpt.</p><img src="https://example.test/figure.png" alt="figure">' + '<p>Long article text.</p>'.repeat(1000);
  document.documentElement.querySelectorAll('#locus-host, #locus-ring-host').forEach((el) => el.remove());
  items = [];
  vi.stubGlobal('CSS', { highlights: new Map() });
  vi.stubGlobal('Highlight', class extends Set<Range> {});
  request = vi.fn(async (message: BgRequest) => {
    if (message.type === 'source:bootstrap') return { source: { urlKey: 'key' }, items: structuredClone(items), lastColor: 'yellow', pageColors: [], prefs };
    if (message.type === 'annotations:list') return { items: structuredClone(items) };
    return { ok: true };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage: request, onMessage: { addListener: (value: typeof handler) => { handler = value; } } } });
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('content work scales with changed anchors', () => {
  it('does not scan an empty or image-only article for text', async () => {
    const scan = vi.spyOn(textIndex, 'buildTextIndex');
    const empty = new LocusContent(); await empty.start();
    expect(scan).toHaveBeenCalledTimes(0);
    items = [item('image', true)];
    await controls(empty).refresh();
    expect(scan).toHaveBeenCalledTimes(0);
    expect(document.documentElement.dataset.locusAnchored).toBe('1');
  });

  it('comment and preference updates keep existing highlights and current note text without reindexing', async () => {
    items = [item('text')];
    const reader = new LocusContent(); await reader.start();
    const scan = vi.spyOn(textIndex, 'buildTextIndex');
    const render = vi.spyOn(HighlightRenderer.prototype, 'set');
    items[0]!.annotation.comment = 'new note'; items[0]!.annotation.updatedAt = 2;
    await controls(reader).refresh();
    handler({ type: 'prefs:changed', prefs: { ...prefs, detectDoi: false } }, {}, () => {});
    expect(scan).toHaveBeenCalledTimes(0);
    expect(render).toHaveBeenCalledTimes(0);
    controls(reader).openNoteFor('text', new DOMRect(10, 10, 40, 20));
    expect(document.getElementById('locus-host')!.shadowRoot!.querySelector('textarea')!.value).toBe('new note');
  });

  it('recolours without rebuilding and still resolves imported changes, removes and restores annotations', async () => {
    items = [item('text')];
    const reader = new LocusContent(); await reader.start();
    const scan = vi.spyOn(textIndex, 'buildTextIndex');
    items[0]!.annotation.color = 'teal';
    await controls(reader).refresh();
    expect(scan).toHaveBeenCalledTimes(0);
    expect((CSS.highlights.get('locus-teal') as unknown as Set<Range>).size).toBe(1);
    const saved = structuredClone(items[0]!);
    items = []; await controls(reader).refresh();
    expect(document.documentElement.dataset.locusAnchored).toBe('0');
    items = [saved]; await controls(reader).refresh();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.locusAnchored).toBe('1');
    if (items[0]!.anchor.kind === 'image') throw new Error('text fixture');
    items[0]!.anchor.exact = 'missing excerpt';
    await controls(reader).refresh();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.locusDetached).toBe('1');
  });

  it('coalesces simultaneous reads and drains a trailing update without resurrecting removed notes', async () => {
    items = [item('text')];
    const reader = new LocusContent(); await reader.start();
    let release!: (value: unknown) => void;
    const original = request.getMockImplementation()!;
    request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = structuredClone(items);
    const first = controls(reader).refresh();
    await Promise.resolve(); // The first read is in flight before the next notification.
    items = [];
    const second = controls(reader).refresh();
    const third = controls(reader).refresh();
    request.mockImplementation(original);
    release({ items: old });
    await Promise.all([first, second, third]);
    expect(request.mock.calls.filter(([message]) => message.type === 'annotations:list')).toHaveLength(2);
    expect(document.documentElement.dataset.locusAnchored).toBe('0');
  });
  it('still drains a requested update when the earlier read fails, without automatic retries', async () => {
    items = [item('text')];
    const reader = new LocusContent(); await reader.start();
    let reject!: (reason: Error) => void;
    const original = request.getMockImplementation()!;
    request.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    const first = controls(reader).refresh();
    await Promise.resolve(); // The first read is in flight before the next notification.
    items = [];
    const queued = controls(reader).refresh();
    request.mockImplementation(original);
    reject(new Error('temporary read failure'));
    await Promise.all([first, queued]);
    expect(document.documentElement.dataset.locusAnchored).toBe('0');
    expect(request.mock.calls.filter(([message]) => message.type === 'annotations:list')).toHaveLength(2);
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(controls(reader).refresh()).rejects.toThrow('offline');
    expect(request.mock.calls.filter(([message]) => message.type === 'annotations:list')).toHaveLength(3);
    await controls(reader).refresh();
    expect(document.documentElement.dataset.locusAnchored).toBe('0');
  });

  it('allows a later refresh after the message transport throws synchronously', async () => {
    const reader = new LocusContent(); await reader.start();
    request.mockImplementationOnce(() => { throw new Error('transport unavailable'); });
    await expect(controls(reader).refresh()).rejects.toThrow('transport unavailable');
    items = [item('text')];
    await controls(reader).refresh();
    expect(document.documentElement.dataset.locusAnchored).toBe('1');
  });

});

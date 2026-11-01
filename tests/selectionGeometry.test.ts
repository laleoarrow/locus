import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectionTextRect } from '@/content/selectionGeometry';

let geometry: ReturnType<typeof vi.fn<(node: Node, start: number, end: number) => DOMRect[]>>;
const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');

beforeEach(() => {
  document.body.innerHTML = '';
  geometry = vi.fn<(node: Node, start: number, end: number) => DOMRect[]>(() => []);
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: function (this: Range) { return geometry(this.startContainer, this.startOffset, this.endOffset); },
  });
});
afterEach(() => {
  if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  vi.restoreAllMocks();
});

function select(selector: string): Range {
  const range = document.createRange();
  range.selectNode(document.querySelector(selector)!);
  return range;
}

describe('selected text geometry', () => {
  it('uses the glyph box when an element-boundary selection includes a tall container', () => {
    document.body.innerHTML = '<p><span style="display:inline-block;height:350px">，</span></p>';
    const range = select('span');
    const glyph = new DOMRect(110, 203, 18, 18);
    geometry.mockImplementation((node) => node.nodeType === Node.TEXT_NODE ? [glyph] : [new DOMRect(100, 200, 30, 350), glyph]);
    const boundaries = [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
    expect(selectionTextRect(range)).toEqual(glyph);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect([range.startContainer, range.startOffset, range.endContainer, range.endOffset]).toEqual(boundaries);
    expect(range.toString()).toBe('，');
  });

  it('keeps the direct text-node path without traversing or allocating another range', () => {
    document.body.textContent = 'before，after';
    const range = document.createRange();
    range.setStart(document.body.firstChild!, 6);
    range.setEnd(document.body.firstChild!, 7);
    const walk = vi.spyOn(document, 'createTreeWalker');
    const create = vi.spyOn(document, 'createRange');
    const glyph = new DOMRect(60, 20, 10, 18);
    geometry.mockReturnValue([glyph]);
    expect(selectionTextRect(range)).toEqual(glyph);
    expect(geometry).toHaveBeenCalledWith(document.body.firstChild, 6, 7);
    expect(walk).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('measures only the selected offsets across text nodes and unions wrapped lines', () => {
    document.body.innerHTML = '<p><b>prefix first</b><i>middle</i><span>last suffix</span></p><section>unselected</section>';
    const first = document.querySelector('b')!.firstChild!;
    const middle = document.querySelector('i')!.firstChild!;
    const last = document.querySelector('span')!.firstChild!;
    const range = document.createRange();
    range.setStart(first, 7);
    range.setEnd(last, 4);
    geometry.mockImplementation((node) => node === first ? [new DOMRect(50, 100, 50, 20)]
      : node === middle ? [new DOMRect(100, 100, 40, 20), new DOMRect(10, 125, 30, 20)]
      : [new DOMRect(40, 125, 25, 20)]);
    expect(selectionTextRect(range)).toEqual(new DOMRect(10, 100, 130, 45));
    expect(geometry.mock.calls).toEqual([[first, 7, 12], [middle, 0, 6], [last, 0, 4]]);
    expect(range.toString()).toBe('firstmiddlelast');
  });

  it('prunes unselected branches and ignores whitespace-only text and empty rectangles', () => {
    document.body.innerHTML = '<section><b>before</b></section><p> \n <span>selected</span> \n </p><section><i>after</i></section>';
    const selected = document.querySelector('span')!.firstChild!;
    const range = select('p');
    const glyph = new DOMRect(20, 20, 80, 18);
    geometry.mockReturnValue([new DOMRect(0, 0, 0, 0), glyph]);
    expect(selectionTextRect(range)).toEqual(glyph);
    expect(geometry.mock.calls).toEqual([[selected, 0, 8]]);
  });

  it('starts and stops at element child offsets, including empty nested elements', () => {
    document.body.innerHTML = '<article><b>one</b><i></i><span><em>two</em></span><strong>three</strong></article>';
    const article = document.querySelector('article')!;
    const selected = document.querySelector('em')!.firstChild!;
    const range = document.createRange();
    range.setStart(article, 1);
    range.setEnd(article, 3);
    geometry.mockReturnValue([new DOMRect(20, 30, 30, 18)]);
    expect(selectionTextRect(range)).toEqual(new DOMRect(20, 30, 30, 18));
    expect(geometry.mock.calls).toEqual([[selected, 0, 3]]);
  });

  it('handles boundaries at an empty element and the end of a nested container', () => {
    document.body.innerHTML = '<article><b>one</b><div><span>two</span><i></i><em>three</em></div><u>four</u></article>';
    const first = document.querySelector('b')!.firstChild!;
    const second = document.querySelector('span')!.firstChild!;
    const third = document.querySelector('em')!.firstChild!;
    const empty = document.querySelector('i')!;
    const range = document.createRange();
    range.setStart(first, 1);
    range.setEnd(empty, 0);
    geometry.mockReturnValue([new DOMRect(20, 30, 30, 18)]);
    selectionTextRect(range);
    expect(geometry.mock.calls).toEqual([[first, 1, 3], [second, 0, 3]]);
    geometry.mockClear();
    range.setStart(empty, 0);
    range.setEnd(document.querySelector('div')!, 3);
    selectionTextRect(range);
    expect(geometry.mock.calls).toEqual([[third, 0, 5]]);
    geometry.mockClear();
    range.setEnd(document.querySelector('u')!.firstChild!, 0);
    selectionTextRect(range);
    expect(geometry.mock.calls).toEqual([[third, 0, 5]]);
  });

  it('does not compare each node or move range endpoints across a large selection', () => {
    document.body.innerHTML = '<main>' + '<p>selected</p>'.repeat(1000) + '</main>';
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('main')!);
    const intersect = vi.spyOn(Range.prototype, 'intersectsNode');
    const start = vi.spyOn(Range.prototype, 'setStart');
    const end = vi.spyOn(Range.prototype, 'setEnd');
    geometry.mockReturnValue([new DOMRect(20, 30, 30, 18)]);
    selectionTextRect(range);
    expect(geometry).toHaveBeenCalledTimes(1000);
    expect(intersect).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('returns no target for collapsed, whitespace-only or hidden text', () => {
    document.body.innerHTML = '<span>hidden</span><p> \n </p>';
    expect(selectionTextRect(document.createRange())).toBeNull();
    expect(selectionTextRect(select('p'))).toBeNull();
    expect(geometry).not.toHaveBeenCalled();
    expect(selectionTextRect(select('span'))).toBeNull();
    expect(geometry).toHaveBeenCalledTimes(1);
  });
});

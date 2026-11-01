import { afterEach, describe, expect, it, vi } from 'vitest';
import { HighlightRenderer, rangesOverlap } from '@/content/highlights';

function range(text: Text, start: number, end: number): Range {
  const result = document.createRange();
  result.setStart(text, start);
  result.setEnd(text, end);
  return result;
}

describe('highlight range overlap', () => {
  it('detects partial, contained, and exact overlap', () => {
    document.body.innerHTML = '<p>abcdefghij</p>';
    const text = document.querySelector('p')?.firstChild as Text;
    const annotation = range(text, 2, 6);

    expect(rangesOverlap(range(text, 0, 3), annotation)).toBe(true);
    expect(rangesOverlap(range(text, 3, 5), annotation)).toBe(true);
    expect(rangesOverlap(range(text, 1, 8), annotation)).toBe(true);
    expect(rangesOverlap(range(text, 2, 6), annotation)).toBe(true);
  });

  it('rejects disjoint, boundary-only, and collapsed ranges', () => {
    document.body.innerHTML = '<p>abcdefghij</p>';
    const text = document.querySelector('p')?.firstChild as Text;
    const annotation = range(text, 2, 6);

    expect(rangesOverlap(range(text, 0, 2), annotation)).toBe(false);
    expect(rangesOverlap(range(text, 6, 9), annotation)).toBe(false);
    expect(rangesOverlap(range(text, 8, 10), annotation)).toBe(false);
    expect(rangesOverlap(range(text, 4, 4), annotation)).toBe(false);
  });

  it('compares ranges across different nested text nodes', () => {
    document.body.innerHTML = '<p><span>abc</span><em>def</em></p>';
    const left = document.querySelector('span')?.firstChild as Text;
    const right = document.querySelector('em')?.firstChild as Text;
    const annotation = document.createRange();
    annotation.setStart(left, 1);
    annotation.setEnd(right, 2);

    expect(rangesOverlap(range(right, 0, 3), annotation)).toBe(true);
    expect(rangesOverlap(range(left, 0, 1), annotation)).toBe(false);
  });
});

describe('highlight visibility', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.querySelectorAll('#locus-ring-host, #locus-style').forEach((node) => node.remove());
    document.documentElement.style.removeProperty('overflow-y');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function render(style = '') {
    document.body.innerHTML = `<div style="${style}"><img src="https://example.com/figure.png"></div>`;
    const image = document.querySelector('img')!;
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 100));
    const renderer = new HighlightRenderer(document);
    renderer.setImage('figure', 'yellow', image);
    const ring = document.getElementById('locus-ring-host')!.shadowRoot!.querySelector<HTMLElement>('[data-locus-ring]')!;
    return { image, renderer, ring };
  }

  function resizedEntry(target: Element): ResizeObserverEntry {
    return { target, contentRect: new DOMRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] };
  }

  it('hides a removed image and returns no live range instead of throwing', () => {
    const { image, renderer, ring } = render();
    image.remove();
    renderer.repositionRings();
    expect(ring.style.display).toBe('none');
    expect(renderer.getRange('figure')).toBeNull();
    expect(renderer.getImage('figure')).toBeNull();
    expect(renderer.annotationAtPoint(150, 150)).toBeNull();
  });

  it('returns no fallback text range if the page removes its marked content', () => {
    document.body.innerHTML = '<p>Marked text</p>';
    const paragraph = document.querySelector('p')!;
    const renderer = new HighlightRenderer(document);
    renderer.set('text', 'yellow', range(paragraph.firstChild as Text, 0, 6));
    expect(paragraph.querySelector('mark')).not.toBeNull();
    paragraph.querySelector('mark')!.remove();
    expect(renderer.getRange('text')).toBeNull();
  });

  it.each(['display:none', 'visibility:hidden', 'opacity:0'])('does not ring or hit hidden ancestors (%s)', (style) => {
    const { renderer, ring } = render(style);
    expect(ring.style.display).toBe('none');
    expect(renderer.annotationAtPoint(150, 150)).toBeNull();
  });

  it('honours an image visibility override inside a hidden ancestor', () => {
    const { image, renderer, ring } = render('visibility:hidden');
    image.style.visibility = 'visible';
    renderer.repositionRings();
    expect(ring.style.display).toBe('');
    expect(renderer.annotationAtPoint(150, 150)).toBe('figure');
  });

  it.each(['scroll', 'auto'])('does not clip the viewport twice when the document root scrolls (%s)', (overflow) => {
    const { renderer, ring } = render();
    const root = document.documentElement;
    root.style.overflowY = overflow;
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -900, 1024, 1800));
    renderer.repositionRings();
    expect(ring.style.display).toBe('');
    expect(renderer.annotationAtPoint(150, 150)).toBe('figure');
  });

  it('hides a zero-width image even when its height remains positive', () => {
    const { image, renderer, ring } = render();
    vi.mocked(image.getBoundingClientRect).mockReturnValue(new DOMRect(100, 100, 0, 100));
    renderer.repositionRings();
    expect(ring.style.display).toBe('none');
  });

  it('recovers when a hidden image becomes visible again', () => {
    const { image, renderer, ring } = render('opacity:0');
    image.parentElement!.style.opacity = '1';
    renderer.repositionRings();
    expect(ring.style.display).toBe('');
    expect(renderer.annotationAtPoint(150, 150)).toBe('figure');
  });

  it('keeps an offscreen image range available for reveal while hiding its ring and hit area', () => {
    const { image, renderer, ring } = render();
    vi.mocked(image.getBoundingClientRect).mockReturnValue(new DOMRect(100, window.innerHeight + 20, 200, 100));
    renderer.repositionRings();
    expect(ring.style.display).toBe('none');
    expect(renderer.getRange('figure')).not.toBeNull();
    expect(renderer.annotationAtPoint(150, window.innerHeight + 50)).toBeNull();
  });

  it('clips the original image ring and hit area to a scrolling ancestor', () => {
    const { image, renderer, ring } = render('overflow-x:auto;overflow-y:auto');
    const scroll = image.parentElement!;
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(150, 120, 100, 60));
    Object.defineProperties(scroll, { clientWidth: { value: 100 }, clientHeight: { value: 60 } });
    renderer.repositionRings();
    expect(ring.style.left).toBe('96px');
    expect(ring.style.top).toBe('96px');
    expect(ring.style.clipPath).toBe('inset(24px 54px 24px 54px)');
    expect(renderer.annotationAtPoint(160, 130)).toBe('figure');
    expect(renderer.annotationAtPoint(110, 130)).toBeNull();
    vi.mocked(image.getBoundingClientRect).mockReturnValue(new DOMRect(100, 20, 200, 100));
    renderer.repositionRings();
    expect(ring.style.display).toBe('none');
  });

  it('observes only marked image sizes and disconnects after clearing the last image', () => {
    let resized: ResizeObserverCallback | undefined;
    const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resized = callback; return observer; }
    });
    const { image, renderer, ring } = render();
    expect(observer.observe.mock.calls).toEqual([[image]]);
    vi.mocked(image.getBoundingClientRect).mockReturnValue(new DOMRect(100, 100, 250, 140));
    resized?.([resizedEntry(image)], observer as unknown as ResizeObserver);
    expect(ring.style.width).toBe('252px');
    renderer.clear('figure');
    expect(observer.unobserve).toHaveBeenCalledWith(image);
    expect(observer.disconnect).toHaveBeenCalledOnce();
    vi.mocked(image.getBoundingClientRect).mockClear();
    resized?.([resizedEntry(image)], observer as unknown as ResizeObserver);
    expect(image.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it('stops observing an image removed from the document', () => {
    let resized: ResizeObserverCallback | undefined;
    const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resized = callback; return observer; }
    });
    const { image, ring } = render();
    image.remove();
    resized?.([resizedEntry(image)], observer as unknown as ResizeObserver);
    expect(ring.style.display).toBe('none');
    expect(observer.unobserve).toHaveBeenCalledWith(image);
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps observing an image while another annotation still uses it', () => {
    const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal('ResizeObserver', class { constructor() { return observer; } });
    const { image, renderer } = render();
    renderer.setImage('second', 'teal', image);
    renderer.clear('figure');
    expect(observer.unobserve).not.toHaveBeenCalled();
    expect(observer.disconnect).not.toHaveBeenCalled();
    renderer.clear('second');
    expect(observer.unobserve).toHaveBeenCalledWith(image);
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });
});

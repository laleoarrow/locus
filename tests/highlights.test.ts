import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPalette } from '@/domain/colors';
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

  it('shares geometry reads and skips unchanged ring style assignments', () => {
    document.body.innerHTML = `<main><section><article><div><div>${Array.from({ length: 10 }, (_, i) => `<img id="image-${i}" src="https://example.com/${i}.png">`).join('')}</div></div></article></section></main>`;
    const renderer = new HighlightRenderer(document);
    const images = [...document.querySelectorAll('img')];
    for (const [i, image] of images.entries()) {
      vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(20 + i * 20, 100, 15, 20));
      renderer.setImage(`image-${i}`, 'yellow', image);
    }
    const styles = vi.spyOn(window, 'getComputedStyle');
    const shadow = document.getElementById('locus-ring-host')!.shadowRoot!;
    const setters = [...shadow.querySelectorAll<HTMLElement>('[data-locus-ring]')].flatMap((ring) =>
      (['display', 'left', 'top', 'width', 'height', 'clipPath'] as const).map((key) => vi.spyOn(ring.style, key, 'set')));
    renderer.repositionRings();
    expect(styles).toHaveBeenCalledTimes(17);
    expect(setters.reduce((sum, setter) => sum + setter.mock.calls.length, 0)).toBe(0);
  });


  it('recolours a ring without measuring or recreating its image', () => {
    const { image, renderer, ring } = render();
    vi.mocked(image.getBoundingClientRect).mockClear();
    expect(renderer.recolor('figure', 'teal')).toBe(true);
    expect(document.getElementById('locus-ring-host')!.shadowRoot!.querySelector('[data-locus-ring]')).toBe(ring);
    expect(ring.style.getPropertyValue('--ring-color')).toBe('#4dd0c4');
    expect(image.getBoundingClientRect).not.toHaveBeenCalled();
    const set = vi.spyOn(ring.style, 'setProperty');
    expect(renderer.recolor('figure', 'teal')).toBe(true);
    expect(set).not.toHaveBeenCalled();
    expect(renderer.recolor('missing', 'pink')).toBe(false);
  });

  it('recolours fallback text in place and skips unchanged attributes', () => {
    document.body.innerHTML = '<p>Marked text</p>';
    const paragraph = document.querySelector('p')!;
    const renderer = new HighlightRenderer(document);
    renderer.set('text', 'yellow', range(paragraph.firstChild as Text, 0, 6));
    const mark = paragraph.querySelector('mark')!;
    expect(renderer.recolor('text', 'pink')).toBe(true);
    expect(paragraph.querySelector('mark')).toBe(mark);
    expect(mark.dataset.locusColor).toBe('pink');
    const observer = new MutationObserver(() => {});
    observer.observe(mark, { attributes: true });
    renderer.recolor('text', 'pink');
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it('moves an existing Custom Highlight range to the new colour set', () => {
    const highlights = new Map<string, Set<Range>>();
    vi.stubGlobal('CSS', { highlights });
    vi.stubGlobal('Highlight', class extends Set<Range> {});
    document.body.innerHTML = '<p>Marked text</p>';
    const text = document.querySelector('p')!.firstChild as Text;
    const renderer = new HighlightRenderer(document);
    const selected = range(text, 0, 6);
    renderer.set('text', 'yellow', selected);
    renderer.recolor('text', 'pink');
    expect(renderer.getRange('text')).toBe(selected);
    expect(highlights.get('locus-yellow')?.has(selected)).toBe(false);
    expect(highlights.get('locus-pink')?.has(selected)).toBe(true);
  });

  it('does not replace equal palette styles but applies changed swatches', () => {
    const { renderer, ring } = render();
    const sheet = document.querySelector('#locus-style')!;
    const observer = new MutationObserver(() => {});
    observer.observe(sheet, { childList: true });
    renderer.setPalette(buildPalette([]));
    expect(observer.takeRecords()).toHaveLength(0);
    const palette = buildPalette([]);
    palette[0]!.swatch = '#123456';
    renderer.setPalette(palette);
    renderer.recolor('figure', 'yellow');
    expect(ring.style.getPropertyValue('--ring-color')).toBe('#123456');
    observer.disconnect();
  });


  it('finishes shared clipping reads before writing any moved rings', () => {
    document.body.innerHTML = '<main style="overflow-x:auto;overflow-y:auto"><img src="https://example.test/a.png"><img src="https://example.test/b.png"></main>';
    const scroller = document.querySelector('main')!;
    vi.spyOn(scroller, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(scroller, 'clientHeight', 'get').mockReturnValue(500);
    const bounds = vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
    const images = [...document.querySelectorAll('img')];
    const renderer = new HighlightRenderer(document);
    for (const [i, image] of images.entries()) {
      vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(100 + i * 100, 100, 50, 50));
      renderer.setImage(String(i), 'yellow', image);
    }
    const events: string[] = [];
    bounds.mockClear();
    for (const [i, image] of images.entries()) {
      vi.mocked(image.getBoundingClientRect).mockImplementation(() => {
        events.push(`read-${i}`);
        return new DOMRect(110 + i * 100, 100, 50, 50);
      });
    }
    const rings = [...document.getElementById('locus-ring-host')!.shadowRoot!.querySelectorAll<HTMLElement>('[data-locus-ring]')];
    for (const [i, ring] of rings.entries()) {
      const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ring.style), 'left')!.set!;
      vi.spyOn(ring.style, 'left', 'set').mockImplementation((value) => {
        events.push(`write-${i}`);
        original.call(ring.style, value);
      });
    }
    renderer.repositionRings();
    expect(events).toEqual(['read-0', 'read-1', 'write-0', 'write-1']);
    expect(bounds).toHaveBeenCalledOnce();
    expect(rings.map((ring) => ring.style.left)).toEqual(['106px', '206px']);
  });

  it('measures an image shared by two annotations once per batch', () => {
    const { image, renderer } = render();
    renderer.setImage('second', 'pink', image);
    vi.mocked(image.getBoundingClientRect).mockClear();
    renderer.repositionRings();
    expect(image.getBoundingClientRect).toHaveBeenCalledOnce();
  });

  it('does not read ancestor styles for an image outside the viewport', () => {
    const { image, renderer, ring } = render();
    vi.mocked(image.getBoundingClientRect).mockReturnValue(new DOMRect(100, window.innerHeight + 20, 200, 100));
    const styles = vi.spyOn(window, 'getComputedStyle');
    renderer.repositionRings();
    expect(styles).not.toHaveBeenCalled();
    expect(ring.style.display).toBe('none');
  });


  it('can defer initial image layout until the synchronous batch is complete', () => {
    document.body.innerHTML = '<img src="https://example.test/a.png">';
    const image = document.querySelector('img')!;
    const bounds = vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 100));
    const renderer = new HighlightRenderer(document);
    renderer.setImage('deferred', 'yellow', image, true);
    expect(bounds).not.toHaveBeenCalled();
    renderer.repositionRings();
    expect(bounds).toHaveBeenCalledOnce();
    const ring = document.getElementById('locus-ring-host')!.shadowRoot!.querySelector<HTMLElement>('[data-locus-ring]')!;
    expect(ring.style.left).toBe('96px');
    expect(ring.style.width).toBe('202px');
    bounds.mockClear();
    renderer.setImage('immediate', 'pink', image);
    expect(bounds).toHaveBeenCalledOnce();
  });

});

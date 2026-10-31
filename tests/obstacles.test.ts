import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingObstacles } from '@/content/obstacles';

let obstacles: FloatingObstacles;

function element(parent: Element | ShadowRoot, style = '', rect?: DOMRect): HTMLDivElement {
  const node = document.createElement('div');
  node.style.cssText = style;
  if (rect) vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(rect);
  parent.appendChild(node);
  return node;
}

const barRect = () => new DOMRect(200, 300, 240, 40);

beforeEach(() => {
  document.body.innerHTML = '';
  obstacles = new FloatingObstacles(document);
});

afterEach(() => {
  obstacles.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('floating obstacle discovery', () => {
  it('finds fixed children of deeply nested zero-size shadow hosts', () => {
    let wrapper: Element = document.body;
    for (let i = 0; i < 7; i++) wrapper = element(wrapper);
    const shadow = wrapper.attachShadow({ mode: 'open' });
    element(shadow, 'position:fixed;z-index:1', barRect());
    obstacles.start();
    expect(obstacles.collect()).toEqual([barRect()]);
  });

  it('uses the extension DOM API for closed shadow roots', () => {
    const host = element(document.body);
    const shadow = host.attachShadow({ mode: 'closed' });
    element(shadow, 'position:fixed', barRect());
    vi.stubGlobal('chrome', {
      dom: { openOrClosedShadowRoot: (node: Element) => node === host ? shadow : null },
    });
    obstacles.start();
    expect(obstacles.collect()).toEqual([barRect()]);
  });

  it('looks through full-screen overlays and inherited stacking contexts', () => {
    const wrapper = element(document.body, 'position:fixed;inset:0;pointer-events:none',
      new DOMRect(0, 0, window.innerWidth, window.innerHeight));
    element(element(wrapper), 'position:absolute;pointer-events:auto', barRect());
    const stacking = element(document.body, 'position:relative;z-index:2000');
    const other = new DOMRect(500, 300, 150, 40);
    element(stacking, 'position:absolute', other);
    obstacles.start();
    expect(obstacles.collect()).toEqual([barRect(), other]);
  });

  it('deduplicates wrapper/control boxes while preserving protruding children', () => {
    const wrapper = element(document.body, 'position:fixed', barRect());
    element(wrapper, '', barRect());
    element(wrapper, '', new DOMRect(210, 310, 20, 20));
    const protruding = new DOMRect(430, 310, 30, 20);
    element(wrapper, 'position:absolute', protruding);
    obstacles.start();
    expect(obstacles.collect()).toEqual([barRect(), protruding]);
  });

  it('does not mistake Locus or ordinary article content for rival controls', () => {
    const own = element(document.body);
    own.id = 'locus-host';
    element(own.attachShadow({ mode: 'open' }), 'position:fixed', barRect());
    element(document.body, '', barRect());
    element(document.body, 'position:absolute', barRect());
    obstacles.start();
    expect(obstacles.collect()).toEqual([]);
  });

  it('tracks late additions, visibility, movement and removal', async () => {
    obstacles.start();
    const wrapper = element(document.body, 'opacity:0');
    const bar = element(wrapper, 'position:fixed', barRect());
    await Promise.resolve();
    expect(obstacles.collect()).toEqual([]);
    wrapper.style.opacity = '1';
    await Promise.resolve();
    expect(obstacles.collect()).toEqual([barRect()]);
    const moved = new DOMRect(200, 400, 240, 40);
    vi.mocked(bar.getBoundingClientRect).mockReturnValue(moved);
    expect(obstacles.collect()).toEqual([moved]);
    wrapper.remove();
    expect(obstacles.collect()).toEqual([]);
  });

  it('discovers a shadow root attached later without a document mutation', () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const host = element(document.body);
    obstacles.start();
    element(host.attachShadow({ mode: 'open' }), 'position:fixed', barRect());
    expect(obstacles.collect()).toEqual([]);
    now = 2100;
    expect(obstacles.collect()).toEqual([barRect()]);
  });

  it('invalidates positioning changes without retaining old candidates', async () => {
    const wrapper = element(document.body, '', barRect());
    obstacles.start();
    expect(obstacles.collect()).toEqual([]);
    wrapper.style.position = 'fixed';
    await Promise.resolve();
    expect(obstacles.collect()).toEqual([barRect()]);
    wrapper.style.position = 'static';
    await Promise.resolve();
    expect(obstacles.collect()).toEqual([]);
  });

  it('does not rescan article styles on placement ticks and stops when dismissed', () => {
    document.body.innerHTML = '<article>' + '<p>Long paper text</p>'.repeat(250) + '</article>';
    element(document.body, 'position:fixed', barRect());
    const style = vi.spyOn(window, 'getComputedStyle');
    obstacles.start();
    style.mockClear();
    expect(obstacles.collect()).toEqual([barRect()]);
    expect(obstacles.collect()).toEqual([barRect()]);
    expect(style.mock.calls.every(([node]) => node.tagName !== 'P' && node.tagName !== 'ARTICLE')).toBe(true);
    obstacles.stop();
    style.mockClear();
    expect(obstacles.collect()).toEqual([]);
    expect(style).not.toHaveBeenCalled();
  });
});

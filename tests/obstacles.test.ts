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

  it('ignores the selected positioned card and its ordinary flow content', () => {
    const card = element(document.body, 'position:relative;z-index:2000', new DOMRect(100, 100, 600, 500));
    const selected = element(card, '', new DOMRect(120, 200, 240, 24));
    selected.textContent = 'Selected dictionary definition';
    element(card, '', new DOMRect(120, 250, 560, 300));
    obstacles.start();
    expect(obstacles.collect(selected.firstChild!)).toEqual([]);
    // A new selection outside this card must restore its obstacle status.
    expect(obstacles.collect(document.body)).toEqual([new DOMRect(100, 100, 600, 500)]);
  });

  it('follows assigned slots when selected content is inside a shadow card', () => {
    const host = element(document.body);
    const selected = element(host);
    selected.textContent = 'Slotted dictionary definition';
    const wrapper = element(host.attachShadow({ mode: 'open' }), 'position:relative;z-index:2000',
      new DOMRect(100, 100, 600, 500));
    wrapper.appendChild(document.createElement('slot'));
    element(wrapper, '', new DOMRect(120, 250, 560, 300));
    obstacles.start();
    expect(obstacles.collect(selected.firstChild!)).toEqual([]);
    const bareText = document.createTextNode('Directly slotted text');
    host.appendChild(bareText);
    expect(obstacles.collect(bareText)).toEqual([]);
  });

  it('still avoids independently floating descendants within the selected card', () => {
    const card = element(document.body, 'position:relative;z-index:2000', new DOMRect(100, 100, 600, 500));
    const selected = element(card);
    const rival = element(element(card), 'position:absolute', barRect());
    element(rival, '', new DOMRect(210, 310, 30, 20));
    const shadow = element(card).attachShadow({ mode: 'open' });
    const shadowRect = new DOMRect(500, 300, 150, 40);
    element(shadow, 'position:fixed', shadowRect);
    obstacles.start();
    expect(obstacles.collect(selected)).toEqual([barRect(), shadowRect]);
  });

  it('crosses shadow hosts to ignore the selected container without ignoring an outside overlapping overlay', () => {
    const card = element(document.body, 'position:fixed', new DOMRect(100, 100, 600, 500));
    const shadow = card.attachShadow({ mode: 'open' });
    const image = document.createElement('img');
    shadow.appendChild(image);
    element(shadow, '', new DOMRect(120, 250, 560, 300));
    element(document.body, 'position:fixed', barRect());
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(barRect());
    obstacles.start();
    expect(obstacles.collect(image)).toEqual([barRect()]);
  });

  it('does not promote an ordinary absolute sibling outside any floating context', () => {
    const article = element(document.body);
    const selected = element(article);
    element(article, 'position:absolute', barRect());
    obstacles.start();
    expect(obstacles.collect(selected)).toEqual([]);
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

  it('can probe newly attached shadow roots before reveal without changing idle cadence', () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const host = element(document.body);
    const laterHost = element(document.body);
    obstacles.start();
    element(host.attachShadow({ mode: 'open' }), 'position:fixed', barRect());
    now = 1400;
    expect(obstacles.collect()).toEqual([]);
    expect(obstacles.collect(undefined, true)).toEqual([barRect()]);
    const other = new DOMRect(500, 300, 150, 40);
    element(laterHost.attachShadow({ mode: 'open' }), 'position:fixed', other);
    now = 1900;
    expect(obstacles.collect()).toEqual([barRect()]);
    now = 2400;
    expect(obstacles.collect()).toEqual([barRect(), other]);
  });

  it('limits a forced shadow probe to one cached-host pass on a large document', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const hosts = Array.from({ length: 5000 }, () => element(document.body));
    let shadow: ShadowRoot | undefined;
    const probe = vi.fn((node: Element) => node === hosts[0] ? shadow ?? null : null);
    vi.stubGlobal('chrome', { dom: { openOrClosedShadowRoot: probe } });
    const style = vi.spyOn(window, 'getComputedStyle');
    obstacles.start();
    const startupStyleReads = style.mock.calls.length;
    probe.mockClear();
    style.mockClear();
    shadow = hosts[0]!.attachShadow({ mode: 'closed' });
    element(shadow, 'position:fixed', barRect());
    expect(obstacles.collect()).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
    expect(obstacles.collect(undefined, true)).toEqual([barRect()]);
    expect(probe).toHaveBeenCalledTimes(5004);
    // Host discovery reads no article styles; only the discovered subtree and
    // the visible bar's ancestors need classification/visibility reads.
    expect(startupStyleReads).toBe(5002);
    expect(style).toHaveBeenCalledTimes(8);
    probe.mockClear();
    for (let i = 0; i < 10; i++) expect(obstacles.collect()).toEqual([barRect()]);
    expect(probe).not.toHaveBeenCalled();
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

  it('uses cached floating context when filtering a long selected card on each tick', () => {
    const card = element(document.body, 'position:relative;z-index:2000', new DOMRect(100, 100, 600, 500));
    card.innerHTML = '<p>Dictionary definition</p>'.repeat(250);
    const style = vi.spyOn(window, 'getComputedStyle');
    obstacles.start();
    style.mockClear();
    expect(obstacles.collect(card.firstChild!)).toEqual([]);
    expect(obstacles.collect(card.firstChild!)).toEqual([]);
    expect(style).not.toHaveBeenCalled();
  });

  it('refreshes responsive floating classification when the viewport changes', () => {
    const bar = element(document.body, '', barRect());
    const getStyle = window.getComputedStyle.bind(window);
    let compact = false;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
      const style = getStyle(node);
      if (node === bar) style.position = compact ? 'fixed' : 'static';
      return style;
    });
    obstacles.start();
    expect(obstacles.collect()).toEqual([]);
    compact = true;
    window.dispatchEvent(new Event('resize'));
    expect(obstacles.collect()).toEqual([barRect()]);
    compact = false;
    window.dispatchEvent(new Event('resize'));
    expect(obstacles.collect()).toEqual([]);
  });

  it('scans a dirty subtree only once when its descendants changed in the same batch', async () => {
    const article = element(document.body);
    for (let i = 0; i < 250; i++) element(article);
    const style = vi.spyOn(window, 'getComputedStyle');
    obstacles.start();
    style.mockClear();
    article.className = 'changed';
    for (const child of article.children) child.className = 'changed';
    await Promise.resolve();
    expect(obstacles.collect()).toEqual([]);
    expect(style.mock.calls.filter(([node]) => article.contains(node))).toHaveLength(251);
  });

  it('retains the floating context of a nested shadow host after its stylesheet changes', async () => {
    const outer = element(document.body).attachShadow({ mode: 'open' });
    const host = element(outer, 'position:absolute');
    const inner = host.attachShadow({ mode: 'open' });
    element(inner, '', barRect());
    obstacles.start();
    expect(obstacles.collect()).toEqual([barRect()]);
    inner.appendChild(document.createElement('style'));
    await Promise.resolve();
    expect(obstacles.collect()).toEqual([barRect()]);
  });
});

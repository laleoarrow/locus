import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { LocusContent } from '@/entrypoints/content';
import { LocusUI } from '@/content/ui';
import { FloatingObstacles } from '@/content/obstacles';
import * as selectionGeometry from '@/content/selectionGeometry';
import type { Prefs } from '@/domain/types';

vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (value: unknown) => value }));

const prefs: Prefs = { placement: 'auto', customColors: [], disabledSites: [], detectDoi: false, checkUpdates: false };
const listeners: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];
const windowListeners: typeof listeners = [];
let reader: LocusContent;
let request: ReturnType<typeof vi.fn>;
let show: MockInstance<LocusUI['showToolbar']>;
let collect: MockInstance<FloatingObstacles['collect']>;

function controls() {
  return reader as unknown as {
    showToolbarForSelection(): boolean;
    refreshToolbar(): void;
    applyPrefs(prefs: Prefs): void;
    wirePointer(): void;
    wireKeyboard(): void;
    wireViewport(): void;
    hideToolbar(): void;
    deactivate(): void;
  };
}
function select(id = 'first', showToolbar = true) {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById(id)!.firstChild!);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  if (showToolbar) controls().showToolbarForSelection();
}
function key(value: string, options: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '<p id="first" data-y="200">first excerpt</p><p id="second" data-y="400">second excerpt</p>';
  document.querySelectorAll('#locus-host, #locus-ring-host').forEach((element) => element.remove());
  getSelection()!.removeAllRanges();
  vi.stubGlobal('CSS', { highlights: new Map() });
  vi.stubGlobal('Highlight', class extends Set<Range> {});
  request = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', { runtime: { sendMessage: request } });
  vi.spyOn(FloatingObstacles.prototype, 'start').mockImplementation(() => {});
  vi.spyOn(FloatingObstacles.prototype, 'stop').mockImplementation(() => {});
  collect = vi.spyOn(FloatingObstacles.prototype, 'collect').mockReturnValue([]);
  vi.spyOn(selectionGeometry, 'selectionTextRect').mockImplementation((range) =>
    new DOMRect(200, Number(range.startContainer.parentElement!.dataset['y']), 100, 20));
  reader = new LocusContent();
  controls().applyPrefs({ ...prefs });
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener, options]);
    add(type, listener, options);
  });
  const addWindow = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    windowListeners.push([type, listener, options]);
    addWindow(type, listener, options);
  });
  controls().wirePointer();
  controls().wireKeyboard();
  show = vi.spyOn(LocusUI.prototype, 'showToolbar');
});

afterEach(() => {
  controls().hideToolbar();
  for (const [type, listener, options] of listeners.splice(0)) document.removeEventListener(type, listener, options);
  for (const [type, listener, options] of windowListeners.splice(0)) window.removeEventListener(type, listener, options);
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('initial Auto toolbar reveal', () => {
  it('waits hidden, then measures the latest text and rivals without resetting on refreshes', async () => {
    select();
    await vi.advanceTimersByTimeAsync(200);
    expect(show).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
    document.getElementById('first')!.dataset['y'] = '320';
    const rivals = [{ left: 100, right: 500, top: 345, bottom: 500 }];
    collect.mockReturnValue(rivals);
    controls().refreshToolbar();
    controls().showToolbarForSelection(); // Duplicate keyup does not postpone first paint.
    controls().applyPrefs({ ...prefs, detectDoi: true });
    await vi.advanceTimersByTimeAsync(99);
    expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]).toEqual([new DOMRect(200, 320, 100, 20), 'yellow', 'auto', rivals]);
    await vi.advanceTimersByTimeAsync(200);
    expect(show).toHaveBeenCalledTimes(2); // Later avoidance is unchanged.
  });

  it.each(['Escape', 'mousedown', 'collapse', 'disable'])('cancels a waiting reveal on %s', async (action) => {
    select();
    await vi.advanceTimersByTimeAsync(80);
    if (action === 'Escape') key('Escape');
    if (action === 'mousedown') document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    if (action === 'collapse') {
      getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    }
    if (action === 'disable') controls().deactivate();
    await vi.advanceTimersByTimeAsync(600);
    expect(show).not.toHaveBeenCalled();
  });

  it('does not resurrect queued mouseup work after Escape', async () => {
    select('first', false);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    key('Escape');
    await vi.advanceTimersByTimeAsync(600);
    expect(show).not.toHaveBeenCalled();
  });

  it('replaces a waiting target and never reveals the old selection', async () => {
    select();
    await vi.advanceTimersByTimeAsync(80);
    select('second');
    await vi.advanceTimersByTimeAsync(220);
    expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(179);
    expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![0].top).toBe(400);
  });

  it('keeps a queued keyup for the new selection when selectionchange retires the old target', async () => {
    select();
    await vi.advanceTimersByTimeAsync(80);
    select('second', false);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));
    await vi.advanceTimersByTimeAsync(400);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![0].top).toBe(400);
  });

  it('waits for an entering rival to settle before its first visible frame', async () => {
    const started = Date.now();
    collect.mockImplementation(() => {
      const top = Math.min(Date.now() - started, 500);
      return [{ left: 100, right: 500, top, bottom: top + 40 }];
    });
    select();
    await vi.advanceTimersByTimeAsync(599);
    expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![3]).toEqual([{ left: 100, right: 500, top: 500, bottom: 540 }]);
  });

  it('probes newly attached shadows once before revealing and retains the normal visible cadence', async () => {
    const started = Date.now();
    const probes: number[] = [];
    collect.mockImplementation((_anchor, probeShadows) => {
      if (probeShadows) probes.push(Date.now() - started);
      const top = Math.min(Date.now() - started, 500);
      return [{ left: 100, right: 500, top, bottom: top + 40 }];
    });
    select();
    await vi.advanceTimersByTimeAsync(600);
    expect(show).toHaveBeenCalledTimes(1);
    expect(probes).toEqual([400]);
    expect(collect.mock.calls.slice(0, 2).map((call) => call[1])).toEqual([false, false]);
    const before = collect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(400);
    expect(collect.mock.calls.slice(before).map((call) => call[1])).toEqual([false, false]);
    expect(probes).toEqual([400]);
    select('second');
    await vi.advanceTimersByTimeAsync(400);
    expect(probes).toEqual([400, 1400]);
  });

  it('bounds preflight even when a rival never stops moving', async () => {
    const started = Date.now();
    collect.mockImplementation(() => {
      const top = Date.now() - started;
      return [{ left: 100, right: 500, top, bottom: top + 40 }];
    });
    select();
    await vi.advanceTimersByTimeAsync(699);
    expect(show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-progress geometry settle without a later reveal', async () => {
    select();
    await vi.advanceTimersByTimeAsync(350);
    expect(collect).toHaveBeenCalled();
    key('Escape');
    const calls = collect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(600);
    expect(show).not.toHaveBeenCalled();
    expect(collect).toHaveBeenCalledTimes(calls);
  });

  it('keeps digits immediate during the wait and never reveals after saving', async () => {
    select();
    await vi.advanceTimersByTimeAsync(60);
    expect(key('2').defaultPrevented).toBe(true);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'annotation:create', color: 'teal',
      anchor: expect.objectContaining({ exact: 'first excerpt' }) }));
    await vi.advanceTimersByTimeAsync(600);
    expect(show).not.toHaveBeenCalled();
  });

  it('leaves composing and editable digits native during the wait', async () => {
    select();
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(key('2', { isComposing: true }).defaultPrevented).toBe(false);
    expect(key('2', {}, input).defaultPrevented).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('reveals immediately when a pending Auto target switches to an explicit side', async () => {
    select();
    await vi.advanceTimersByTimeAsync(80);
    controls().applyPrefs({ ...prefs, placement: 'above' });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![2]).toBe('above');
    await vi.advanceTimersByTimeAsync(600);
    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe('visible toolbar selection safety and viewport work', () => {
  function toolbar() {
    return document.getElementById('locus-host')!.shadowRoot!
      .querySelector<HTMLElement>('[data-locus-toolbar]')!;
  }

  it.each(['collapse', 'replace'])('retires a visible stale target on selection %s before a digit can save it', async (action) => {
    select();
    await vi.advanceTimersByTimeAsync(400);
    expect(toolbar().classList.contains('hidden')).toBe(false);
    if (action === 'collapse') getSelection()!.removeAllRanges();
    else select('second', false);
    document.dispatchEvent(new Event('selectionchange'));
    expect(toolbar().classList.contains('hidden')).toBe(true);
    expect(key('2').defaultPrevented).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(request).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('checks the live selection before a visible digit even if selectionchange has not arrived', async () => {
    select();
    await vi.advanceTimersByTimeAsync(400);
    select('second', false);
    expect(key('2').defaultPrevented).toBe(false);
    expect(toolbar().classList.contains('hidden')).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['button', 'picker'])('retains its capture while the own %s has focus', async (control) => {
    select();
    await vi.advanceTimersByTimeAsync(400);
    const bar = toolbar();
    const focused = control === 'button' ? bar.querySelector<HTMLButtonElement>('[data-color=teal]')!
      : bar.querySelector<HTMLInputElement>('input[type=color]')!;
    focused.focus();
    expect(document.getElementById('locus-host')!.shadowRoot!.activeElement).toBe(focused);
    getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    controls().refreshToolbar();
    expect(bar.classList.contains('hidden')).toBe(false);
    bar.querySelector<HTMLButtonElement>('[data-color=teal]')!.click();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'annotation:create', color: 'teal',
      anchor: expect.objectContaining({ exact: 'first excerpt' }) }));
    await vi.advanceTimersByTimeAsync(500);
    expect(bar.classList.contains('hidden')).toBe(true);
  });

  it('coalesces twenty scroll events into one toolbar refresh per frame', async () => {
    select();
    await vi.advanceTimersByTimeAsync(400);
    let frame: FrameRequestCallback | undefined;
    const raf = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal('requestAnimationFrame', raf);
    controls().wireViewport();
    const refresh = vi.spyOn(controls(), 'refreshToolbar');
    show.mockClear();
    collect.mockClear();
    for (let i = 0; i < 20; i++) document.dispatchEvent(new Event('scroll'));
    expect(refresh).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
    frame!(performance.now());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('scroll'));
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('defers a mixed resize and scroll burst until later resize listeners invalidate geometry', async () => {
    select();
    await vi.advanceTimersByTimeAsync(400);
    let frame: FrameRequestCallback | undefined;
    const raf = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal('requestAnimationFrame', raf);
    controls().wireViewport();
    let invalidated = false;
    // FloatingObstacles starts after viewport wiring in the real lifecycle.
    window.addEventListener('resize', () => { invalidated = true; });
    collect.mockImplementation(() => {
      expect(invalidated).toBe(true);
      return [];
    });
    const refresh = vi.spyOn(controls(), 'refreshToolbar');
    show.mockClear();
    collect.mockClear();
    for (let i = 0; i < 20; i++) {
      invalidated = false;
      window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new Event('scroll'));
    }
    expect(refresh).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
    frame!(performance.now());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });
});

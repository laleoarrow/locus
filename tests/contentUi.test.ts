import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocusUI, type NoteEditorOptions } from '@/content/ui';
import { LOCUS_HOST_ID } from '@/domain/anchor/textIndex';
import { buildPalette, type PaletteEntry } from '@/domain/colors';

const editors: LocusUI[] = [];

function setup(overrides: Partial<NoteEditorOptions> = {}) {
  const ui = new LocusUI(document, { onHighlight: vi.fn(), onAddColor: vi.fn(), onDisableSite: vi.fn() });
  editors.push(ui);
  const options: NoteEditorOptions = {
    rect: new DOMRect(100, 100, 120, 20), color: 'yellow', initial: '',
    onSave: vi.fn(), onDelete: vi.fn(), ...overrides,
  };
  ui.openNoteEditor(options);
  const shadow = document.getElementById(LOCUS_HOST_ID)!.shadowRoot!;
  const card = shadow.querySelector<HTMLElement>('[data-locus-note]')!;
  const textarea = card.querySelector('textarea')!;
  const save = card.querySelector<HTMLButtonElement>('[data-locus-note-save]')!;
  const remove = card.querySelector<HTMLButtonElement>('[data-locus-note-delete]')!;
  return { ui, options, shadow, card, textarea, save, remove };
}

function edit(textarea: HTMLTextAreaElement, text: string) {
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(textarea: HTMLTextAreaElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  textarea.dispatchEvent(event);
  return event;
}

function pending() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.closeNoteEditor(true);
  document.getElementById(LOCUS_HOST_ID)?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('in-page note editor', () => {
  it.each(['Enter', 'Escape', 'Delete', 'Backspace'])('does not treat composing %s as a note command', (pressed) => {
    const { ui, options, textarea } = setup();
    const event = key(textarea, pressed, { isComposing: true });
    expect(ui.isNoteOpen()).toBe(true);
    expect(options.onSave).not.toHaveBeenCalled();
    expect(options.onDelete).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('guards composition lifecycle and legacy IME key events before allowing ordinary Enter', async () => {
    const { ui, options, textarea } = setup();
    textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    key(textarea, 'Enter');
    expect(options.onSave).not.toHaveBeenCalled();
    textarea.dispatchEvent(new CompositionEvent('compositionend'));
    key(textarea, 'Enter', { keyCode: 229 });
    expect(options.onSave).not.toHaveBeenCalled();
    edit(textarea, '中文笔记');
    key(textarea, 'Enter');
    await Promise.resolve();
    expect(options.onSave).toHaveBeenCalledWith('中文笔记');
    expect(ui.isNoteOpen()).toBe(false);
  });

  it('retains the draft until save succeeds and ignores duplicate save/delete/cancel commands', async () => {
    const request = pending();
    const onSave = vi.fn(() => request.promise);
    const { ui, options, textarea, save, remove, card } = setup({ onSave });
    edit(textarea, '未保存的草稿');
    save.click();
    expect(ui.isNoteOpen()).toBe(true);
    expect(textarea.readOnly).toBe(true);
    expect(save.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    save.click();
    remove.click();
    key(textarea, 'Enter');
    key(textarea, 'Delete', { ctrlKey: true });
    key(textarea, 'Escape');
    ui.closeNoteEditor();
    expect(ui.isNoteOpen()).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(options.onDelete).not.toHaveBeenCalled();
    expect(card.getAttribute('aria-busy')).toBe('true');
    request.resolve();
    await Promise.resolve();
    expect(ui.isNoteOpen()).toBe(false);
  });

  it('keeps a failed save editable and allows a successful retry with the same draft', async () => {
    const request = pending();
    const onSave = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValueOnce(undefined);
    const { ui, textarea, save, card } = setup({ initial: '原笔记', onSave });
    edit(textarea, '修订后的中文草稿');
    save.click();
    request.reject(new Error('Could not save the note. Try again.'));
    await Promise.resolve();
    expect(ui.isNoteOpen()).toBe(true);
    expect(textarea.value).toBe('修订后的中文草稿');
    expect(card.querySelector('[role="alert"]')?.textContent).toContain('Could not save');
    expect(save.disabled).toBe(false);
    expect(textarea.readOnly).toBe(false);
    save.click();
    await Promise.resolve();
    expect(onSave).toHaveBeenNthCalledWith(2, '修订后的中文草稿');
    expect(ui.isNoteOpen()).toBe(false);
  });

  it('retains the note when deleting fails, then closes only after a successful retry', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('Could not remove the highlight.'))
      .mockResolvedValueOnce(undefined);
    const { ui, textarea, card, remove } = setup({ initial: '图像或文字批注', onDelete });
    remove.click();
    await Promise.resolve();
    expect(ui.isNoteOpen()).toBe(true);
    expect(textarea.value).toBe('图像或文字批注');
    expect(card.querySelector('[role="alert"]')?.textContent).toContain('Could not remove');
    remove.click();
    await Promise.resolve();
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(ui.isNoteOpen()).toBe(false);
  });

  it('repositions an open note after the viewport becomes narrower and shorter', () => {
    const { card, textarea } = setup({ rect: new DOMRect(300, 500, 120, 20) });
    vi.spyOn(card, 'offsetWidth', 'get').mockImplementation(() => Math.min(300, window.innerWidth - 16));
    vi.spyOn(card, 'offsetHeight', 'get').mockReturnValue(120);
    edit(textarea, 'Keep this draft on screen');
    expect(Number.parseFloat(card.style.left)).toBe(300);
    vi.stubGlobal('innerWidth', 180);
    vi.stubGlobal('innerHeight', 180);
    window.dispatchEvent(new Event('resize'));
    expect(Number.parseFloat(card.style.left)).toBe(8);
    expect(Number.parseFloat(card.style.top)).toBeLessThanOrEqual(52);
    expect(textarea.value).toBe('Keep this draft on screen');
  });

  it('does not silently discard dirty text on Escape, an outside close, or another annotation click', () => {
    const { ui, options, textarea, card } = setup({ initial: '原有笔记' });
    edit(textarea, '还没有保存的修改');
    key(textarea, 'Escape');
    expect(ui.isNoteOpen()).toBe(true);
    ui.closeNoteEditor();
    expect(ui.isNoteOpen()).toBe(true);
    ui.openNoteEditor({ ...options, initial: '另一条批注' });
    expect(card.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('还没有保存的修改');
    const cancel = [...card.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!;
    cancel.click();
    expect(ui.isNoteOpen()).toBe(false);
    expect(options.onSave).not.toHaveBeenCalled();
    expect(options.onDelete).not.toHaveBeenCalled();
  });

  it('allows Escape and outside clicks to close an unchanged note', () => {
    const { ui, options, textarea } = setup({ initial: '原有笔记' });
    key(textarea, 'Escape');
    expect(ui.isNoteOpen()).toBe(false);
    ui.openNoteEditor(options);
    ui.closeNoteEditor();
    expect(ui.isNoteOpen()).toBe(false);
  });
});

describe('toolbar repeated-update work', () => {
  function toolbarSetup() {
    const actions = { onHighlight: vi.fn(), onAddColor: vi.fn(), onDisableSite: vi.fn() };
    const ui = new LocusUI(document, actions);
    editors.push(ui);
    const palette = buildPalette([]);
    ui.setPalette(palette);
    const shadow = document.getElementById(LOCUS_HOST_ID)!.shadowRoot!;
    const toolbar = shadow.querySelector<HTMLElement>('[data-locus-toolbar]')!;
    const width = vi.spyOn(toolbar, 'offsetWidth', 'get').mockReturnValue(180);
    const height = vi.spyOn(toolbar, 'offsetHeight', 'get').mockReturnValue(44);
    const anchor = new DOMRect(240, 200, 100, 20);
    ui.showToolbar(anchor, 'yellow', 'auto');
    return { ui, actions, palette, shadow, toolbar, width, height, anchor };
  }

  it('measures a newly opened toolbar while hidden and reveals only after assigning its position', () => {
    const { ui, toolbar, width, height, anchor } = toolbarSetup();
    ui.hideToolbar();
    width.mockImplementation(() => {
      expect(ui.isToolbarVisible()).toBe(false);
      expect(toolbar.classList.contains('measuring')).toBe(true);
      return 180;
    });
    height.mockImplementation(() => {
      expect(ui.isToolbarVisible()).toBe(false);
      return 44;
    });
    ui.showToolbar(anchor, 'yellow', 'below');
    expect(ui.isToolbarVisible()).toBe(true);
    expect(toolbar.classList.contains('measuring')).toBe(false);
    expect(toolbar.style.top).toBe('230px');
    expect(toolbar.style.left).toBe('200px');
  });

  it('keeps existing focused buttons and the native colour input on identical palette updates', () => {
    const { ui, actions, palette, shadow, toolbar } = toolbarSetup();
    const button = toolbar.querySelector<HTMLButtonElement>('.swatch')!;
    const input = toolbar.querySelector<HTMLInputElement>('input[type="color"]')!;
    input.value = '#123456';
    button.focus();
    const observer = new MutationObserver(() => {});
    observer.observe(toolbar, { childList: true, attributes: true, subtree: true });
    for (let i = 0; i < 20; i++) ui.setPalette(palette.map((entry) => ({ ...entry })));
    const records = observer.takeRecords();
    observer.disconnect();
    expect({ childLists: records.filter((record) => record.type === 'childList').length,
      attributes: records.filter((record) => record.type === 'attributes').length }).toEqual({ childLists: 0, attributes: 0 });
    expect(toolbar.querySelector('.swatch')).toBe(button);
    expect(shadow.activeElement).toBe(button);
    expect(toolbar.querySelector('input[type="color"]')).toBe(input);
    expect(input.value).toBe('#123456');
    input.dispatchEvent(new Event('change'));
    expect(actions.onAddColor).toHaveBeenCalledWith('#123456');
    button.click();
    expect(actions.onHighlight).toHaveBeenCalledWith('yellow');
  });

  it('measures every static Auto tick without repeatedly writing unchanged DOM attributes', () => {
    const { ui, shadow, toolbar, width, height, anchor } = toolbarSetup();
    width.mockClear(); height.mockClear();
    const reference = shadow.querySelector<HTMLElement>('.coordinate-reference')!;
    const coordinates = vi.spyOn(reference, 'getBoundingClientRect');
    const leftWrites = vi.spyOn(toolbar.style, 'left', 'set');
    const topWrites = vi.spyOn(toolbar.style, 'top', 'set');
    const observer = new MutationObserver(() => {});
    observer.observe(shadow, { attributes: true, childList: true, subtree: true });
    for (let i = 0; i < 20; i++) ui.showToolbar(anchor, 'yellow', 'auto');
    const records = observer.takeRecords();
    observer.disconnect();
    expect({ attributeWrites: records.length, widthReads: width.mock.calls.length,
      heightReads: height.mock.calls.length, positionWrites: leftWrites.mock.calls.length + topWrites.mock.calls.length })
      .toEqual({ attributeWrites: 0, widthReads: 20, heightReads: 20, positionWrites: 0 });
    expect(coordinates).toHaveBeenCalledTimes(20);
    expect(shadow.querySelector('.coordinate-reference')).toBe(reference);
  });

  it.each([
    { origin: [35, 300], scale: [1, 1] },
    { origin: [0, 0], scale: [1.5, 1.5] },
    { origin: [-40, 120], scale: [0.75, 1.25] },
  ])('places a toolbar in viewport coordinates with root mapping $origin / $scale', ({ origin, scale }) => {
    const { ui, shadow, toolbar } = toolbarSetup();
    const reference = shadow.querySelector<HTMLElement>('.coordinate-reference')!;
    vi.spyOn(reference, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(origin[0]!, origin[1]!, 100 * scale[0]!, 100 * scale[1]!),
    );
    const anchor = new DOMRect(300, 500, 20, 20);
    ui.showToolbar(anchor, 'yellow', 'below');
    const rendered = () => ({
      left: Number.parseFloat(toolbar.style.left) * scale[0]! + origin[0]!,
      top: Number.parseFloat(toolbar.style.top) * scale[1]! + origin[1]!,
    });
    expect(rendered().top).toBeCloseTo(530);
    expect(rendered().left + 90 * scale[0]!).toBeCloseTo(310);
    expect(Number.parseFloat(toolbar.style.maxWidth) * scale[0]!).toBeCloseTo(window.innerWidth - 16);
    // Chromium serializes e.g. 116.6666667px as 116.667px. Static Auto work
    // must remain read-only after that CSSOM rounding.
    for (const property of ['left', 'top', 'maxWidth'] as const) {
      toolbar.style[property] = `${Number.parseFloat(toolbar.style[property]).toFixed(3)}px`;
    }
    const observer = new MutationObserver(() => {});
    observer.observe(shadow, { attributes: true, childList: true, subtree: true });
    ui.showToolbar(anchor, 'yellow', 'below');
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();

    ui.showToolbar(anchor, 'yellow', 'auto', [{ left: 0, top: 525, right: 1000, bottom: 650 }]);
    expect(toolbar.dataset['placement']).toBe('above');
    expect(rendered().top + 44 * scale[1]!).toBeCloseTo(490);
  });

  it('applies changed last colour, obstacles, viewport, dimensions and palette immediately', () => {
    const { ui, actions, palette, toolbar, width, anchor } = toolbarSetup();
    const below = { left: 0, top: 225, right: 1000, bottom: 300 };
    ui.showToolbar(anchor, 'teal', 'auto', [below]);
    expect(toolbar.dataset['placement']).toBe('above');
    expect(toolbar.querySelector<HTMLElement>('[data-color="teal"]')!.dataset['last']).toBe('true');
    expect(toolbar.querySelector<HTMLElement>('[data-color="yellow"]')!.dataset['last']).toBe('false');
    vi.stubGlobal('innerWidth', 240);
    width.mockReturnValue(220);
    ui.showToolbar(anchor, 'pink', 'below');
    expect(Number.parseFloat(toolbar.style.left)).toBe(12);
    expect(toolbar.dataset['placement']).toBe('below');
    const custom: PaletteEntry = { key: 'c123456', label: 'Custom blue', swatch: '#123456', bg: '#12345680' };
    ui.setPalette([...palette, custom]);
    const customButton = toolbar.querySelector<HTMLButtonElement>('[data-color="c123456"]')!;
    expect(customButton.title).toBe('Custom blue — press 4');
    expect(customButton.dataset['shortcut']).toBe('4');
    expect(customButton.style.getPropertyValue('--c')).toBe('#123456');
    customButton.click();
    expect(actions.onHighlight).toHaveBeenCalledWith('c123456');
    ui.setPalette([{ ...palette[0]!, label: 'Renamed', swatch: '#fedcba' }, ...palette.slice(1)]);
    expect(toolbar.querySelector<HTMLButtonElement>('.swatch')!.title).toBe('Renamed — press 1');
    expect(toolbar.querySelector<HTMLElement>('.swatch')!.style.getPropertyValue('--c')).toBe('#fedcba');
    ui.hideToolbar();
    ui.showToolbar(anchor, 'yellow', 'auto');
    expect(ui.isToolbarVisible()).toBe(true);
  });

  it('refreshes note-only render colours even when toolbar choices are unchanged', () => {
    const { ui, palette, shadow, toolbar } = toolbarSetup();
    const button = toolbar.querySelector('.swatch');
    const custom: PaletteEntry = { key: 'c123456', label: 'Old annotation colour', swatch: '#abcdef', bg: '#abcdef80' };
    ui.setPalette(palette, [...palette, custom]);
    expect(toolbar.querySelector('.swatch')).toBe(button);
    ui.openNoteEditor({ rect: new DOMRect(100, 100, 40, 20), color: custom.key, initial: '', onSave: vi.fn(), onDelete: vi.fn() });
    expect(shadow.querySelector<HTMLElement>('[data-locus-note]')!.style.getPropertyValue('--c')).toBe('#abcdef');
  });
});

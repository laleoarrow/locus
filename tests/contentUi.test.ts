import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocusUI, type NoteEditorOptions } from '@/content/ui';
import { LOCUS_HOST_ID } from '@/domain/anchor/textIndex';

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

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAnnotation, LibraryPage } from '@/domain/library';
import { requestBg } from '@/messaging/protocol';
import { AnnotationRow } from '@/entrypoints/library/components/AnnotationRow';
import { NoteDraftProvider } from '@/entrypoints/library/components/NoteDraftContext';
import { BulkEditActions } from '@/entrypoints/library/components/BulkEditActions';
import type { AnnotationEditExpectation } from '@/domain/editing';

vi.mock('@/messaging/protocol', () => ({ requestBg: vi.fn() }));

const original: LibraryAnnotation = {
  id: 'a1', sourceId: 's1', documentId: 'd1', color: 'yellow', quote: 'Source excerpt',
  note: 'Note A', isImage: false, imageSrc: '', createdAt: 10, updatedAt: 10,
  colorUpdatedAt: 10, deletedAt: 0, deleted: false, detached: false,
};
const page: LibraryPage = {
  sourceId: 's1', documentId: 'd1', url: 'https://example.test/page', urlKey: 'https://example.test/page',
  title: 'Page', origin: 'https://example.test', doi: '', annotations: [original], lastActivityAt: 10,
};
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(requestBg).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(annotation = original) {
  await act(async () => root.render(createElement(NoteDraftProvider, {
    children: createElement(AnnotationRow, { page, annotation, query: '', customColors: [] }),
  })));
}
async function hideRow() {
  await act(async () => root.render(createElement(NoteDraftProvider, { children: createElement('div') })));
}
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }
function button(label: string) {
  return [...host.querySelectorAll('button')].find((entry) => entry.textContent === label)!;
}
async function type(text: string) {
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Library note edit session', () => {
  it('opens the current note after a live update instead of the initial render value', async () => {
    await render();
    await render({ ...original, note: 'Note B from another tab', updatedAt: 20 });
    await click(button('Edit note'));
    expect(host.querySelector('textarea')?.value).toBe('Note B from another tab');
  });

  it('sends the version captured when editing began and retains the draft on conflict', async () => {
    vi.mocked(requestBg).mockResolvedValue({ updated: 0, error: 'The selected annotations changed.' });
    await render();
    await click(button('Edit note'));
    await type('My unsaved edit');
    await render({ ...original, note: 'External note B', updatedAt: 20, colorUpdatedAt: 30 });
    await click(button('Save'));
    expect(requestBg).toHaveBeenCalledWith({
      type: 'annotations:edit',
      expected: [{ id: 'a1', updatedAt: 10, colorUpdatedAt: 10, deletedAt: 0 }],
      action: { type: 'comment', comment: 'My unsaved edit', mode: 'replace' },
    });
    expect(host.querySelector('textarea')?.value).toBe('My unsaved edit');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('changed');
    await click(button('Cancel'));
    await click(button('Edit note'));
    expect(host.querySelector('textarea')?.value).toBe('External note B');
  });

  it.each(['missing', 'rejected'])('retains a draft after a %s response and permits retry', async (failure) => {
    if (failure === 'missing') vi.mocked(requestBg).mockResolvedValueOnce(undefined as never);
    else vi.mocked(requestBg).mockRejectedValueOnce(new Error('Storage unavailable'));
    vi.mocked(requestBg).mockResolvedValueOnce({ updated: 1 });
    await render();
    await click(button('Edit note'));
    await type('Draft worth keeping');
    await click(button('Save'));
    expect(host.querySelector('textarea')?.value).toBe('Draft worth keeping');
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(button('Save').disabled).toBe(false);
    await click(button('Save'));
    expect(requestBg).toHaveBeenCalledTimes(2);
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('locks the editor while saving and coalesces immediate duplicate clicks', async () => {
    let release!: (result: { updated: number }) => void;
    const held = new Promise<{ updated: number }>((resolve) => { release = resolve; });
    vi.mocked(requestBg).mockReturnValue(held);
    await render();
    await click(button('Edit note'));
    await type('Pending draft');
    const save = button('Save');
    await act(async () => { save.click(); save.click(); });
    expect(requestBg).toHaveBeenCalledTimes(1);
    expect(host.querySelector('textarea')?.disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    expect(host.querySelector('.annotation')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => { release({ updated: 1 }); await held; });
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('restores a hidden editor with its draft and original version when the row returns', async () => {
    vi.mocked(requestBg).mockResolvedValue({ updated: 0, error: 'The selected annotations changed.' });
    await render();
    await click(button('Edit note'));
    await type('Draft before changing the view');
    await hideRow();
    await render({ ...original, note: 'External update while hidden', updatedAt: 20 });
    expect(host.querySelector('textarea')?.value).toBe('Draft before changing the view');
    await click(button('Save'));
    expect(requestBg).toHaveBeenCalledWith(expect.objectContaining({
      expected: [{ id: 'a1', updatedAt: 10, colorUpdatedAt: 10, deletedAt: 0 }],
    }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('changed');
  });

  it('retains a failed in-flight save while the row is unmounted and restores retry state', async () => {
    let reject!: (error: Error) => void;
    const held = new Promise<never>((_yes, no) => { reject = no; });
    vi.mocked(requestBg).mockReturnValueOnce(held).mockResolvedValueOnce({ updated: 1 });
    await render();
    await click(button('Edit note'));
    await type('Draft survives a hidden failure');
    await click(button('Save'));
    await hideRow();
    await render();
    expect(host.querySelector('textarea')?.disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    expect(requestBg).toHaveBeenCalledTimes(1);
    await hideRow();
    await act(async () => { reject(new Error('Storage unavailable')); await held.catch(() => undefined); });
    await render();
    expect(host.querySelector('textarea')?.value).toBe('Draft survives a hidden failure');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Storage unavailable');
    expect(button('Save').disabled).toBe(false);
    await click(button('Save'));
    expect(requestBg).toHaveBeenCalledTimes(2);
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('keeps drafts for different annotation identities independent across view changes', async () => {
    vi.mocked(requestBg).mockResolvedValue({ updated: 1 });
    await render();
    await click(button('Edit note'));
    await type('First draft');
    const second = { ...original, id: 'a2', note: 'Second saved note' };
    await render(second);
    await click(button('Edit note'));
    await type('Second draft');
    await render();
    expect(host.querySelector('textarea')?.value).toBe('First draft');
    await click(button('Save'));
    await render(second);
    expect(host.querySelector('textarea')?.value).toBe('Second draft');
    await click(button('Cancel'));
    await render();
    expect(host.querySelector('textarea')).toBeNull();
    await render(second);
    expect(host.querySelector('textarea')).toBeNull();
  });
});

describe('selected annotation preview', () => {
  const snapshot: AnnotationEditExpectation = { id: 'a1', updatedAt: 10, colorUpdatedAt: 10, deletedAt: 0 };
  const onApply = vi.fn();
  async function renderBulk(selected: AnnotationEditExpectation[]) {
    await act(async () => root.render(createElement(BulkEditActions, {
      count: selected.length, pageCount: 1, selected, palette: [], deletedOnly: false, busy: false,
      onSelectAll: vi.fn(), onClear: vi.fn(), onExit: vi.fn(), onSummarize: vi.fn(), onApply,
    })));
  }
  beforeEach(() => { onApply.mockReset(); });

  it('freezes versions when the action preview opens, before another tab changes the note', async () => {
    onApply.mockResolvedValue(1);
    await renderBulk([snapshot]);
    await click(host.querySelector('[data-selection="delete"]')!);
    await renderBulk([{ ...snapshot, updatedAt: 20 }]);
    await click(host.querySelector('[data-selection="apply"]')!);
    expect(onApply).toHaveBeenCalledWith({ type: 'delete' }, [snapshot]);
  });

  it('closes the old preview when the selected annotation identities change', async () => {
    await renderBulk([snapshot]);
    await click(host.querySelector('[data-selection="delete"]')!);
    expect(host.querySelector('[data-selection="apply"]')).not.toBeNull();
    await renderBulk([{ ...snapshot, id: 'a2' }]);
    expect(host.querySelector('[data-selection="apply"]')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps a rejected preview snapshot and prevents two immediate Apply requests', async () => {
    let reject!: (error: Error) => void;
    const held = new Promise<number>((_resolve, no) => { reject = no; });
    onApply.mockReturnValueOnce(held).mockRejectedValueOnce(new Error('The selected annotations changed.'));
    await renderBulk([snapshot]);
    await click(host.querySelector('[data-selection="delete"]')!);
    const apply = host.querySelector<HTMLButtonElement>('[data-selection="apply"]')!;
    await act(async () => { apply.click(); apply.click(); });
    expect(onApply).toHaveBeenCalledTimes(1);
    await act(async () => { reject(new Error('The selected annotations changed.')); await held.catch(() => undefined); });
    await renderBulk([{ ...snapshot, updatedAt: 20 }]);
    await click(host.querySelector('[data-selection="apply"]')!);
    expect(onApply).toHaveBeenNthCalledWith(2, { type: 'delete' }, [snapshot]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('changed');
  });
});

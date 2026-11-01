import type { BrowserContext, Page } from '@playwright/test';
import { BASE_URL, expect, highlight, test } from './extension';

async function setup(context: BrowserContext, extensionId: string) {
  const article = await context.newPage();
  await article.goto(`${BASE_URL}/fixtures/nested.html`);
  await highlight(article, '#probe-2', 'footnote marker');
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  const row = library.locator('.annotation').filter({ hasText: 'footnote marker' });
  await expect(row).toHaveCount(1);
  const id = (await row.getAttribute('data-annotation-id'))!;
  const other = await context.newPage();
  await other.goto(`chrome-extension://${extensionId}/library.html`);
  await update(other, id, 'Initial note A');
  await expect(row.locator('.note')).toHaveText('Initial note A');
  return { library, other, row, id };
}

async function update(page: Page, id: string, comment: string) {
  const result = await page.evaluate(({ id, comment }) => chrome.runtime.sendMessage({
    type: 'annotation:set-comment', id, comment,
  }), { id, comment });
  expect(result?.ok).toBe(true);
}

test('E89: Library editor opens the current live note and saves with its snapshot', async ({ context, extensionId }) => {
  const { other, row, id } = await setup(context, extensionId);
  await update(other, id, 'External note B before opening');
  await expect(row.locator('.note')).toHaveText('External note B before opening');
  await row.locator('[data-action="edit"]').click();
  await expect(row.locator('textarea')).toHaveValue('External note B before opening');
  await row.locator('textarea').fill('Fresh revision C');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.locator('textarea')).toHaveCount(0);
  await expect(row.locator('.note')).toHaveText('Fresh revision C');
});

test('E90: Library note conflict preserves the unsaved draft and the other tab’s edit', async ({ context, extensionId }) => {
  const { other, row, id } = await setup(context, extensionId);
  await row.locator('[data-action="edit"]').click();
  await row.locator('textarea').fill('My draft must survive');
  await update(other, id, 'External note B during editing');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.locator('textarea')).toHaveValue('My draft must survive');
  await expect(row.getByRole('alert')).toContainText('changed');
  await expect(other.locator('.annotation .note')).toHaveText('External note B during editing');
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await row.locator('[data-action="edit"]').click();
  await expect(row.locator('textarea')).toHaveValue('External note B during editing');
});

test('E91: Selected batch preview rejects a note changed before Apply without replacing it', async ({ context, extensionId }) => {
  const { library, other, row, id } = await setup(context, extensionId);
  await library.locator('.page-card header input[type="checkbox"]').check();
  await library.locator('[data-selection="comment"]').click();
  await library.locator('[data-selection="note-mode"]').selectOption('replace');
  await library.locator('[data-selection="note-text"]').fill('Old batch preview text');
  await update(other, id, 'External note B after preview');
  await expect(row.locator('.note')).toHaveText('External note B after preview');
  await library.locator('[data-selection="apply"]').click();
  await expect(library.locator('.bulk-edit-panel [role="alert"]')).toContainText('changed');
  await expect(library.locator('[data-selection="note-text"]')).toHaveValue('Old batch preview text');
  await expect(row.locator('.note')).toHaveText('External note B after preview');
  await other.reload();
  await expect(other.locator('.annotation .note')).toHaveText('External note B after preview');
});

test('E96: Library drafts survive grouping changes and a live update that removes the search match', async ({ context, extensionId }) => {
  const { library, other, row, id } = await setup(context, extensionId);
  await row.locator('[data-action="edit"]').click();
  await row.locator('textarea').fill('Draft across views');
  for (const mode of ['site', 'timeline', 'page']) {
    await library.locator(`[data-mode="${mode}"]`).click();
    await expect(row.locator('textarea')).toHaveValue('Draft across views');
  }
  await library.locator('[data-library="search"]').fill('Initial note A');
  await expect(row.locator('textarea')).toHaveValue('Draft across views');
  await update(other, id, 'Changed externally, no longer a search match');
  await expect(row).toHaveCount(0);
  await library.locator('[data-library="search"]').fill('');
  await expect(row.locator('textarea')).toHaveValue('Draft across views');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.getByRole('alert')).toContainText('changed');
  await expect(row.locator('textarea')).toHaveValue('Draft across views');
});

test('E97: Library save failure while a row is filtered out returns with the draft ready to retry', async ({ context, extensionId }) => {
  const { library, row } = await setup(context, extensionId);
  await row.locator('[data-action="edit"]').click();
  await row.locator('textarea').fill('Draft survives hidden save');
  await library.evaluate(() => {
    const runtime = chrome.runtime;
    const original = runtime.sendMessage.bind(runtime);
    let pending: (() => void) | undefined;
    const state = window as typeof window & { rejectNoteSave?: () => void };
    runtime.sendMessage = ((message: { type?: string }, ...args: unknown[]) => {
      if (message.type === 'annotations:edit' && !pending) {
        return new Promise((_resolve, reject) => {
          pending = () => { runtime.sendMessage = original; reject(new Error('Simulated interrupted save')); };
          state.rejectNoteSave = pending;
        });
      }
      return (original as (...values: unknown[]) => unknown)(message, ...args);
    }) as typeof runtime.sendMessage;
  });
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.locator('textarea')).toBeDisabled();
  await library.locator('[data-library="search"]').fill('no matching annotation');
  await expect(row).toHaveCount(0);
  await library.evaluate(() => (window as typeof window & { rejectNoteSave?: () => void }).rejectNoteSave?.());
  await library.locator('[data-library="search"]').fill('');
  await expect(row.locator('textarea')).toHaveValue('Draft survives hidden save');
  await expect(row.getByRole('alert')).toContainText('interrupted');
  await expect(row.locator('textarea')).toBeEnabled();
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.locator('textarea')).toHaveCount(0);
  await expect(row.locator('.note')).toHaveText('Draft survives hidden save');
});

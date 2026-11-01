import type { BrowserContext, Locator, Page } from '@playwright/test';
import { BASE_URL, expect, highlight, test } from './extension';

const NESTED = `${BASE_URL}/fixtures/nested.html`;
const DEMO = `${BASE_URL}/fixtures/demo.html`;

async function seed(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker');
  await highlight(page, '#probe-1', 'Deeply nested inline structure');
  await page.goto(DEMO);
  await highlight(page, '#probe-2', 'scoping', 'pink');
  await page.close();
}

async function openLibrary(context: BrowserContext, extensionId: string): Promise<Page> {
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  await library.locator('.library-header').waitFor();
  return library;
}

function annotation(library: Page, quote: string) {
  return library.locator('.annotation').filter({ has: library.locator('.quote', { hasText: quote }) });
}

async function enterSelection(library: Page): Promise<void> {
  await library.locator('[data-bulk-action="menu"]').click();
  await library.getByRole('menuitem', { name: 'Edit selected annotations', exact: false }).click();
  await expect(library.locator('.bulk-edit-panel')).toBeVisible();
}

async function clickBlank(target: Locator, card = false): Promise<void> {
  await target.evaluate((element) => element.scrollIntoView({ block: 'end' }));
  const box = (await target.boundingBox())!;
  const position = { x: card ? 20 : 3, y: box.height - 3 };
  expect(await target.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element,
    { x: box.x + position.x, y: box.y + position.y })).toBe(true);
  await target.click({ position });
}

async function expectPageSelectionInsideRight(library: Page): Promise<void> {
  for (const card of await library.locator('.page-card').all()) {
    await card.locator('[data-page-select]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const layout = await card.evaluate((element) => {
      const checkbox = element.querySelector<HTMLInputElement>('[data-page-select]')!;
      const label = checkbox.closest<HTMLElement>('.page-select')!;
      const title = element.querySelector('h2')!;
      const box = checkbox.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      const target = label.getBoundingClientRect();
      const cardBox = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        inside: target.left >= cardBox.left && target.right <= cardBox.right &&
          target.top >= cardBox.top && target.bottom <= cardBox.bottom &&
          box.left >= cardBox.left && box.right <= cardBox.right && box.top >= cardBox.top && box.bottom <= cardBox.bottom,
        rightSide: target.left > cardBox.left + cardBox.width / 2,
        titleSeparate: titleBox.right <= target.left || titleBox.bottom <= target.top || titleBox.top >= target.bottom,
        cardLeft: cardBox.left, cardRight: cardBox.right,
        hitControl: hit !== null && label.contains(hit), viewportWidth: innerWidth,
      };
    });
    expect(layout.inside).toBe(true);
    expect(layout.rightSide).toBe(true);
    expect(layout.titleSeparate).toBe(true);
    expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
    expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.hitControl).toBe(true);
  }
  expect(await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('E53: selected colour, note, delete and restore actions preserve unselected annotations', async ({
  context, serviceWorker, extensionId,
}) => {
  await seed(context);
  const library = await openLibrary(context, extensionId);
  const first = annotation(library, 'footnote marker');
  const second = annotation(library, 'scoping');
  const untouched = annotation(library, 'Deeply nested inline structure');
  await first.locator('[data-action="edit"]').click();
  await first.locator('textarea').fill('Original note');
  await first.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(first.locator('.note')).toHaveText('Original note');
  await library.locator('.page-card').filter({ has: first }).locator('[data-page-select]').check();
  await untouched.locator('.annotation-select').uncheck();
  await library.locator('.page-card').filter({ has: second }).locator('[data-page-select]').check();
  await expect(library.locator('[data-selection="count"]')).toHaveText('2 selected · 2 pages');

  await library.locator('[data-selection="color"]').click();
  await library.locator('[data-selection="target-color"]').selectOption('teal');
  await library.locator('[data-selection="apply"]').click();
  await expect(first).toHaveAttribute('data-color', 'teal');
  await expect(second).toHaveAttribute('data-color', 'teal');
  await expect(untouched).toHaveAttribute('data-color', 'yellow');

  await first.locator('.annotation-select').check();
  await second.locator('.annotation-select').check();
  await library.locator('[data-selection="comment"]').click();
  await expect(library.locator('[data-selection="note-mode"]')).toHaveValue('append');
  await library.locator('[data-selection="note-text"]').fill('Batch addition');
  await library.locator('[data-selection="apply"]').click();
  await expect(first.locator('.note')).toContainText('Original note');
  await expect(first.locator('.note')).toContainText('Batch addition');
  await expect(second.locator('.note')).toHaveText('Batch addition');
  await expect(untouched.locator('.note')).toHaveCount(0);

  await first.locator('.annotation-select').check();
  await second.locator('.annotation-select').check();
  await library.locator('[data-selection="comment"]').click();
  await library.locator('[data-selection="note-mode"]').selectOption('replace');
  await library.locator('[data-selection="note-text"]').fill('Replacement note');
  await expect(library.locator('[data-selection="preview"]')).toContainText('Replace the existing note');
  await library.locator('[data-selection="apply"]').click();
  await expect(first.locator('.note')).toHaveText('Replacement note');
  await expect(second.locator('.note')).toHaveText('Replacement note');

  await first.locator('.annotation-select').check();
  await second.locator('.annotation-select').check();
  await library.locator('[data-selection="delete"]').click();
  // Opening the confirmation must not delete anything.
  await expect(library.locator('.annotation')).toHaveCount(3);
  await library.locator('[data-selection="apply"]').click();
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(untouched).toBeVisible();
  await library.locator('[data-filter="deleted"]').click();
  await expect(library.locator('.annotation')).toHaveCount(2);
  await library.locator('[data-selection="all"]').click();
  await library.locator('[data-selection="restore"]').click();
  await library.locator('[data-selection="apply"]').click();
  await expect(library.locator('.annotation')).toHaveCount(0);
  await library.locator('[data-filter="deleted"]').click();
  await expect(library.locator('.annotation')).toHaveCount(3);
  await library.reload();
  await expect(library.locator('.annotation[data-color="teal"]')).toHaveCount(2);
  await expect(first.locator('.note')).toHaveText('Replacement note');
  await expect(second.locator('.note')).toHaveText('Replacement note');
  await expect(untouched.locator('.note')).toHaveCount(0);
});

test('E54: filtered and page selection includes collapsed rows and survives grouping changes', async ({
  context, serviceWorker, extensionId,
}) => {
  await seed(context);
  const page = await context.newPage();
  await page.goto(NESTED);
  for (const [selector, quote] of [
    ['#probe-2', 'paragraph contains'], ['#probe-2', 'emphasized'],
    ['#probe-2', 'strongly'], ['#probe-3', 'triple-wrapped'],
  ]) {
    await highlight(page, selector!, quote!);
  }
  await page.close();
  const library = await openLibrary(context, extensionId);
  const nested = library.locator('.page-card').filter({ has: library.locator('.page-title', { hasText: 'Fixture: nested' }) });
  await expect(nested.locator('.annotation')).toHaveCount(5);
  await enterSelection(library);
  await library.locator('[data-selection="all"]').click();
  await expect(library.locator('[data-selection="count"]')).toHaveText('7 selected · 2 pages');

  await library.locator('[data-library="search"]').fill('footnote marker');
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  await library.locator('[data-library="search"]').fill('');
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  const groupCheckbox = nested.locator('header input[type="checkbox"]');
  await expect(groupCheckbox).toHaveJSProperty('indeterminate', true);
  await groupCheckbox.check();
  await expect(library.locator('[data-selection="count"]')).toHaveText('6 selected · 1 page');
  await groupCheckbox.uncheck();
  await expect(library.locator('[data-selection="count"]')).toHaveText('0 selected · 0 pages');
  await annotation(library, 'footnote marker').locator('.annotation-select').check();

  for (const mode of ['site', 'timeline', 'page']) {
    await library.locator(`button[data-mode="${mode}"]`).click();
    await expect(annotation(library, 'footnote marker').locator('.annotation-select')).toBeChecked();
    await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  }
  await library.locator('[data-selection="exit"]').click();
  await expect(library.locator('.annotation-select')).toHaveCount(0);
});

test('E55: pending selected edits lock controls and reject a concurrent note change atomically', async ({
  context, serviceWorker, extensionId,
}) => {
  await seed(context);
  const library = await openLibrary(context, extensionId);
  const other = await openLibrary(context, extensionId);
  const first = annotation(library, 'footnote marker');
  const second = annotation(library, 'scoping');
  const id = await first.getAttribute('data-annotation-id');
  expect(id).toBeTruthy();
  await enterSelection(library);
  await first.locator('.annotation-select').check();
  await second.locator('.annotation-select').check();
  await library.locator('[data-selection="comment"]').click();
  await library.locator('[data-selection="note-mode"]').selectOption('replace');
  await library.locator('[data-selection="note-text"]').fill('Stale bulk note');

  // Delay transport only: the real background transaction receives the exact
  // selected snapshot after another Library tab has changed one of its notes.
  await library.evaluate(() => {
    const runtime = chrome.runtime;
    const original = runtime.sendMessage.bind(runtime);
    Object.defineProperty(runtime, 'sendMessage', {
      configurable: true,
      value: (message: unknown) => {
        if ((message as { type?: string })?.type !== 'annotations:edit') return original(message);
        return new Promise((resolve, reject) => {
          (window as unknown as { releaseEdit: () => void }).releaseEdit = () => {
            Object.defineProperty(runtime, 'sendMessage', { configurable: true, value: original });
            void original(message).then(resolve, reject);
          };
        });
      },
    });
  });
  await library.locator('[data-selection="apply"]').click();
  await expect(library.locator('.bulk-edit-panel')).toHaveAttribute('aria-busy', 'true');
  for (const selector of ['all', 'clear', 'exit', 'apply']) {
    await expect(library.locator(`[data-selection="${selector}"]`)).toBeDisabled();
  }
  await expect(first.locator('.annotation-select')).toBeDisabled();
  await expect(first.locator('[data-action="delete"]')).toBeDisabled();
  await expect(first.locator('[data-action="edit"]')).toBeDisabled();
  // Inert content deliberately fails locator actionability; raw pointer clicks
  // verify that attempts on those blank areas cannot change the selection.
  for (const [target, x] of [[first, 3], [library.locator('.page-card').filter({ has: first }), 20]] as const) {
    await target.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    const box = (await target.boundingBox())!;
    await library.mouse.click(box.x + x, box.y + box.height - 3);
  }
  await expect(library.locator('[data-selection="count"]')).toHaveText('2 selected · 2 pages');
  await other.evaluate((annotationId) => chrome.runtime.sendMessage({
    type: 'annotation:set-comment', id: annotationId, comment: 'Changed in another tab',
  }), id);
  await expect(first.locator('.note')).toHaveText('Changed in another tab');
  await library.evaluate(() => (window as unknown as { releaseEdit: () => void }).releaseEdit());
  await expect(library.locator('.bulk-edit-error')).toBeVisible();
  await expect(library.locator('.bulk-edit-panel')).toHaveAttribute('aria-busy', 'false');
  await expect(first.locator('.note')).toHaveText('Changed in another tab');
  await expect(second.locator('.note')).toHaveCount(0);
});

test('E77: visible page checkboxes select collapsed annotations and support partial keyboard selection', async ({
  context, serviceWorker, extensionId,
}) => {
  await seed(context);
  const article = await context.newPage();
  await article.goto(NESTED);
  for (const [selector, quote] of [
    ['#probe-2', 'paragraph contains'], ['#probe-2', 'emphasized'],
    ['#probe-2', 'strongly'], ['#probe-3', 'triple-wrapped'],
  ]) await highlight(article, selector!, quote!);
  await article.close();
  const library = await openLibrary(context, extensionId);
  const nested = library.locator('.page-card').filter({ has: library.locator(`.page-title[title="${NESTED}"]`) });
  const demo = library.locator('.page-card').filter({ has: library.locator(`.page-title[title="${DEMO}"]`) });
  await expect(library.locator('[data-page-select]')).toHaveCount(2);
  await expect(library.locator('.bulk-edit-panel')).toHaveCount(0);
  await expect(nested.locator('.annotation')).toHaveCount(5);
  await expectPageSelectionInsideRight(library);
  const styleBefore = await nested.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.borderColor, style.boxShadow].join('|');
  });
  const pageSelect = nested.locator('[data-page-select]');
  await expect(pageSelect).toHaveAccessibleName('Select annotations from Fixture: nested text nodes');
  await pageSelect.check();
  await expect(library.locator('[data-selection="count"]')).toHaveText('6 selected · 1 page');
  await expect(nested).toHaveAttribute('data-selected', 'full');
  expect(await nested.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.borderColor, style.boxShadow].join('|');
  })).not.toBe(styleBefore);
  await demo.locator('[data-page-select]').focus();
  await library.keyboard.press('Space');
  await expect(library.locator('[data-selection="count"]')).toHaveText('7 selected · 2 pages');
  await expect(demo).toHaveAttribute('data-selected', 'full');
  await nested.locator('.annotation-select').first().uncheck();
  await expect(nested).toHaveAttribute('data-selected', 'partial');
  await expect(pageSelect).toHaveJSProperty('indeterminate', true);
  await expect(pageSelect).toHaveAttribute('aria-checked', 'mixed');
  await pageSelect.focus();
  await library.keyboard.press('Space');
  await expect(library.locator('[data-selection="count"]')).toHaveText('7 selected · 2 pages');
  await expect(pageSelect).toBeChecked();
  await library.keyboard.press('Space');
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  await expect(pageSelect).not.toBeChecked();
  await expect(pageSelect).toBeFocused();
  await expect(demo.locator('[data-page-select]')).toBeChecked();
});

test('E78: the selection entry respects filters and keeps batch controls usable on small screens', async ({
  context, serviceWorker, extensionId,
}) => {
  await seed(context);
  const library = await openLibrary(context, extensionId);
  await library.setViewportSize({ width: 1280, height: 800 });
  await library.locator('[data-selection="start"]').click();
  await expect(library.locator('[data-selection="count"]')).toHaveText('0 selected · 0 pages');
  await library.locator('[data-selection="all"]').click();
  await expect(library.locator('[data-selection="count"]')).toHaveText('3 selected · 2 pages');
  const search = library.locator('[data-library="search"]');
  await search.fill('footnote marker');
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  await search.fill('');
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  await library.locator('[data-selection="clear"]').click();
  await search.fill('scoping');
  await library.locator('[data-selection="all"]').click();
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  await search.fill('');
  await expect(library.locator('.page-card[data-selected="full"]')).toHaveCount(1);
  await expect(annotation(library, 'scoping').locator('.annotation-select')).toBeChecked();
  await expect(annotation(library, 'footnote marker').locator('.annotation-select')).not.toBeChecked();

  await library.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(library.locator('[data-selection="color"]')).toBeInViewport();
  await library.setViewportSize({ width: 390, height: 650 });
  await expectPageSelectionInsideRight(library);
  await library.locator('[data-selection="comment"]').click();
  await library.locator('[data-selection="note-text"]').fill('Only the filtered page receives this note.');
  const apply = library.locator('[data-selection="apply"]');
  await apply.scrollIntoViewIfNeeded();
  await expect(apply).toBeInViewport();
  await apply.click();
  await expect(annotation(library, 'scoping').locator('.note')).toHaveText('Only the filtered page receives this note.');
  await expect(annotation(library, 'footnote marker').locator('.note')).toHaveCount(0);
  await expect(annotation(library, 'Deeply nested inline structure').locator('.note')).toHaveCount(0);
  await library.locator('[data-selection="exit"]').click();
  await expect(library.locator('.bulk-edit-panel')).toHaveCount(0);
  await expect(library.locator('[data-page-select]')).toHaveCount(2);
});

test('E79: blank card clicks select the page while blank annotation clicks toggle only that row', async ({
  context, serviceWorker, extensionId,
}) => {
  await seed(context);
  const library = await openLibrary(context, extensionId);
  const first = annotation(library, 'footnote marker');
  const sibling = annotation(library, 'Deeply nested inline structure');
  const nested = library.locator('.page-card').filter({ has: first });
  await expect(library.locator('.bulk-edit-panel')).toHaveCount(0);
  await clickBlank(nested, true);
  await expect(library.locator('[data-selection="count"]')).toHaveText('2 selected · 1 page');
  await expect(nested).toHaveAttribute('data-selected', 'full');
  await clickBlank(nested, true);
  await expect(library.locator('[data-selection="count"]')).toHaveText('0 selected · 0 pages');
  await library.locator('[data-selection="exit"]').click();

  await clickBlank(first);
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  await expect(first.locator('.annotation-select')).toBeChecked();
  await expect(sibling.locator('.annotation-select')).not.toBeChecked();
  await expect(nested).toHaveAttribute('data-selected', 'partial');
  await clickBlank(first);
  await expect(library.locator('[data-selection="count"]')).toHaveText('0 selected · 0 pages');
  await clickBlank(nested, true);
  await clickBlank(first);
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  await expect(sibling.locator('.annotation-select')).toBeChecked();
  await expect(first.locator('.annotation-select')).not.toBeChecked();
  await expect(annotation(library, 'scoping').locator('.annotation-select')).not.toBeChecked();
});

test('E80: navigation, note editing and text dragging do not trigger blank-area selection', async ({
  context, serviceWorker, extensionId,
}) => {
  await seed(context);
  const library = await openLibrary(context, extensionId);
  const first = annotation(library, 'footnote marker');
  const linkUrl = `${DEMO}?note-link=selection-guard`;
  await first.locator('[data-action="edit"]').click();
  await first.locator('textarea').fill(`[Read fixture](${linkUrl})\n\nDrag this saved note text without selecting annotations.`);
  await first.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(first.locator('.note')).toContainText('Drag this saved note');
  await expect(library.locator('.bulk-edit-panel')).toHaveCount(0);

  const [revealed] = await Promise.all([
    context.waitForEvent('page'), first.locator('.quote').click(),
  ]);
  await revealed.waitForURL(NESTED);
  await library.bringToFront();
  await expect(library.locator('.bulk-edit-panel')).toHaveCount(0);
  const [linked] = await Promise.all([
    context.waitForEvent('page'), first.locator('.note a').click(),
  ]);
  await linked.waitForURL(linkUrl);
  await library.bringToFront();
  await expect(library.locator('.bulk-edit-panel')).toHaveCount(0);

  const text = first.locator('.note p').last();
  const line = await text.evaluate((element) => {
    // Navigation can refresh the live-query rows. Scroll and measure the
    // currently attached text in one DOM operation, without a stale handle.
    element.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = range.getClientRects()[0]!;
    return { left: box.left, right: box.right, y: box.top + box.height / 2 };
  });
  await library.mouse.move(line.left + 1, line.y);
  await library.mouse.down();
  await library.mouse.move(Math.min(line.right - 1, line.left + 120), line.y, { steps: 12 });
  await library.mouse.up();
  expect(await library.evaluate(() => window.getSelection()?.toString().trim().length ?? 0)).toBeGreaterThan(0);
  await expect(library.locator('.bulk-edit-panel')).toHaveCount(0);
  await library.evaluate(() => window.getSelection()?.removeAllRanges());

  await clickBlank(first);
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
  await first.locator('[data-action="edit"]').click();
  await first.locator('textarea').fill('Editing a selected note keeps the selection.');
  await first.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(first.locator('.note')).toHaveText('Editing a selected note keeps the selection.');
  await expect(library.locator('[data-selection="count"]')).toHaveText('1 selected · 1 page');
});

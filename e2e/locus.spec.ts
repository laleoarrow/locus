import type { Page, Worker } from '@playwright/test';
import { BASE_URL, expect, highlight, readAnnotationRow, selectText, test } from './extension';

const NESTED = `${BASE_URL}/fixtures/nested.html`;
const REPEATED = `${BASE_URL}/fixtures/repeated.html`;
const DYNAMIC = `${BASE_URL}/fixtures/dynamic.html`;
const SVG = `${BASE_URL}/fixtures/svg.html`;
const MATHJAX = `${BASE_URL}/fixtures/mathjax.html`;
const IFRAME = `${BASE_URL}/fixtures/iframe.html`;

async function openPanelFor(page: Page, worker: Worker, extensionId: string, url: string): Promise<Page> {
  const tabId = await worker.evaluate(async (tabUrl) => {
    const tabs = await chrome.tabs.query({});
    const key = (value: string) => value.split('#')[0];
    return tabs.find((tab) => tab.url && key(tab.url) === key(tabUrl))?.id ?? null;
  }, url);
  const panel = await page.context().newPage();
  await panel.goto(
    `chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(url)}&tabId=${tabId ?? ''}`,
  );
  return panel;
}

test('E1: content script auto-injects on a granted origin', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await expect(page.locator('html')).toHaveAttribute('data-locus-ready', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '0');
});

test('E2+E3: selection toolbar creates a highlight that survives reload', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await selectText(page, '#probe-2', 'footnote marker');
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await page.locator('[data-locus-toolbar] .swatch[data-color="green"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '0');
});

test('E4: second highlight defaults to the last-used color', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker', 'pink');
  await selectText(page, '#probe-3', 'second paragraph');
  const lastSwatch = page.locator('[data-locus-toolbar] .swatch[data-last="true"]');
  await expect(lastSwatch).toHaveAttribute('data-color', 'pink');
});

test('E5: a plain-text comment persists and shows in the side panel', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await selectText(page, '#probe-3', 'triple-wrapped');
  await page.locator('[data-locus-comment-btn]').click();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.locator('[data-locus-comment-box] textarea').fill('key claim, re-check derivation');
  await page.locator('[data-locus-comment-save]').click();
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
  await expect(panel.locator('.annotation-comment')).toHaveText('key claim, re-check derivation');
});

test('E6: repeated text re-anchors onto the same occurrence', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(REPEATED);
  await highlight(page, '#occurrence-2 p', 'The mitochondria is the powerhouse of the cell.');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  // The highlight range must sit inside #occurrence-2, not 1 or 3.
  const section = await page.evaluate(() => {
    const highlightNames = ['locus-yellow', 'locus-green', 'locus-blue', 'locus-pink', 'locus-orange'];
    for (const name of highlightNames) {
      const registered = CSS.highlights.get(name);
      if (!registered) continue;
      for (const range of registered as unknown as Iterable<Range>) {
        const el = range.startContainer.parentElement;
        return el?.closest('section')?.id ?? null;
      }
    }
    return null;
  });
  expect(section).toBe('occurrence-2');
});

test('E7: dynamic re-write after load re-anchors via the mutation watcher', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(DYNAMIC);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-hydrated', '1');
  await highlight(page, '#target-holder-v2', 'stable wording');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.reload();
  // Hydration replaces the paragraph ~500 ms after load; the watcher re-anchors.
  await expect(page.locator('html')).toHaveAttribute('data-fixture-hydrated', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '0');
});

test('E8: removed text detaches but stays listed in the panel', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(DYNAMIC);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-hydrated', '1');
  await highlight(page, '#target-holder-v2', 'stable wording');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.goto(`${DYNAMIC}#remove-target`);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-fixture-hydrated', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '1');
  const panel = await openPanelFor(page, serviceWorker, extensionId, DYNAMIC);
  const item = panel.locator('.annotation-item');
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute('data-anchor-state', 'detached');
  await expect(item.locator('.detached-badge')).toBeVisible();
});

test('E9: clicking a panel item scrolls to and pulses the annotation', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 300 });
  await page.goto(REPEATED);
  await highlight(page, '#occurrence-1 p', 'powerhouse');
  const panel = await openPanelFor(page, serviceWorker, extensionId, REPEATED);
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
  // Scroll away so reveal has to move the viewport back.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await panel.locator('.annotation-item').click();
  await expect(page.locator('#locus-host .pulse').first()).toBeVisible({ timeout: 5000 });
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), { timeout: 5000 })
    .toBeLessThan(before);
});

test('E10: delete uses a tombstone with temporary undo', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-4', 'Quotation blocks');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  const item = panel.locator('.annotation-item');
  await expect(item).toHaveCount(1);
  const annotationId = (await item.getAttribute('data-annotation-id')) as string;

  await item.locator('button[data-action="delete"]').click();
  await expect(panel.locator('[data-locus-undo]')).toBeVisible();
  await expect(panel.locator('.annotation-item')).toHaveCount(0);
  // Page un-renders it too.
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '0');

  // Undo restores.
  await panel.locator('[data-locus-undo] button').click();
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  // Delete again and let it stand: the row must remain as a tombstone.
  await panel.locator('.annotation-item button[data-action="delete"]').click();
  await expect(panel.locator('.annotation-item')).toHaveCount(0);
  const row = await readAnnotationRow(panel, annotationId);
  expect(row).toBeDefined();
  expect(row?.deletedAt).toBeGreaterThan(0);
});

test('E11: creating highlights causes no layout shift', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  for (const [url, selector, text] of [
    [NESTED, '#probe-2', 'footnote marker'],
    [SVG, '#probe-2', 'experimental setup'],
    [MATHJAX, '#probe-3', 'derivation once more'],
  ] as const) {
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('data-locus-ready', '1');
    const probes = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[id^="probe-"]')].map((el) => {
          const rect = el.getBoundingClientRect();
          return { id: el.id, top: rect.top, left: rect.left, height: rect.height };
        }),
      );
    const before = await probes();
    await highlight(page, selector, text);
    await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
    expect(await probes(), `layout must not move on ${url}`).toEqual(before);
  }
});

test('E12: svg and mathjax pages anchor across reload; iframe selection is ignored', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();

  await page.goto(SVG);
  await highlight(page, '#probe-4', 'anchoring around foreign content');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  await page.goto(MATHJAX);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-typeset', '1');
  await highlight(page, '#probe-2', 'prose continues after the');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-fixture-typeset', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  await page.goto(IFRAME);
  await expect(page.locator('html')).toHaveAttribute('data-locus-ready', '1');
  const frame = page.frameLocator('iframe');
  await frame.locator('p').evaluate((el) => {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const selection = el.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.ownerDocument.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
  // Top-document annotation still works on the same page.
  await highlight(page, '#probe-3', 'after the frame');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
});

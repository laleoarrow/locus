import type { Page } from '@playwright/test';
import { BASE_URL, expect, selectText, test } from './extension';

const DICTIONARY = `${BASE_URL}/fixtures/dictionary.html`;

async function geometry(page: Page, glyphSelector?: string) {
  return page.evaluate((glyphSelector) => {
    const range = getSelection()!.getRangeAt(0).cloneRange();
    if (glyphSelector) range.selectNodeContents(document.querySelector(glyphSelector)!.firstChild!);
    const selection = range.getBoundingClientRect();
    const toolbar = document.getElementById('locus-host')!.shadowRoot!
      .querySelector('[data-locus-toolbar]')!.getBoundingClientRect();
    const bubble = document.getElementById('search-bubble')!.getBoundingClientRect();
    const overlap = (box: DOMRect) => Math.min(toolbar.right, box.right) > Math.max(toolbar.left, box.left) + 0.5 &&
      Math.min(toolbar.bottom, box.bottom) > Math.max(toolbar.top, box.top) + 0.5;
    return {
      gap: Math.hypot(Math.max(selection.left - toolbar.right, toolbar.left - selection.right, 0),
        Math.max(selection.top - toolbar.bottom, toolbar.top - selection.bottom, 0)),
      inside: toolbar.left >= 7.5 && toolbar.top >= 7.5 && toolbar.right <= innerWidth - 7.5 && toolbar.bottom <= innerHeight - 7.5,
      overlapsSelection: overlap(selection),
      overlapsBubble: bubble.width > 0 && overlap(bubble),
    };
  }, glyphSelector);
}

async function expectClose(page: Page, glyphSelector?: string) {
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await expect.poll(() => geometry(page, glyphSelector)).toMatchObject({ inside: true, overlapsSelection: false, overlapsBubble: false });
  await expect.poll(async () => (await geometry(page, glyphSelector)).gap).toBeLessThanOrEqual(32);
}

test('E100: selecting a single punctuation mark in a tall dictionary card stays near the text', async ({
  context, serviceWorker, extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'prefs:set-placement', placement: 'auto' }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto(DICTIONARY);
  await selectText(page, '#phrase', '，');
  await expect(page.locator('#search-bubble')).toBeVisible();
  // A later avoidance pass used to relocate the toolbar to the card's edge.
  await page.waitForTimeout(450);
  await expectClose(page);
  await page.locator('[data-locus-toolbar] .swatch[data-color="teal"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
});

test('E101: root page scaling and translation preserve toolbar proximity through scrolling and resize', async ({
  context, serviceWorker, extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'prefs:set-placement', placement: 'auto' }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(`${DICTIONARY}?no-bubble&nested`);
  for (const rootStyle of ['transform:translateY(240px)', 'zoom:1.5', 'zoom:.75', 'transform:scale(1.25);transform-origin:top left']) {
    await test.step(rootStyle, async () => {
      await page.evaluate((style) => {
        document.documentElement.style.cssText = style;
        document.getElementById('scroll-panel')!.scrollTop = 0;
        scrollTo(0, 0);
      }, rootStyle);
      await selectText(page, '#phrase', '，');
      await expectClose(page);
      await page.locator('#scroll-panel').evaluate((element) => { element.scrollTop = 64; });
      await expectClose(page);
      await page.evaluate(() => scrollTo(0, 60));
      await expectClose(page);
      await page.setViewportSize({ width: 1280, height: 1000 });
      await expectClose(page);
      await page.setViewportSize({ width: 1440, height: 1200 });
    });
  }
});

test('E102: a selected tall inline element anchors the toolbar to its text while preserving the highlight', async ({
  context, serviceWorker, extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'prefs:set-placement', placement: 'auto' }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto(`${DICTIONARY}?no-bubble&tall-comma`);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNode(document.getElementById('tall-comma')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expectClose(page, '#tall-comma');
  await page.evaluate(() => {
    scrollTo(0, 80);
    document.getElementById('tall-comma')!.style.height = '340px';
    document.getElementById('tall-comma')!.style.fontSize = '24px';
  });
  await expectClose(page, '#tall-comma');
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('，');
  await page.locator('[data-locus-toolbar] .swatch[data-color="teal"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '0');
});

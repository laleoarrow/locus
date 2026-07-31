/**
 * Screenshot the library page in all three grouping modes, for visual review
 * and for the store listing.
 *
 *   node e2e/serve.mjs &
 *   pnpm build:e2e && node scripts/library-shots.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, '.output/chrome-mv3-e2e');
const OUT = process.env.OUT_DIR ?? '/tmp';
const BASE = 'http://localhost:8137';

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1280, height: 800 },
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
for (let i = 0; i < 60; i++) {
  if ((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length) break;
  await new Promise((r) => setTimeout(r, 100));
}
const extensionId = new URL(worker.url()).host;

const page = await context.newPage();

async function annotate(url, selector, text, color) {
  await page.goto(url);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await page.evaluate(
    ({ selector, text }) => {
      const scope = document.querySelector(selector);
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.data.indexOf(text);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      throw new Error('not found: ' + text);
    },
    { selector, text },
  );
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.locator(`[data-locus-toolbar] .swatch[data-color="${color}"]`).click();
  await page.waitForTimeout(350);
}

await annotate(`${BASE}/fixtures/demo.html`, '#probe-3', 'shift in case mix is not represented', 'yellow');
await annotate(`${BASE}/fixtures/demo.html`, '#probe-4', 'an optional courtesy to the reader', 'teal');
await annotate(`${BASE}/fixtures/nested.html`, '#probe-2', 'footnote marker', 'pink');
await annotate(`${BASE}/fixtures/repeated.html`, '#occurrence-2 p', 'powerhouse', 'yellow');

// Give one of them a note.
await page.goto(`${BASE}/fixtures/demo.html`);
await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
const point = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.data.indexOf('shift in case mix');
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 10);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return null;
});
await page.mouse.click(point.x, point.y);
await page.locator('[data-locus-note] textarea').fill(
  '**Central claim** — external validation is the *only* evidence of transfer.\n\n- check calibration too',
);
await page.locator('[data-locus-note-save]').click();
await page.waitForTimeout(400);

const library = await context.newPage();
await library.setViewportSize({ width: 1280, height: 800 });
await library.goto(`chrome-extension://${extensionId}/library.html`);
await library.locator('.page-card').first().waitFor();
await library.waitForTimeout(500);
await library.screenshot({ path: `${OUT}/library-1-pages.png` });

await library.locator('.segmented button[data-mode="site"]').click();
await library.waitForTimeout(300);
await library.screenshot({ path: `${OUT}/library-2-sites.png` });

await library.locator('.segmented button[data-mode="timeline"]').click();
await library.waitForTimeout(300);
await library.screenshot({ path: `${OUT}/library-3-timeline.png` });

await library.locator('.segmented button[data-mode="page"]').click();
await library.locator('[data-library="search"]').fill('validation');
await library.waitForTimeout(300);
await library.screenshot({ path: `${OUT}/library-4-search.png` });

await context.close();
console.log('library screenshots written to', OUT);

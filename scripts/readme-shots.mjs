/**
 * Screenshots for the README hero and gallery.
 *
 * The earlier shots were taken against the e2e fixtures, so the library showed
 * "Fixture: nested text nodes" on localhost — test scaffolding, not something a
 * reader recognises. This script serves the pages in fixtures/showcase/ at
 * realistic academic URLs by intercepting the request in Playwright, so the UI
 * is exactly the real thing while the page underneath is a local stand-in.
 * Nothing is fetched from the network.
 *
 *   pnpm build && node scripts/readme-shots.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, '.output/chrome-mv3');
const OUT = process.env.OUT_DIR ?? path.join(ROOT, 'assets');

/** Realistic URL → local stand-in page. */
const PAGES = {
  'https://pubs.asahq.org/anesthesiology/article/131/6/1346/ai-review': 'journal.html',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC7643051/': 'pmc.html',
  'https://arxiv.org/abs/2607.01234': 'preprint.html',
};

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});

await context.route('**/*', async (route) => {
  const url = route.request().url().split('#')[0];
  const file = PAGES[url];
  if (!file) return route.continue();
  route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: await readFile(path.join(ROOT, 'fixtures/showcase', file), 'utf8'),
  });
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
for (let i = 0; i < 80; i++) {
  const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  if (scripts.length > 0) break;
  await new Promise((r) => setTimeout(r, 100));
}
const extensionId = new URL(worker.url()).host;

const page = await context.newPage();

async function ready(url) {
  await page.goto(url);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached', timeout: 15_000 });
}

async function select(text) {
  await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(needle);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`not found: ${needle}`);
  }, text);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.locator('[data-locus-toolbar]').waitFor();
  await page.waitForTimeout(250);
}

async function centreOf(text) {
  return page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(needle);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return null;
  }, text);
}

const shot = (name, target = page) =>
  target.screenshot({ path: path.join(OUT, `${name}.png`) });

/**
 * Screenshot only as much height as the content actually uses. A fixed-height
 * capture of the library leaves half the image empty, which reads as a bug
 * rather than a roomy layout.
 */
async function fittedShot(name, target) {
  const height = await target.evaluate(() => {
    const body = document.querySelector('.library-body');
    const bottom = body ? body.getBoundingClientRect().bottom : document.body.scrollHeight;
    return Math.ceil(Math.min(Math.max(bottom + 24, 360), window.innerHeight));
  });
  const width = target.viewportSize()?.width ?? 1280;
  await target.screenshot({
    path: path.join(OUT, `${name}.png`),
    clip: { x: 0, y: 0, width, height },
  });
}

// ── 1. Selection toolbar ────────────────────────────────────────────────
const JOURNAL = Object.keys(PAGES)[0];
await ready(JOURNAL);
await select('shift in case mix is not represented');
await shot('shot-toolbar');

// ── 2. Markdown note editor ─────────────────────────────────────────────
await page.locator('[data-locus-toolbar] .swatch[data-color="yellow"]').click();
await page.waitForTimeout(400);
await select('an optional courtesy to the reader');
await page.locator('[data-locus-toolbar] .swatch[data-color="teal"]').click();
await page.waitForTimeout(400);

const hit = await centreOf('shift in case mix is not represented');
await page.mouse.click(hit.x, hit.y);
await page.locator('[data-locus-note]').waitFor();
await page
  .locator('[data-locus-note] textarea')
  .fill('**Central claim** — external validation is the *only* evidence of transfer.\n\n- check calibration too\n- compare with `Figure 1`');
await page.locator('[data-locus-note] textarea').evaluate((el) => {
  el.scrollTop = 0;
  el.setSelectionRange(0, 0);
});
await page.waitForTimeout(300);
await shot('shot-note');
await page.locator('[data-locus-note-save]').click();
await page.waitForTimeout(400);

// ── 3. Image ring ───────────────────────────────────────────────────────
const PMC = Object.keys(PAGES)[1];
await ready(PMC);
await select('calibration of');
await page.locator('[data-locus-toolbar] .swatch[data-color="yellow"]').click();
await page.waitForTimeout(300);
await page.locator('#fig1').click();
await page.locator('[data-locus-toolbar]').waitFor();
await page.keyboard.press('3');
await page.waitForTimeout(500);
await shot('shot-ring');

// A third paper, so the library has range.
const PREPRINT = Object.keys(PAGES)[2];
await ready(PREPRINT);
await select('recalibration schedules, not retraining');
await page.locator('[data-locus-toolbar] .swatch[data-color="teal"]').click();
await page.waitForTimeout(300);
await select('calibration curve for each');
await page.locator('[data-locus-toolbar] .swatch[data-color="pink"]').click();
await page.waitForTimeout(400);

// ── 4–7. The library ────────────────────────────────────────────────────
const library = await context.newPage();
await library.setViewportSize({ width: 1280, height: 860 });
await library.goto(`chrome-extension://${extensionId}/library.html`);
await library.locator('.page-card, .timeline-entry').first().waitFor();
await library.waitForTimeout(600);

async function mode(name) {
  await library.locator(`.segmented button[data-mode="${name}"]`).click();
  await library.waitForTimeout(400);
}

await mode('page');
await fittedShot('shot-library', library);

await mode('site');
await fittedShot('gallery-library-sites', library);

await mode('timeline');
await fittedShot('gallery-library-timeline', library);

await mode('page');
await library.locator('[data-library="search"]').fill('calibration');
await library.waitForTimeout(400);
await fittedShot('gallery-library-search', library);
await library.locator('[data-filter="clear"]').click();

// ── 8. Side panel ───────────────────────────────────────────────────────
const panel = await context.newPage();
await panel.setViewportSize({ width: 420, height: 860 });
await panel.goto(
  `chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(JOURNAL)}`,
);
await panel.waitForTimeout(800);
await shot('gallery-sidepanel', panel);

await context.close();
console.log('README screenshots written to', OUT);

/**
 * Preview the Time Machine timeline with a history that actually spans time.
 *
 * Annotations are made through the real UI so every row is valid, then their
 * timestamps are spread backwards across days and months directly in the
 * extension's IndexedDB — the depth, era markers and rail only mean anything
 * against a history with shape.
 *
 *   pnpm build && node scripts/timeline-preview.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, '.output/chrome-mv3');
const OUT = process.env.OUT_DIR ?? '/tmp';

const PAGES = {
  'https://pubs.asahq.org/anesthesiology/article/131/6/1346/ai-review': 'journal.html',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC7643051/': 'pmc.html',
  'https://arxiv.org/abs/2607.01234': 'preprint.html',
};

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
await context.route('**/*', async (route) => {
  const file = PAGES[route.request().url().split('#')[0]];
  if (!file) return route.continue();
  route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: await readFile(path.join(ROOT, 'fixtures/showcase', file), 'utf8'),
  });
});

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
for (let i = 0; i < 80; i++) {
  if ((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length) break;
  await new Promise((r) => setTimeout(r, 100));
}
const extensionId = new URL(worker.url()).host;
const page = await context.newPage();

async function ready(url) {
  await page.goto(url);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached', timeout: 15_000 });
}

async function mark(text, color) {
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
  await page.locator(`[data-locus-toolbar] .swatch[data-color="${color}"]`).click();
  await page.waitForTimeout(320);
}

const [JOURNAL, PMC, PREPRINT] = Object.keys(PAGES);

await ready(JOURNAL);
await mark('shift in case mix is not represented', 'yellow');
await mark('an optional courtesy to the reader', 'teal');
await mark('absorb site-specific artifacts', 'pink');

await ready(PMC);
await mark('calibration of', 'yellow');
await mark('hypothesis-generating', 'teal');

await ready(PREPRINT);
await mark('recalibration schedules, not retraining', 'teal');
await mark('calibration curve for each', 'pink');
await mark('quietly mislead every threshold-based decision', 'yellow');

// Spread the history: today, a couple of recent days, then earlier months.
const library = await context.newPage();
await library.goto(`chrome-extension://${extensionId}/library.html`);
await library.locator('.timeline, .page-card').first().waitFor();

const DAY = 86_400_000;
const OFFSETS = [0, 0, 1, 3, 12, 40, 41, 95];
await library.evaluate(
  ({ offsets, day }) =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open('locus');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('annotations', 'readwrite');
        const store = tx.objectStore('annotations');
        const all = store.getAll();
        all.onsuccess = () => {
          const rows = all.result.sort((a, b) => a.createdAt - b.createdAt);
          rows.forEach((row, index) => {
            const back = offsets[index % offsets.length] * day;
            store.put({ ...row, createdAt: row.createdAt - back, updatedAt: row.updatedAt - back });
          });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    }),
  { offsets: OFFSETS, day: DAY },
);

await library.reload();
await library.locator('.segmented button[data-mode="timeline"]').click();
await library.waitForTimeout(900);

const height = await library.evaluate(() => {
  const body = document.querySelector('.library-body');
  const bottom = body ? body.getBoundingClientRect().bottom : window.innerHeight;
  return Math.ceil(Math.min(Math.max(bottom + 20, 400), window.innerHeight));
});
await library.screenshot({
  path: path.join(OUT, 'timeline-machine.png'),
  clip: { x: 0, y: 0, width: 1280, height },
});

// Same view in dark mode.
await library.emulateMedia({ colorScheme: 'dark' });
await library.waitForTimeout(400);
await library.screenshot({
  path: path.join(OUT, 'timeline-machine-dark.png'),
  clip: { x: 0, y: 0, width: 1280, height },
});

await context.close();
console.log('timeline previews written to', OUT);

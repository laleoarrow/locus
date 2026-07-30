// Dev utility: screenshot the in-page UI (toolbar + note editor) for visual review.
// Usage: pnpm build:e2e && node e2e/serve.mjs & node e2e/preview.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.output/chrome-mv3-e2e');
const OUT = process.env.OUT_DIR ?? '/tmp';

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  viewport: { width: 900, height: 640 },
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
for (let i = 0; i < 50; i++) {
  const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  if (scripts.length > 0) break;
  await new Promise((r) => setTimeout(r, 100));
}

const page = await context.newPage();
await page.goto('http://localhost:8137/fixtures/nested.html');
await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });

async function select(text) {
  await page.evaluate((text) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
  }, text);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
}

await select('selections can start and end');
await page.locator('[data-locus-toolbar]').waitFor();
await page.waitForTimeout(300); // let the entrance animation settle
await page.screenshot({ path: `${OUT}/locus-toolbar.png` });

await page.locator('[data-locus-toolbar] .swatch[data-color="yellow"]').click();
await page.waitForTimeout(300);
const point = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.data.indexOf('selections');
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
await page.locator('[data-locus-note]').waitFor();
await page.locator('[data-locus-note] textarea').fill('**Key claim** — verify against *Sec. 3.2*\n\n- assumption `iid`\n- [ref](https://example.com)');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/locus-note.png` });

// Image ring preview
await page.goto('http://localhost:8137/fixtures/images.html');
await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
await page.click('#figure-1');
await page.locator('[data-locus-toolbar]').waitFor();
await page.keyboard.press('1');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/locus-ring.png` });

await context.close();
console.log('screenshots written to', OUT);

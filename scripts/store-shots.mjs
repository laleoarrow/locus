/**
 * Capture the 1280x800 screenshots the Chrome Web Store and Edge Add-ons ask
 * for, using the real extension against fixtures/demo.html.
 *
 *   node e2e/serve.mjs &            # fixture server on :8137
 *   pnpm build:e2e                  # localhost pre-granted build
 *   node scripts/store-shots.mjs
 *
 * Writes assets/store-shot-*.png.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, '.output/chrome-mv3-e2e');
const OUT = path.join(ROOT, 'assets');
const DEMO = 'http://localhost:8137/fixtures/demo.html';
const WIDTH = 1280;
const HEIGHT = 800;
const PANEL_WIDTH = 400;

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
for (let i = 0; i < 60; i++) {
  if ((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const extensionId = new URL(worker.url()).host;

const page = await context.newPage();
await page.goto(DEMO);
await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });

/** Select `text` and pop the toolbar. */
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

// 1 — the selection toolbar
await select('shift in case mix is not represented');
await page.screenshot({ path: `${OUT}/store-shot-1-toolbar.png` });

// 2 — a highlight plus the Markdown note editor
await page.locator('[data-locus-toolbar] .swatch[data-color="yellow"]').click();
await page.waitForTimeout(400);
// Phrases must not straddle a source line break — text nodes keep the raw
// whitespace, so indexOf would miss.
await select('an optional courtesy to the reader');
await page.locator('[data-locus-toolbar] .swatch[data-color="teal"]').click();
await page.waitForTimeout(400);
const point = await centreOf('shift in case mix is not represented');
await page.mouse.click(point.x, point.y);
await page.locator('[data-locus-note]').waitFor();
await page
  .locator('[data-locus-note] textarea')
  .fill('**Central claim** — external validation is the *only* evidence of transfer.\n\n- check calibration too\n- see `Figure 1`');
// fill() leaves the caret at the end; show the start of the note instead.
await page.locator('[data-locus-note] textarea').evaluate((el) => {
  el.scrollTop = 0;
  el.setSelectionRange(0, 0);
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/store-shot-2-note.png` });
await page.locator('[data-locus-note-save]').click();
await page.waitForTimeout(400);

// 3 — an image annotation ring
await page.locator('#figure-1').click();
await page.locator('[data-locus-toolbar]').waitFor();
await page.keyboard.press('3');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/store-shot-3-figure.png` });

// 4 — page beside the side panel, composed to look like the real window
const panel = await context.newPage();
await panel.setViewportSize({ width: PANEL_WIDTH, height: HEIGHT });
await panel.goto(
  `chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(DEMO)}`,
);
await panel.waitForTimeout(600);
await panel.screenshot({ path: `${OUT}/.panel.png` });
await page.setViewportSize({ width: WIDTH - PANEL_WIDTH, height: HEIGHT });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/.page.png` });
await context.close();

const composite = spawnSync(
  process.execPath,
  [
    '-e',
    `const sharp=require('sharp');
     sharp({create:{width:${WIDTH},height:${HEIGHT},channels:4,background:'#ffffff'}})
       .composite([{input:'${OUT}/.page.png',left:0,top:0},
                   {input:'${OUT}/.panel.png',left:${WIDTH - PANEL_WIDTH},top:0}])
       .png().toFile('${OUT}/store-shot-4-panel.png').then(()=>console.log('composed'));`,
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
process.exitCode = composite.status ?? 0;

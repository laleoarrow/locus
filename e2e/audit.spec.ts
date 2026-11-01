import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { BASE_URL, clickText, expect, highlight, selectText, test } from './extension';

const AUDIT = `${BASE_URL}/fixtures/audit.html`;
const CAPTURE = process.env.LOCUS_AUDIT_CAPTURE;
const IMAGES = path.resolve('docs/audit-2026-11-01/images', CAPTURE === 'after' ? 'after' : '.');

test.beforeEach(async ({ serviceWorker }) => {
  // The isolated audit must not call a release endpoint or any live service.
  await serviceWorker.evaluate(() => chrome.alarms.clear('locus-update-check'));
});

test.afterEach(async ({ context }, testInfo) => {
  if (!['baseline', 'after'].includes(CAPTURE ?? '') || testInfo.status === testInfo.expectedStatus) return;
  const page = context.pages().find((candidate) => candidate.url().startsWith(AUDIT));
  if (page) await capture(page, `${testInfo.title.match(/^E\d+/)?.[0] ?? 'audit'}-${CAPTURE}-failure.png`);
});

async function capture(page: Page, name: string): Promise<void> {
  if (!['baseline', 'after'].includes(CAPTURE ?? '')) return;
  await mkdir(IMAGES, { recursive: true });
  await page.screenshot({ path: path.join(IMAGES, name), animations: 'disabled' });
}

async function dragImage(page: Page, selector: string): Promise<void> {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(box.x + 16, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 16, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('E83: isolated reading, image and library flows remain usable with unconfigured services', async ({
  context, serviceWorker, extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(AUDIT);
  await selectText(page, '#claim', 'preserves uncertainty');
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await capture(page, '01-selection-toolbar.png');
  await page.locator('[data-locus-toolbar] .swatch[data-color="yellow"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await clickText(page, '#claim', 'preserves uncertainty');
  const editor = page.locator('[data-locus-note] textarea');
  await expect(page.getByRole('dialog', { name: 'Note', exact: true })).toBeVisible();
  await expect(editor).toHaveAccessibleName('Note text');
  await expect(editor).toBeFocused();
  await editor.fill('**Review the estimate** and keep the uncertainty explicit.');
  await expect(page.locator('[data-locus-note-preview] strong')).toHaveText('Review the estimate');
  await capture(page, '02-text-note-editor.png');
  await page.locator('[data-locus-note-save]').click();
  await expect(page.locator('[data-locus-note]')).toBeHidden();

  await dragImage(page, '#figure-a');
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '2');
  await expect(page.locator('[data-locus-ring]')).toBeVisible();
  await capture(page, '03-image-ring.png');
  await dragImage(page, '#figure-a');
  await expect(editor).toBeFocused();
  await editor.fill('Synthetic figure annotation for the audit.');
  await capture(page, '04-image-note-reopened.png');
  await page.locator('[data-locus-note-save]').click();

  const extra = await context.newPage();
  await extra.goto(`${BASE_URL}/fixtures/nested.html`);
  await highlight(extra, '#probe-2', 'footnote marker');
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(library.locator('.page-card')).toHaveCount(2);
  for (const checkbox of await library.locator('[data-page-select]').all()) await checkbox.check();
  await expect(library.locator('[data-selection="count"]')).toHaveText('3 selected · 2 pages');
  await capture(library, '05-library-batch.png');
  await library.locator('[data-selection="exit"]').click();
  await library.locator('[data-status="llm"]').click();
  const status = library.getByRole('dialog', { name: 'Connection status · 连接状态' });
  await expect(status).toBeVisible();
  await expect(status.locator('[data-status-test="llm"]')).toBeDisabled();
  await expect(status.locator('[data-status-test="sync"]')).toBeDisabled();
  await capture(library, '06-service-status.png');
  await status.locator('[data-status-action="llm-settings"]').click();
  const settings = library.getByRole('dialog', { name: 'LLM settings' });
  await expect(settings.locator('[data-llm="enabled"]')).not.toBeChecked();
  await capture(library, '07-llm-settings.png');
  await library.keyboard.press('Escape');
  await expect(settings).not.toBeVisible();
});

test('E84: an image annotation follows its distinct alt after reordering and detaches when removed', async ({
  context, serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(AUDIT);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await dragImage(page, '#figure-b');
  await page.keyboard.press('1');
  const ring = page.locator('[data-locus-ring]');
  await expect(ring).toBeVisible();
  await page.evaluate(() => {
    const a = document.getElementById('figure-a')!;
    const b = document.getElementById('figure-b')!;
    const slot = b.parentElement!;
    a.replaceWith(b);
    slot.prepend(a);
  });
  await expect.poll(async () => {
    const image = (await page.locator('#figure-b').boundingBox())!;
    const outline = (await ring.boundingBox())!;
    return Math.abs(outline.x - (image.x - 4)) + Math.abs(outline.y - (image.y - 4));
  }).toBeLessThan(2);
  await capture(page, '08-image-reordered.png');
  await page.locator('#figure-b').evaluate((image) => image.remove());
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '0');
  await expect(page.locator('[data-locus-ring]')).toHaveCount(0);
});

test('E85: image rings follow nested scrolling, clip to the panel and disappear while hidden', async ({
  context, serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(AUDIT);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await dragImage(page, '#scroll-image');
  await page.keyboard.press('1');
  const ring = page.locator('[data-locus-ring]');
  await expect(ring).toBeVisible();
  await page.locator('#image-scroll').evaluate((panel) => { panel.scrollTop = 80; });
  await expect.poll(async () => {
    const image = (await page.locator('#scroll-image').boundingBox())!;
    const outline = (await ring.boundingBox())!;
    return Math.abs(outline.y - (image.y - 4));
  }).toBeLessThan(2);
  expect(await ring.evaluate((element) => getComputedStyle(element).clipPath)).not.toBe('none');
  await capture(page, '09-image-scroll-clipping.png');
  await page.locator('#scroll-image').evaluate((image) => { image.style.visibility = 'hidden'; });
  await expect(ring).toBeHidden();
  await page.locator('#scroll-image').evaluate((image) => { image.style.visibility = 'visible'; });
  await expect(ring).toBeVisible();
});

test('E86: IME confirmation keeps the note draft open until a non-composing Enter saves it', async ({
  context, serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(AUDIT);
  await highlight(page, '#claim', 'preserves uncertainty');
  await clickText(page, '#claim', 'preserves uncertainty');
  const editor = page.locator('[data-locus-note] textarea');
  await editor.fill('候选词尚未提交');
  await editor.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', isComposing: true, bubbles: true, composed: true, cancelable: true,
  })));
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('候选词尚未提交');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('候选词尚未提交');
  await capture(page, '10-ime-draft.png');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-locus-note]')).toBeHidden();
  await clickText(page, '#claim', 'preserves uncertainty');
  await expect(editor).toHaveValue('候选词尚未提交');
});

test('E87: a failed local note write keeps the draft available for retry', async ({
  context, serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(AUDIT);
  await highlight(page, '#claim', 'preserves uncertainty');
  await clickText(page, '#claim', 'preserves uncertainty');
  const editor = page.locator('[data-locus-note] textarea');
  const draft = 'Keep this draft after the simulated storage failure.';
  await editor.fill(draft);
  await serviceWorker.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let failures = 0;
    (globalThis as unknown as { restoreAuditPut: () => number }).restoreAuditPut = () => {
      IDBObjectStore.prototype.put = original;
      return failures;
    };
    // Dexie caches its transaction factory, so fail the native annotation
    // writes themselves until the test explicitly restores storage.
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'annotations') {
        failures++;
        throw new DOMException('Synthetic audit storage failure', 'AbortError');
      }
      return original.call(this, value, key);
    };
  });
  await page.locator('[data-locus-note-save]').click();
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(draft);
  await expect(page.locator('[data-locus-note]').getByRole('alert')).toBeVisible();
  await capture(page, '11-note-save-retry.png');
  expect(await serviceWorker.evaluate(() => (globalThis as unknown as { restoreAuditPut: () => number }).restoreAuditPut())).toBeGreaterThan(0);
  await page.locator('[data-locus-note-save]').click();
  await expect(page.locator('[data-locus-note]')).toBeHidden();
  await clickText(page, '#claim', 'preserves uncertainty');
  await expect(editor).toHaveValue(draft);
});

test('E88: native editing keeps digit input and the note editor fits a narrow viewport', async ({
  context, serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(AUDIT);
  for (const selector of ['#native-input', '#native-textarea', '#native-editable']) {
    await selectText(page, '#claim', 'preserves uncertainty');
    await page.locator(selector).focus();
    await page.keyboard.press('1');
    await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '0');
    if (selector === '#native-editable') await expect(page.locator(selector)).toContainText('1');
    else await expect(page.locator(selector)).toHaveValue('1');
  }
  await page.locator('#claim').scrollIntoViewIfNeeded();
  await highlight(page, '#claim', 'preserves uncertainty');
  await page.setViewportSize({ width: 280, height: 480 });
  await page.locator('#claim').scrollIntoViewIfNeeded();
  await clickText(page, '#claim', 'uncertainty');
  const note = page.locator('[data-locus-note]');
  await expect(note).toBeVisible();
  await expect.poll(() => note.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  })).toBe(true);
  await expect(note.locator('[data-locus-note-save]')).toBeInViewport();
  await capture(page, '12-narrow-note.png');
});

test('E92: late source and DOM updates still re-anchor after the initial fifteen seconds', async ({
  context, serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(AUDIT);
  await highlight(page, '#claim', 'preserves uncertainty');
  await dragImage(page, '#figure-a');
  await page.keyboard.press('2');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '2');
  const originalSrc = await page.locator('#figure-a').getAttribute('src');
  // This single real wait also ages the extension's isolated-world timers;
  // page-world fake clocks do not reliably cover that lifecycle boundary.
  await page.waitForTimeout(15_200);
  await page.evaluate(() => {
    const image = document.getElementById('figure-a') as HTMLImageElement;
    image.src = (document.getElementById('scroll-image') as HTMLImageElement).src;
    document.getElementById('claim')!.textContent = 'Later article content still preserves uncertainty while replacing the original text nodes.';
  });
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '1');
  await expect(page.locator('[data-locus-ring]')).toHaveCount(0);
  await page.locator('#figure-a').evaluate((image, src) => { image.setAttribute('src', src!); }, originalSrc);
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '2');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '0');
  await page.locator('#figure-a').evaluate((image) => {
    const replacement = image.cloneNode(true) as HTMLElement;
    replacement.style.transform = 'translateX(20px)';
    image.replaceWith(replacement);
  });
  await expect.poll(async () => {
    const image = await page.locator('#figure-a').boundingBox();
    const ring = await page.locator('[data-locus-ring]').boundingBox();
    return image && ring ? Math.abs(ring.x - (image.x - 4)) : Infinity;
  }).toBeLessThan(2);
});

test('E93: removing a pending image hides the palette without creating a dangling annotation', async ({
  context, serviceWorker, extensionId,
}) => {
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  await library.evaluate(() => chrome.runtime.sendMessage({ type: 'prefs:set-placement', placement: 'auto' }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(AUDIT);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await dragImage(page, '#figure-a');
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await page.locator('#figure-a').evaluate((image) => image.remove());
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
  await page.keyboard.press('1');
  const annotations = await library.evaluate((url) => chrome.runtime.sendMessage({ type: 'annotations:list', url }), AUDIT);
  expect(annotations.items).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('E94: one damaged stored anchor detaches without blocking healthy text highlights', async ({
  context, serviceWorker, extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(AUDIT);
  await highlight(page, '#claim', 'preserves uncertainty');
  await highlight(page, '#context', 'short note', 'teal');
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  // Model a damaged pre-existing database row, bypassing import validation.
  await library.evaluate(() => new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open('locus');
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      const tx = db.transaction(['annotations', 'anchors'], 'readwrite');
      const annotations = tx.objectStore('annotations');
      const anchors = tx.objectStore('anchors');
      const first = annotations.getAll();
      first.onsuccess = () => {
        const annotation = first.result[0] as { id: string; [key: string]: unknown };
        const lookup = anchors.index('annotationId').get(annotation.id);
        lookup.onsuccess = () => {
          const id = '00000000-audit-damaged-anchor';
          annotations.put({ ...annotation, id });
          anchors.put({ ...lookup.result, id: `${id}-anchor`, annotationId: id, startPoint: null });
        };
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '2');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '1');
  const quotes = await page.evaluate(() => ['locus-yellow', 'locus-teal'].flatMap((name) => {
    const ranges = CSS.highlights.get(name);
    return ranges ? [...ranges as unknown as Iterable<Range>].map((range) => range.toString()) : [];
  }));
  expect(quotes.sort()).toEqual(['preserves uncertainty', 'short note'].sort());
  expect(errors).toEqual([]);
});

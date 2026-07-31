import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page, Worker } from '@playwright/test';
import {
  BASE_URL,
  clickText,
  expect,
  highlight,
  launchSeparateProfile,
  readAnnotationRow,
  selectContents,
  selectText,
  test,
} from './extension';

const NESTED = `${BASE_URL}/fixtures/nested.html`;
const REPEATED = `${BASE_URL}/fixtures/repeated.html`;
const DYNAMIC = `${BASE_URL}/fixtures/dynamic.html`;
const SVG = `${BASE_URL}/fixtures/svg.html`;
const MATHJAX = `${BASE_URL}/fixtures/mathjax.html`;
const IFRAME = `${BASE_URL}/fixtures/iframe.html`;
const IMAGES = `${BASE_URL}/fixtures/images.html`;

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
  await page.locator('[data-locus-toolbar] .swatch[data-color="teal"]').click();
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

test('E5: clicking a highlight opens a Markdown note that persists to the panel', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-3', 'triple-wrapped');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  // Click the highlighted text itself to open the note editor.
  await clickText(page, '#probe-3', 'triple-wrapped');
  const note = page.locator('[data-locus-note]');
  await expect(note).toBeVisible();
  await note.locator('textarea').fill('**key claim** — re-check `derivation`');
  // Live preview renders the markdown.
  await expect(note.locator('[data-locus-note-preview] strong')).toHaveText('key claim');
  await note.locator('[data-locus-note-save]').click();
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
  await expect(panel.locator('.annotation-comment strong')).toHaveText('key claim');
  await expect(panel.locator('.annotation-comment code')).toHaveText('derivation');
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
    const highlightNames = ['locus-yellow', 'locus-teal', 'locus-pink'];
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

test('E41: side panel shows its version and opens the full Library', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  const version = await panel.evaluate(() => chrome.runtime.getManifest().version);
  await expect(panel.locator('[data-locus-version]')).toHaveText(`Locus · 文迹 · v${version}`);

  const [library] = await Promise.all([
    context.waitForEvent('page'),
    panel.locator('button[data-action="open-library"]').click(),
  ]);
  await library.waitForLoadState('domcontentloaded');
  await expect(library).toHaveURL(`chrome-extension://${extensionId}/library.html`);
  await expect(library.locator('.library-header')).toBeVisible();
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

test('E13: keyboard 1/2/3 pick a color for the pending selection', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await selectText(page, '#probe-2', 'hyperlink that spans');
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  const tealCount = await page.evaluate(() => {
    const teal = CSS.highlights.get('locus-teal');
    return teal ? [...(teal as unknown as Iterable<Range>)].length : 0;
  });
  expect(tealCount).toBe(1);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
});

test('E14: Cmd/Ctrl+Z undoes the last highlight', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '0');
});

test('E15: image clicks stay native; dragging selects an image for a persistent ring', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(IMAGES);
  await expect(page.locator('html')).toHaveAttribute('data-locus-ready', '1');
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });

  // A normal click remains completely native: linked images navigate and do
  // not open Locus. This is essential for publisher full-text badges and
  // figures whose page handler opens a zoom/lightbox.
  await page.click('#figure-linked');
  await expect(page).toHaveURL(`${IMAGES}#somewhere`);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();

  await page.goto(IMAGES);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await page.click('#figure-1');
  await expect(page.locator('#native-image-clicks')).toHaveText('1');
  await expect(page.locator('#figure-1')).toHaveClass(/zoomed/);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();

  // Motion below the threshold is still an ordinary page click. Native
  // dragstart can occur before 8 px, so it must not promote this jitter into a
  // Locus selection.
  const jitterBox = await page.locator('#figure-1').boundingBox();
  if (!jitterBox) throw new Error('plain image has no box for jitter test');
  await page.mouse.move(jitterBox.x + 30, jitterBox.y + 30);
  await page.mouse.down();
  await page.mouse.move(jitterBox.x + 34, jitterBox.y + 30);
  await page.mouse.up();
  await expect(page.locator('#native-image-clicks')).toHaveText('2');
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();

  // Modifier-assisted gestures belong to the page/browser as well. They must
  // never be converted into an image annotation gesture.
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.mouse.move(jitterBox.x + 12, jitterBox.y + jitterBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(jitterBox.x + jitterBox.width - 12, jitterBox.y + jitterBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
  await expect(page.locator('#native-image-clicks')).toHaveText('2');

  // A deliberate primary-button drag across a linked image selects it for
  // Locus without following the link. Horizontal and vertical movement share
  // the same distance threshold; this fixture exercises the horizontal path.
  const linkedBox = await page.locator('#figure-linked').boundingBox();
  if (!linkedBox) throw new Error('linked image has no box');
  await page.mouse.move(linkedBox.x + 12, linkedBox.y + linkedBox.height / 2);
  await page.mouse.down();
  // End in the wrapping link's padding. Chromium then targets the synthetic
  // click at the common ancestor <a>, not necessarily at its child <img>.
  await page.mouse.move(linkedBox.x + linkedBox.width + 6, linkedBox.y + linkedBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page).toHaveURL(IMAGES);
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await page.click('#probe-3');
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();

  // Dragging a plain image offers the toolbar without invoking the page's
  // click-to-zoom handler; shortcut 1 creates the fluorescent yellow ring.
  const plainBox = await page.locator('#figure-1').boundingBox();
  if (!plainBox) throw new Error('plain image has no box');
  await page.mouse.move(plainBox.x + plainBox.width / 2, plainBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(
    plainBox.x + plainBox.width / 2,
    plainBox.y + plainBox.height - 10,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await expect(page.locator('#native-image-clicks')).toHaveText('2');
  await page.keyboard.press('1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  const ring = page.locator('[data-locus-ring]');
  await expect(ring).toBeVisible();
  const imgBox = await page.locator('#figure-1').boundingBox();
  const ringBox = await ring.boundingBox();
  expect(Math.abs((ringBox?.x ?? 0) - ((imgBox?.x ?? 0) - 4))).toBeLessThan(2);
  expect(Math.abs((ringBox?.y ?? 0) - ((imgBox?.y ?? 0) - 4))).toBeLessThan(2);

  // Even after an image has a Locus ring, an ordinary click remains the
  // page's click. It must neither reopen the toolbar nor steal the click for a
  // Locus note editor.
  await page.click('#figure-1');
  await expect(page.locator('#native-image-clicks')).toHaveText('3');
  await expect(page.locator('#figure-1')).toHaveClass(/zoomed/);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
  await expect(page.locator('[data-locus-note]')).toBeHidden();

  // The same explicit gesture reopens an existing image annotation instead
  // of creating a duplicate; its ordinary click remains reserved for the page.
  const annotatedBox = await page.locator('#figure-1').boundingBox();
  if (!annotatedBox) throw new Error('annotated image has no box');
  await page.mouse.move(annotatedBox.x + 12, annotatedBox.y + annotatedBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    annotatedBox.x + annotatedBox.width - 12,
    annotatedBox.y + annotatedBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator('[data-locus-note]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('#native-image-clicks')).toHaveText('3');
  await page.click('#probe-3');
  await expect(page.locator('[data-locus-note]')).toBeHidden();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('[data-locus-ring]')).toBeVisible();

  const panel = await openPanelFor(page, serviceWorker, extensionId, IMAGES);
  const item = panel.locator('.annotation-item');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.annotation-image img')).toBeVisible();
});

test('E16: Enter saves the note; Delete on an empty note removes the highlight', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await clickText(page, '#probe-2', 'footnote marker');
  const note = page.locator('[data-locus-note]');
  await expect(note).toBeVisible();
  await note.locator('textarea').fill('quick thought');
  await note.locator('textarea').press('Enter');
  await expect(note).toBeHidden();
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  await expect(panel.locator('.annotation-comment')).toContainText('quick thought');

  // Re-open, clear the note, press Delete → the highlight is removed.
  await clickText(page, '#probe-2', 'footnote marker');
  await expect(note).toBeVisible();
  await note.locator('textarea').fill('');
  await note.locator('textarea').press('Backspace');
  await expect(note).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '0');
  await expect(panel.locator('.annotation-item')).toHaveCount(0);
});

test('E37: Delete/Backspace removes every selected annotation as one undoable batch', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker');
  await highlight(page, '#probe-2', 'hyperlink that spans');
  await highlight(page, '#probe-3', 'second paragraph');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '3');

  // A site-level bubble handler must not be able to make Locus shortcuts
  // intermittently disappear.
  await page.locator('#probe-2').evaluate((probe) => {
    probe.addEventListener('keydown', (event) => event.stopImmediatePropagation());
  });
  await selectContents(page, '#probe-2', true);
  await page.keyboard.press('Delete');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  // The two tombstones form one undo action.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '3');

  // An editable target keeps its native key behavior even while the old page
  // selection still overlaps both annotations.
  const textarea = page.locator('textarea[data-shortcut-probe]');
  await page.locator('body').evaluate((body) => {
    const input = document.createElement('textarea');
    input.dataset['shortcutProbe'] = '';
    input.value = 'abc';
    body.appendChild(input);
  });
  await textarea.focus();
  await textarea.press('End');
  await textarea.press('Backspace');
  await expect(textarea).toHaveValue('ab');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '3');

  await textarea.evaluate((element) => element.remove());
  await selectContents(page, '#probe-2', true);
  await page.keyboard.press('Backspace');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
});

test('E17: a custom color can be added and used with the next shortcut digit', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await selectText(page, '#probe-2', 'footnote marker');
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await expect(page.locator('[data-locus-add-color]')).toBeVisible();
  // Drive the hidden picker input directly (the native dialog cannot be automated).
  await page.evaluate(() => {
    const shadow = document.getElementById('locus-host')?.shadowRoot;
    const input = shadow?.querySelector('input[type="color"]') as HTMLInputElement;
    input.value = '#8e44ad';
    input.dispatchEvent(new Event('change'));
  });
  const newSwatch = page.locator('[data-locus-toolbar] .swatch[data-color="c8e44ad"]');
  await expect(newSwatch).toBeVisible();
  await expect(newSwatch).toHaveAttribute('data-shortcut', '4');
  await page.keyboard.press('4');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  const customCount = await page.evaluate(() => {
    const custom = CSS.highlights.get('locus-c8e44ad');
    return custom ? [...(custom as unknown as Iterable<Range>)].length : 0;
  });
  expect(customCount).toBe(1);
  // The custom color survives reload (rules are palette-driven).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
});

test('E38: custom colors stay on their page without changing existing annotation colors', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await selectText(page, '#probe-2', 'footnote marker');
  const toolbar = page.locator('[data-locus-toolbar]');
  await expect(toolbar.locator('.swatch')).toHaveCount(3);

  for (const hex of ['#111111', '#222222', '#333333']) {
    await page.evaluate((value) => {
      const input = document
        .getElementById('locus-host')
        ?.shadowRoot?.querySelector<HTMLInputElement>('input[type="color"]');
      if (!input) throw new Error('no Locus color input');
      input.value = value;
      input.dispatchEvent(new Event('change'));
    }, hex);
    await expect(toolbar.locator(`.swatch[data-color="c${hex.slice(1)}"]`)).toBeVisible();
  }
  await expect(toolbar.locator('.swatch')).toHaveCount(6);
  await toolbar.locator('.swatch[data-color="c333333"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  // The current page remembers all three additions.
  await page.reload();
  await selectText(page, '#probe-3', 'second paragraph');
  await expect(toolbar.locator('.swatch')).toHaveCount(6);

  // An unrelated page starts clean and never inherits those choices.
  await page.goto(REPEATED);
  await selectText(page, '#occurrence-1 p', 'powerhouse');
  await expect(toolbar.locator('.swatch')).toHaveCount(3);
  for (const key of ['c111111', 'c222222', 'c333333']) {
    await expect(toolbar.locator(`.swatch[data-color="${key}"]`)).toHaveCount(0);
  }

  // Returning restores only this page's additions, and the side panel manages
  // the same page-scoped list.
  await page.goto(NESTED);
  await selectText(page, '#probe-3', 'second paragraph');
  await expect(toolbar.locator('.swatch')).toHaveCount(6);
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  const pageColors = panel.locator('[data-page-colors]');
  await expect(pageColors.locator('.color-chip')).toHaveCount(3);

  // Removing a choice affects future toolbar picks only. The annotation
  // already painted with that color keeps both its range and its exact color.
  await pageColors.locator('button[aria-label="Remove #333333"]').click();
  await expect(toolbar.locator('.swatch[data-color="c333333"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  const rendered = await page.evaluate(() => {
    const custom = CSS.highlights.get('locus-c333333');
    return custom ? [...(custom as unknown as Iterable<Range>)].length : 0;
  });
  expect(rendered).toBe(1);
  await expect(panel.locator('.annotation-item .color-dot')).toHaveCSS(
    'background-color',
    'rgb(51, 51, 51)',
  );
});

test('E18: toolbar placement can be set to above, and auto dodges other floating UI', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);

  // Default: below.
  await selectText(page, '#probe-2', 'footnote marker');
  await expect(page.locator('[data-locus-toolbar]')).toHaveAttribute('data-placement', 'below');

  // Explicit "above".
  await panel.locator('.segmented button[data-placement="above"]').click();
  await page.waitForTimeout(400);
  await selectText(page, '#probe-2', 'footnote marker');
  await expect(page.locator('[data-locus-toolbar]')).toHaveAttribute('data-placement', 'above');

  // "Auto": another extension's floating bar below the selection → flip above.
  await panel.locator('.segmented button[data-placement="auto"]').click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const probe = document.querySelector('#probe-3') as HTMLElement;
    const rect = probe.getBoundingClientRect();
    const blocker = document.createElement('div');
    blocker.id = 'fake-other-extension';
    blocker.style.cssText = `position:fixed;left:0;right:0;top:${rect.bottom + 4}px;height:70px;z-index:99999;background:rgba(0,0,0,0.01);`;
    document.body.appendChild(blocker);
  });
  await selectText(page, '#probe-3', 'second paragraph');
  await expect(page.locator('[data-locus-toolbar]')).toHaveAttribute('data-placement', 'above');
  // Without a blocker, auto stays below.
  await page.evaluate(() => document.getElementById('fake-other-extension')?.remove());
  await selectText(page, '#probe-2', 'footnote marker');
  await expect(page.locator('[data-locus-toolbar]')).toHaveAttribute('data-placement', 'below');
});

test('E26: auto placement dodges realistically-built rival toolbars', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/fixtures/competitor.html`);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  const panel = await openPanelFor(page, serviceWorker, extensionId, `${BASE_URL}/fixtures/competitor.html`);
  await panel.locator('.segmented button[data-placement="auto"]').click();
  await page.waitForTimeout(300);

  // Each mode is a shape real selection toolbars actually take.
  for (const mode of ['pointer-events', 'absolute', 'nested', 'late'] as const) {
    await page.goto(`${BASE_URL}/fixtures/competitor.html?mode=${mode}`);
    await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
    await selectText(page, '#probe-2', 'a rival toolbar appear');
    await expect(page.locator('html')).toHaveAttribute('data-rival-shown', '1');
    await expect(
      page.locator('[data-locus-toolbar]'),
      `mode=${mode}: the rival sits below the selection, so Locus must go above`,
    ).toHaveAttribute('data-placement', 'above', { timeout: 3000 });
  }
});

test('E19: ⌘-hover reveals the site-off switch; ✕ disables Locus on this site', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await selectText(page, '#probe-2', 'footnote marker');
  const toolbar = page.locator('[data-locus-toolbar]');
  await expect(toolbar).toBeVisible();
  const siteOff = page.locator('[data-locus-site-off]');
  await expect(toolbar).not.toHaveClass(/extended/);

  // Hold ⌘ and glide to the toolbar's right edge → the ✕ zone slides out.
  const box = await toolbar.boundingBox();
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) - 6, (box?.y ?? 0) + (box?.height ?? 0) / 2, { steps: 6 });
  await page.keyboard.up('ControlOrMeta');
  await expect(toolbar).toHaveClass(/extended/);

  await siteOff.click();
  await expect(page.locator('html')).toHaveAttribute('data-locus-disabled', '1');
  await expect(toolbar).toBeHidden();
  // Selection no longer offers the toolbar while disabled.
  await page.evaluate(() => {
    const p = document.querySelector('#probe-3');
    const range = document.createRange();
    range.selectNodeContents(p as Node);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await expect(toolbar).toBeHidden();

  // Re-enable from the extension (popup path uses the same message).
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  await panel.evaluate(
    (origin) => chrome.runtime.sendMessage({ type: 'prefs:toggle-site', origin, disabled: false }),
    new URL(NESTED).origin,
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-locus-disabled', '1');
  await selectText(page, '#probe-2', 'footnote marker');
  await expect(toolbar).toBeVisible();
});

test('E20: DOI match prompts jumping to the annotated version', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const DOI_A = `${BASE_URL}/fixtures/doi-a.html`;
  const DOI_B = `${BASE_URL}/fixtures/doi-b.html`;
  const page = await context.newPage();

  // Annotate version A.
  await page.goto(DOI_A);
  await highlight(page, '#probe-3', 'distinctive sentence');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('[data-locus-version-toast]')).toBeHidden();

  // Open version B (same DOI, different case & URL) → jump prompt.
  await page.goto(DOI_B);
  const toast = page.locator('[data-locus-version-toast]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('1 note');
  await page.locator('[data-locus-version-open]').click();
  await page.waitForURL(DOI_A);
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  // Switching the DOI pref off silences the prompt.
  const panel = await openPanelFor(page, serviceWorker, extensionId, DOI_A);
  await panel.locator('input[data-pref="detect-doi"] + span').click();
  await page.waitForTimeout(300);
  await page.goto(DOI_B);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await expect(page.locator('[data-locus-version-toast]')).toBeHidden();
});

test('E22: backup round-trips through a real exported file', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-4', 'Quotation blocks');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  // Attach a note so the export has to carry Markdown too.
  await clickText(page, '#probe-4', 'Quotation blocks');
  await page.locator('[data-locus-note] textarea').fill('**backup me**');
  await page.locator('[data-locus-note-save]').click();

  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
  const annotationId = (await panel
    .locator('.annotation-item')
    .getAttribute('data-annotation-id')) as string;

  // Export → a real browser download.
  const download = await Promise.all([
    panel.waitForEvent('download'),
    panel.locator('.backup-actions button[data-action="export"]').click(),
  ]).then(([event]) => event);
  expect(download.suggestedFilename()).toMatch(/^locus-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const savedTo = path.join(os.tmpdir(), `locus-e2e-${Date.now()}.json`);
  await download.saveAs(savedTo);
  const parsed = JSON.parse(await readFile(savedTo, 'utf8'));
  expect(parsed.format).toBe('locus-backup');
  expect(parsed.annotations).toHaveLength(1);
  expect(parsed.annotations[0].comment).toBe('**backup me**');

  // Wipe the library, then import the file back.
  await panel.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('locus');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
      }),
  );
  await panel.reload();
  await expect(panel.locator('.annotation-item')).toHaveCount(0);

  await panel.locator('input[data-locus-import-input]').setInputFiles(savedTo);
  await expect(panel.locator('[data-locus-backup-status]')).toContainText('1 added');
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
  await expect(panel.locator('.annotation-item')).toHaveAttribute(
    'data-annotation-id',
    annotationId,
  );
  await expect(panel.locator('.annotation-comment strong')).toHaveText('backup me');

  // The restored anchor still resolves on the page.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '0');

  // Importing the same file again changes nothing.
  await panel.locator('input[data-locus-import-input]').setInputFiles(savedTo);
  await expect(panel.locator('[data-locus-backup-status]')).toContainText('0 added');
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
  await rm(savedTo, { force: true });
});

const DAV_URL = `${BASE_URL}/dav/locus/`;
const DAV_USER = 'tester';
const DAV_PASS = 'app-password';

test('E23: two independent installs converge through WebDAV sync', async ({
  context,
  serviceWorker,
  extensionId,
  request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);

  // ── Device A: annotate, then set sync up through the real settings form.
  const pageA = await context.newPage();
  await pageA.goto(NESTED);
  await highlight(pageA, '#probe-2', 'footnote marker');
  await expect(pageA.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  const panelA = await openPanelFor(pageA, serviceWorker, extensionId, NESTED);
  await panelA.locator('button[data-action="sync-settings"]').click();
  await panelA.locator('input[data-sync="url"]').fill(DAV_URL);
  await panelA.locator('input[data-sync="username"]').fill(DAV_USER);
  await panelA.locator('input[data-sync="password"]').fill(DAV_PASS);
  await panelA.locator('input[data-sync="username"]').click(); // blur the password field
  await panelA.locator('button[data-action="sync-test"]').click();
  await expect(panelA.locator('[data-locus-sync-status]')).toHaveText('Connected.');
  await panelA.locator('input[data-pref="sync-enabled"] + span').click();
  await panelA.locator('button[data-action="sync-now"]').click();
  await expect(panelA.locator('[data-locus-sync-status]')).toContainText('Synced');

  // Credentials live in chrome.storage.local, so a real export must not leak
  // them into a file the user might share.
  const dump = await Promise.all([
    panelA.waitForEvent('download'),
    panelA.locator('.backup-actions button[data-action="export"]').click(),
  ]).then(([event]) => event);
  const dumpPath = path.join(os.tmpdir(), `locus-sync-export-${Date.now()}.json`);
  await dump.saveAs(dumpPath);
  const dumpText = await readFile(dumpPath, 'utf8');
  expect(dumpText).not.toContain(DAV_PASS);
  expect(dumpText).not.toContain(DAV_USER);
  await rm(dumpPath, { force: true });

  // ── Device B: a separate profile, own IndexedDB, same WebDAV folder.
  const b = await launchSeparateProfile();
  try {
    const panelB = await b.context.newPage();
    await panelB.goto(
      `chrome-extension://${b.extensionId}/sidepanel.html?url=${encodeURIComponent(NESTED)}`,
    );
    await expect(panelB.locator('.annotation-item')).toHaveCount(0);

    const configure = (panel: Page) =>
      panel.evaluate(
        (cfg) =>
          chrome.runtime.sendMessage({
            type: 'sync:save',
            patch: { ...cfg, enabled: true },
          }),
        { url: DAV_URL, username: DAV_USER, password: DAV_PASS },
      );
    await configure(panelB);
    const pulled = await panelB.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
    expect(pulled.result.ok).toBe(true);
    expect(pulled.result.pulled).toBe(1);

    // A's highlight is now in B's library, attached to the same page…
    await expect(panelB.locator('.annotation-item')).toHaveCount(1);
    // …and it re-anchors on B's copy of the page.
    const pageB = await b.context.newPage();
    await pageB.goto(NESTED);
    await expect(pageB.locator('html')).toHaveAttribute('data-locus-anchored', '1');
    await expect(pageB.locator('html')).toHaveAttribute('data-locus-detached', '0');

    // Settings-only changes also converge and refresh an already-open page.
    const color = {
      key: 'c345678',
      label: '#345678',
      swatch: '#345678',
      bg: 'rgba(52, 86, 120, 0.45)',
    };
    const addedColor = await panelB.evaluate(
      ({ url, color }) =>
        chrome.runtime.sendMessage({ type: 'page-colors:add', url, color }),
      { url: NESTED, color },
    );
    expect(addedColor.colors).toContain(color.key);
    const colorPush = await panelB.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'sync:now' }),
    );
    expect(colorPush.result.ok).toBe(true);
    const colorPull = await panelA.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'sync:now' }),
    );
    expect(colorPull.result.ok).toBe(true);
    expect(colorPull.result.pulled).toBe(0);
    expect(colorPull.result.settingsPulled).toBeGreaterThan(0);
    await selectText(pageA, '#probe-3', 'second paragraph');
    await expect(
      pageA.locator('[data-locus-toolbar] .swatch[data-color="c345678"]'),
    ).toBeVisible();
    await pageA.keyboard.press('Escape');

    // ── B adds its own note and pushes; A pulls and ends up with both.
    await highlight(pageB, '#probe-3', 'triple-wrapped');
    await expect(pageB.locator('html')).toHaveAttribute('data-locus-anchored', '2');
    const pushed = await panelB.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
    expect(pushed.result.ok).toBe(true);

    const back = await panelA.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
    expect(back.result.ok).toBe(true);
    expect(back.result.pulled).toBe(1);
    await expect(panelA.locator('.annotation-item')).toHaveCount(2);
    await expect(pageA.locator('html')).toHaveAttribute('data-locus-anchored', '2');

    // ── A deletion on B propagates to A rather than coming back to life.
    const target = (await panelB
      .locator('.annotation-item')
      .first()
      .getAttribute('data-annotation-id')) as string;
    await panelB.evaluate(
      (id) => chrome.runtime.sendMessage({ type: 'annotation:delete', id }),
      target,
    );
    await expect(panelB.locator('.annotation-item')).toHaveCount(1);
    await panelB.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
    await panelA.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
    await expect(panelA.locator('.annotation-item')).toHaveCount(1);
    // Syncing again must not resurrect it.
    await panelA.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
    await panelB.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
    await expect(panelA.locator('.annotation-item')).toHaveCount(1);
    await expect(panelB.locator('.annotation-item')).toHaveCount(1);
  } finally {
    await b.context.close();
  }
});

test('E24: sync reports a bad password instead of failing silently', async ({
  context,
  serviceWorker,
  extensionId,
  request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const page = await context.newPage();
  await page.goto(NESTED);
  const panel = await openPanelFor(page, serviceWorker, extensionId, NESTED);
  await panel.evaluate(
    (cfg) => chrome.runtime.sendMessage({ type: 'sync:save', patch: { ...cfg, enabled: true } }),
    { url: DAV_URL, username: DAV_USER, password: 'wrong-password' },
  );
  const outcome = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
  expect(outcome.result.ok).toBe(false);
  expect(outcome.result.error).toContain('app password');
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

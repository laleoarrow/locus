import type { Page, Worker } from '@playwright/test';
import {
  BASE_URL,
  clickText,
  expect,
  highlight,
  readAnnotationRow,
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

test('E15: clicking an image rings it; the ring and panel entry survive reload', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(IMAGES);
  await expect(page.locator('html')).toHaveAttribute('data-locus-ready', '1');
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });

  // A linked image must be left alone.
  await page.click('#figure-linked');
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();

  // A plain image offers the toolbar; shortcut 1 = fluorescent yellow ring.
  await page.click('#figure-1');
  await expect(page.locator('[data-locus-toolbar]')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  const ring = page.locator('[data-locus-ring]');
  await expect(ring).toBeVisible();
  const imgBox = await page.locator('#figure-1').boundingBox();
  const ringBox = await ring.boundingBox();
  expect(Math.abs((ringBox?.x ?? 0) - ((imgBox?.x ?? 0) - 4))).toBeLessThan(2);
  expect(Math.abs((ringBox?.y ?? 0) - ((imgBox?.y ?? 0) - 4))).toBeLessThan(2);

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

import type { Page } from '@playwright/test';
import { BASE_URL, clickText, expect, highlight, test } from './extension';

const ARTICLE = `${BASE_URL}/fixtures/performance.html`;

test.beforeEach(async ({ serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.alarms.clear('locus-update-check'));
});

async function seedImages(article: Page, library: Page, count: number): Promise<string[]> {
  const images = await article.locator('#image-grid img').evaluateAll((elements, count) =>
    elements.slice(0, count).map((element, imgIndex) => {
      const image = element as HTMLImageElement;
      return { kind: 'image', src: image.currentSrc || image.src, alt: image.alt, imgIndex, matchCount: 1, path: [] };
    }), count);
  return library.evaluate(async ({ images, url }) => {
    const ids: string[] = [];
    for (const anchor of images) {
      const result = await chrome.runtime.sendMessage({ type: 'annotation:create', url, title: 'Synthetic image performance fixture', color: 'yellow', comment: '', anchor });
      ids.push(result.item.annotation.id);
    }
    return ids;
  }, { images, url: article.url() });
}

async function recolor(library: Page, url: string, ids: string[], color: string): Promise<void> {
  const result = await library.evaluate(async ({ url, ids, color }) => {
    const current = await chrome.runtime.sendMessage({ type: 'annotations:list', url });
    const expected = current.items.filter((item: { annotation: { id: string } }) => ids.includes(item.annotation.id))
      .map(({ annotation }: { annotation: { id: string; updatedAt: number; colorUpdatedAt?: number; createdAt: number; deletedAt: number } }) => ({
        id: annotation.id, updatedAt: annotation.updatedAt, colorUpdatedAt: annotation.colorUpdatedAt ?? annotation.createdAt, deletedAt: annotation.deletedAt,
      }));
    return chrome.runtime.sendMessage({ type: 'annotations:edit', expected, action: { type: 'color', color } });
  }, { url, ids, color });
  expect(result.error).toBeUndefined();
  expect(result.updated).toBe(ids.length);
}

async function rememberRings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const shadow = document.getElementById('locus-ring-host')!.shadowRoot!;
    const scope = globalThis as unknown as { originalRings: Element[]; ringAdds: number; ringObserver: MutationObserver };
    scope.originalRings = [...shadow.querySelectorAll('[data-locus-ring]')];
    scope.ringAdds = 0;
    scope.ringObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && node.matches('[data-locus-ring]')) scope.ringAdds++;
      }
    });
    scope.ringObserver.observe(shadow, { childList: true });
  });
}

async function ringWork(page: Page) {
  return page.evaluate(() => {
    const scope = globalThis as unknown as { originalRings: Element[]; ringAdds: number };
    const rings = [...document.getElementById('locus-ring-host')!.shadowRoot!.querySelectorAll('[data-locus-ring]')];
    return { retained: scope.originalRings.length === rings.length && scope.originalRings.every((ring) => rings.includes(ring)), added: scope.ringAdds };
  });
}

test('E98: note and preference updates retain existing image rings while text and colours remain live', async ({ context, extensionId }) => {
  const article = await context.newPage();
  await article.goto(ARTICLE);
  await highlight(article, '#claim', 'remain editable');
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  const [imageId] = await seedImages(article, library, 1);
  await expect(article.locator('html')).toHaveAttribute('data-locus-anchored', '2');
  // Finish the seed's broadcasts before measuring the next user action.
  await article.waitForTimeout(350);
  await rememberRings(article);

  const textRow = library.locator('.annotation').filter({ has: library.locator('.quote', { hasText: 'remain editable' }) });
  await textRow.locator('[data-action="edit"]').click();
  await textRow.locator('textarea').fill('A new note without changing its highlight.');
  await textRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(textRow.locator('.note')).toHaveText('A new note without changing its highlight.');
  await clickText(article, '#claim', 'remain editable');
  await expect(article.locator('[data-locus-note] textarea')).toHaveValue('A new note without changing its highlight.');
  await article.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await ringWork(article)).toEqual({ retained: true, added: 0 });

  await library.evaluate(() => chrome.runtime.sendMessage({ type: 'prefs:set-detect-doi', on: false }));
  expect(await ringWork(article)).toEqual({ retained: true, added: 0 });
  await recolor(library, ARTICLE, [imageId!], 'teal');
  await expect(article.locator(`[data-locus-ring="${imageId}"]`)).toHaveCSS('--ring-color', '#4dd0c4');
  expect(await ringWork(article)).toEqual({ retained: true, added: 0 });
  await article.reload();
  await expect(article.locator('html')).toHaveAttribute('data-locus-anchored', '2');
  await expect(article.locator(`[data-locus-ring="${imageId}"]`)).toHaveCSS('--ring-color', '#4dd0c4');
});

async function maxRingOffset(page: Page, ids: string[]): Promise<number> {
  return page.evaluate((ids) => {
    const shadow = document.getElementById('locus-ring-host')!.shadowRoot!;
    return Math.max(...ids.map((id, index) => {
      const image = document.getElementById(`figure-${index}`)!;
      const ring = shadow.querySelector<HTMLElement>(`[data-locus-ring="${id}"]`);
      if (!ring || ring.style.display === 'none') return Infinity;
      const imageBox = image.getBoundingClientRect(); const ringBox = ring.getBoundingClientRect();
      return Math.max(Math.abs(ringBox.left - (imageBox.left - 4)), Math.abs(ringBox.top - (imageBox.top - 4)));
    }));
  }, ids);
}

test('E99: a batch of image annotations retains identity, clipping and live geometry across layout changes and reload', async ({ context, extensionId }) => {
  const article = await context.newPage(); await article.setViewportSize({ width: 1100, height: 900 });
  await article.goto(ARTICLE);
  await article.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  const library = await context.newPage(); await library.goto(`chrome-extension://${extensionId}/library.html`);
  const ids = await seedImages(article, library, 16);
  await article.reload();
  await expect(article.locator('html')).toHaveAttribute('data-locus-anchored', '16');
  await expect.poll(() => maxRingOffset(article, ids)).toBeLessThan(0.5);
  await rememberRings(article);
  await recolor(library, ARTICLE, ids, 'pink');
  for (const id of ids) await expect(article.locator(`[data-locus-ring="${id}"]`)).toHaveCSS('--ring-color', '#f6a8c0');
  expect(await ringWork(article)).toEqual({ retained: true, added: 0 });

  await article.locator('#image-grid').evaluate((grid) => { (grid as HTMLElement).style.paddingLeft = '48px'; });
  await expect.poll(() => maxRingOffset(article, ids)).toBeLessThan(0.5);
  const first = article.locator(`[data-locus-ring="${ids[0]}"]`);
  await article.locator('#figure-0').evaluate((image) => { (image as HTMLElement).style.visibility = 'hidden'; });
  await expect(first).toBeHidden();
  await article.locator('#figure-0').evaluate((image) => { (image as HTMLElement).style.visibility = ''; });
  await expect(first).toBeVisible();
  await article.locator('#image-panel').evaluate((panel) => {
    const element = panel as HTMLElement; element.style.height = '90px'; element.style.overflow = 'auto'; element.scrollTop = 50;
  });
  await expect.poll(() => first.evaluate((ring) => parseFloat((ring as HTMLElement).style.clipPath.replace('inset(', '')))).toBeGreaterThan(20);
  await article.locator('#image-panel').evaluate((panel) => { panel.scrollTop = 200; });
  await expect(first).toBeHidden();
  await article.locator('#image-panel').evaluate((panel) => {
    const element = panel as HTMLElement; element.scrollTop = 0; element.style.height = ''; element.style.overflow = '';
  });
  await expect.poll(() => maxRingOffset(article, ids)).toBeLessThan(0.5);
  expect(await ringWork(article)).toEqual({ retained: true, added: 0 });
  await article.reload();
  await expect(article.locator('html')).toHaveAttribute('data-locus-anchored', '16');
  await expect.poll(() => maxRingOffset(article, ids)).toBeLessThan(0.5);
  await expect(article.locator(`[data-locus-ring="${ids[0]}"]`)).toHaveCSS('--ring-color', '#f6a8c0');
});

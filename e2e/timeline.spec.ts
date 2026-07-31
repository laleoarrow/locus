import type { BrowserContext, Page } from '@playwright/test';
import { BASE_URL, expect, highlight, test } from './extension';

/**
 * The timeline projection: eras, the day rail, and travelling to a day.
 *
 * Kept in its own spec rather than added to library.spec.ts so the two suites
 * can be worked on independently.
 */

const NESTED = `${BASE_URL}/fixtures/nested.html`;
const DEMO = `${BASE_URL}/fixtures/demo.html`;
const REPEATED = `${BASE_URL}/fixtures/repeated.html`;
const DAYS_TO_PREVIOUS_MONTH = new Date().getDate();
const HISTORY_OFFSETS = [
  0,
  DAYS_TO_PREVIOUS_MONTH,
  DAYS_TO_PREVIOUS_MONTH + 1,
  DAYS_TO_PREVIOUS_MONTH + 2,
];

/** Annotate three pages, then spread the history across days and months. */
async function seedHistory(context: BrowserContext, offsetsInDays: number[]) {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker');
  await highlight(page, '#probe-4', 'Quotation blocks', 'teal');
  await page.goto(DEMO);
  await highlight(page, '#probe-2', 'scoping', 'pink');
  await page.goto(REPEATED);
  await highlight(page, '#occurrence-1 p', 'powerhouse');
  await page.close();
  return offsetsInDays;
}

async function openTimeline(context: BrowserContext, extensionId: string): Promise<Page> {
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  await library.locator('.library-header').waitFor();
  await library.locator('.segmented button[data-mode="timeline"]').click();
  await library.locator('.timeline').waitFor();
  return library;
}

/**
 * Backdate the stored annotations so the timeline has real shape. Timestamps
 * are edited directly because the rows themselves were created through the
 * real UI and are already valid.
 */
async function backdate(page: Page, offsetsInDays: number[]) {
  await page.evaluate(
    ({ offsets, day }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('locus');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('annotations', 'readwrite');
          const store = tx.objectStore('annotations');
          const all = store.getAll();
          all.onsuccess = () => {
            const rows = (all.result as { createdAt: number; updatedAt: number }[]).sort(
              (a, b) => a.createdAt - b.createdAt,
            );
            rows.forEach((row, index) => {
              const back = (offsets[index % offsets.length] ?? 0) * day;
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
    { offsets: offsetsInDays, day: 86_400_000 },
  );
  await page.reload();
  await page.locator('.segmented button[data-mode="timeline"]').click();
  await page.locator('.timeline').waitFor();
}

test('E44: the timeline groups days into eras with a tick per day', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seedHistory(context, []);
  const library = await openTimeline(context, extensionId);

  // Everything was annotated today, so one era and one day.
  await expect(library.locator('.tl-era')).toHaveCount(1);
  await expect(library.locator('.timeline-day')).toHaveCount(1);
  await expect(library.locator('.tl-when').first()).toHaveText('Today');
  await expect(library.locator('.tl-tick')).toHaveCount(1);

  // Spread it over two months: two eras, four days, four ticks.
  await backdate(library, HISTORY_OFFSETS);
  await expect(library.locator('.tl-era')).toHaveCount(2);
  await expect(library.locator('.timeline-day')).toHaveCount(4);
  await expect(library.locator('.tl-tick')).toHaveCount(4);
  await expect(library.locator('.tl-when').first()).toHaveText('Today');
  await expect(library.locator('.tl-when').nth(1)).toHaveText(
    DAYS_TO_PREVIOUS_MONTH === 1 ? 'Yesterday' : `${DAYS_TO_PREVIOUS_MONTH} days ago`,
  );

  // Each entry is still one annotation, and the legacy hooks are intact.
  await expect(library.locator('.timeline-entry')).toHaveCount(4);
});

test('E45: clicking a rail tick travels to that day and marks it current', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seedHistory(context, []);
  const library = await openTimeline(context, extensionId);
  await backdate(library, HISTORY_OFFSETS);

  const ticks = library.locator('.tl-tick');
  await expect(ticks.first()).toHaveAttribute('data-active', 'true');

  // Travel to the oldest day.
  const oldest = ticks.last();
  const targetDay = await oldest.getAttribute('data-tick');
  await oldest.click();
  await expect(oldest).toHaveAttribute('data-active', 'true');
  await expect(ticks.first()).not.toHaveAttribute('data-active', 'true');

  // That day's layer is the one now scrolled into view.
  const layer = library.locator(`.timeline-day[data-day="${targetDay}"]`);
  await expect(layer).toBeInViewport();
  await expect(layer).toHaveAttribute('data-active', 'true');
});

test('E46: older layers recede without fading their text', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seedHistory(context, []);
  const library = await openTimeline(context, extensionId);
  await backdate(library, HISTORY_OFFSETS);

  const depths = await library
    .locator('.timeline-day')
    .evaluateAll((layers) =>
      layers.map((layer) => Number(getComputedStyle(layer).getPropertyValue('--tl-depth'))),
    );
  // Depth is ranked by position, so it rises monotonically from 0 to 1.
  expect(depths[0]).toBe(0);
  expect(depths.at(-1)).toBe(1);
  expect([...depths].sort((a, b) => a - b)).toEqual(depths);

  // The quote text stays fully opaque no matter how far back the layer is:
  // receding must not mean becoming harder to read.
  const quoteOpacities = await library
    .locator('.timeline-entry .quote')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
  expect(new Set(quoteOpacities)).toEqual(new Set(['1']));
});

test('E48: timeline cards never paint beneath the navigation rail', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seedHistory(context, []);
  const library = await openTimeline(context, extensionId);
  await library.emulateMedia({ reducedMotion: 'reduce' });
  await library.setViewportSize({ width: 900, height: 720 });
  await backdate(library, HISTORY_OFFSETS);

  await library.locator('.timeline-entry').first().evaluate((card) => {
    const title = card.querySelector('.page-title-inline');
    const quote = card.querySelector('.quote');
    if (!title || !quote) throw new Error('timeline fixture card is incomplete');
    title.textContent = 'A very long publisher article title '.repeat(30);
    quote.textContent = 'publisheraccessibleimagedescription'.repeat(30);
  });
  const rail = await library.locator('.tl-rail').boundingBox();
  const cardRights = await library
    .locator('.timeline-entry')
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().right));
  expect(rail).not.toBeNull();
  expect(Math.max(...cardRights)).toBeLessThanOrEqual((rail?.x ?? 0) - 1);
  expect(await library.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await library.evaluate(() => innerWidth),
  );

  await library.setViewportSize({ width: 720, height: 720 });
  await expect(library.locator('.tl-rail')).toBeHidden();
  expect(await library.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await library.evaluate(() => innerWidth),
  );
});

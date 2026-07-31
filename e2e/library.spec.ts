import type { Page } from '@playwright/test';
import { BASE_URL, clickText, expect, highlight, test } from './extension';

const NESTED = `${BASE_URL}/fixtures/nested.html`;
const DEMO = `${BASE_URL}/fixtures/demo.html`;
const REPEATED = `${BASE_URL}/fixtures/repeated.html`;

async function openLibrary(page: Page, extensionId: string): Promise<Page> {
  const library = await page.context().newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  await library.locator('.library-header').waitFor();
  return library;
}

/** Annotate three pages so grouping, sites and search all have something to work on. */
async function seedAnnotations(context: import('@playwright/test').BrowserContext) {
  const page = await context.newPage();

  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker');
  await clickText(page, '#probe-2', 'footnote marker');
  await page.locator('[data-locus-note] textarea').fill('**seeded note** for search');
  await page.locator('[data-locus-note-save]').click();

  await page.goto(DEMO);
  await highlight(page, '#probe-2', 'scoping', 'teal');

  await page.goto(REPEATED);
  await highlight(page, '#occurrence-1 p', 'powerhouse', 'pink');

  await page.close();
}

test('E32: library lists annotations from every page and switches grouping', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seedAnnotations(context);
  const library = await openLibrary(await context.newPage(), extensionId);

  // By page (default): one card per annotated page.
  await expect(library.locator('.page-card')).toHaveCount(3);
  await expect(library.locator('.annotation')).toHaveCount(3);
  await expect(library.locator('.subtitle')).toContainText('3 of 3');

  // By site: all three fixtures share one origin, so they collapse into one group.
  await library.locator('.segmented button[data-mode="site"]').click();
  await expect(library.locator('.site-group')).toHaveCount(1);
  await expect(library.locator('.site-group .page-card')).toHaveCount(3);

  // Timeline: same three annotations, flattened.
  await library.locator('.segmented button[data-mode="timeline"]').click();
  await expect(library.locator('.timeline-entry')).toHaveCount(3);
  await expect(library.locator('.timeline-day')).toHaveCount(1);

  // The selected projection is a preference, not a per-tab transient.
  await library.close();
  const reopened = await openLibrary(await context.newPage(), extensionId);
  await expect(reopened.locator('button[data-mode="timeline"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(reopened.locator('.timeline-entry')).toHaveCount(3);
});

test('E33: search and filters narrow the library', async ({ context, serviceWorker, extensionId }) => {
  await seedAnnotations(context);
  const library = await openLibrary(await context.newPage(), extensionId);

  // Search matches note text.
  await library.locator('[data-library="search"]').fill('seeded note');
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(library.locator('.note.note-plain mark')).toHaveText('seeded note');

  // Search matches quoted text too.
  await library.locator('[data-library="search"]').fill('powerhouse');
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(library.locator('.annotation .quote mark')).toHaveText('powerhouse');

  // Timeline keeps title-only matches visible and marks the actual hit.
  await library.locator('[data-library="search"]').fill('repeated text');
  await library.locator('.segmented button[data-mode="timeline"]').click();
  await expect(library.locator('.timeline-entry')).toHaveCount(1);
  await expect(library.locator('.page-title-inline mark')).toHaveText('repeated text');

  // A miss shows the filtered-empty state, not a blank page.
  await library.locator('[data-library="search"]').fill('zzz-not-present');
  await expect(library.locator('[data-empty="filtered"]')).toBeVisible();

  await library.locator('[data-filter="clear"]').click();
  await expect(library.locator('.annotation')).toHaveCount(3);

  // Colour filter.
  await library.locator('[data-filter-color="teal"]').click();
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(library.locator('.annotation')).toHaveAttribute('data-color', 'teal');
  await library.locator('[data-filter="clear"]').click();
  await expect(library.locator('.annotation')).toHaveCount(3);
});

test('E34: clicking an annotation opens a page that was never open and scrolls to it', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seedAnnotations(context);
  // Every fixture tab is closed at this point — the reveal has to create one
  // and wait for its content script, which is the path that fails silently if
  // the message is simply fired at a fresh tab.
  const library = await openLibrary(await context.newPage(), extensionId);

  await library.locator('[data-library="search"]').fill('powerhouse');
  await expect(library.locator('.annotation')).toHaveCount(1);

  const [opened] = await Promise.all([
    context.waitForEvent('page'),
    library.locator('.annotation .quote').click(),
  ]);
  await opened.waitForLoadState();
  expect(opened.url()).toContain('repeated.html');
  await expect(opened.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  // The reveal pulses the highlight once the content script is up.
  await expect(opened.locator('#locus-host .pulse').first()).toBeVisible({ timeout: 10_000 });
  await expect(library.locator('.row-status')).toHaveCount(0);
});

test('E35: editing, deleting and restoring from the library', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-4', 'Quotation blocks');
  const library = await openLibrary(await context.newPage(), extensionId);
  await expect(library.locator('.annotation')).toHaveCount(1);

  // Edit the note here; the page picks the change up live.
  await library.locator('button[data-action="edit"]').click();
  await library.locator('.note-editor textarea').fill('written **from the library**');
  await library.locator('.note-editor button.primary').click();
  await expect(library.locator('.note strong')).toHaveText('from the library');

  // Delete → gone from the default view, still on the page's tombstone row.
  await library.locator('button[data-action="delete"]').click();
  await expect(library.locator('.annotation')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '0');

  // The bin shows it, and restore brings it back everywhere.
  await library.locator('[data-filter="deleted"]').click();
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(library.locator('.deleted-badge')).toBeVisible();
  await library.locator('button[data-action="restore"]').click();
  await expect(library.locator('.annotation')).toHaveCount(0); // no longer deleted
  await library.locator('[data-filter="deleted"]').click();
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
});

test('E36: detached annotations are surfaced and filterable', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  const dynamic = `${BASE_URL}/fixtures/dynamic.html`;
  await page.goto(dynamic);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-hydrated', '1');
  await highlight(page, '#target-holder-v2', 'stable wording');

  // Reload with the paragraph removed: the annotation cannot re-anchor, and the
  // content script reports that so the library can show it without running there.
  await page.goto(`${dynamic}#remove-target`);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '1');

  const library = await openLibrary(await context.newPage(), extensionId);
  await expect(library.locator('.detached-badge')).toBeVisible();
  await library.locator('[data-filter="detached"]').click();
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(library.locator('.annotation')).toHaveClass(/detached/);
});

test('E39: page cards cap at five annotations and pack without row gaps', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seedAnnotations(context);
  const page = await context.newPage();

  // The nested fixture already has "footnote marker" from seedAnnotations.
  // Add five more entries so its card is substantially taller than its peers.
  await page.goto(NESTED);
  await highlight(page, '#probe-1', 'Deeply nested inline structure');
  await highlight(page, '#probe-2', 'paragraph contains');
  await highlight(page, '#probe-2', 'emphasized');
  await highlight(page, '#probe-2', 'strongly');
  await highlight(page, '#probe-3', 'triple-wrapped');

  // A fourth, short card makes the old equal-row Grid leave a measurable hole.
  await page.goto(`${DEMO}?paper=compact-secondary`);
  await highlight(page, '#probe-3', 'retrospective');
  await page.close();

  const library = await openLibrary(await context.newPage(), extensionId);
  await library.setViewportSize({ width: 1100, height: 900 });
  const nestedCard = library
    .locator('.page-card')
    .filter({ has: library.locator('.page-title', { hasText: 'Fixture: nested text nodes' }) });

  await expect(nestedCard.locator('.count')).toContainText('6 annotations');
  await expect(nestedCard.locator('.annotation')).toHaveCount(5);
  await expect(nestedCard.locator('.annotation-overflow')).toHaveAttribute(
    'data-hidden-count',
    '1',
  );
  await expect(nestedCard.locator('.quote', { hasText: 'triple-wrapped' })).toHaveCount(0);

  // Overflow remains available on demand.
  await nestedCard.locator('[data-action="toggle-annotations"]').click();
  await expect(nestedCard.locator('.annotation')).toHaveCount(6);

  // Search happens before truncation, so the sixth entry is never unreachable.
  await library.locator('[data-library="search"]').fill('triple-wrapped');
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(library.locator('.annotation .quote')).toContainText('triple-wrapped');
  await expect(library.locator('.annotation-overflow')).toHaveCount(0);
  await library.locator('[data-library="search"]').fill('');
  // Changing the result set restores the default compact state.
  await expect(nestedCard.locator('.annotation')).toHaveCount(5);

  const layout = await library.locator('.page-card').evaluateAll((cards) => {
    const rects = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        fragments: card.getClientRects().length,
      };
    });
    const columns = new Map<number, typeof rects>();
    for (const rect of rects) {
      const column = columns.get(rect.left) ?? [];
      column.push(rect);
      columns.set(rect.left, column);
    }
    const gaps: number[] = [];
    for (const column of columns.values()) {
      column.sort((a, b) => a.top - b.top);
      for (let index = 1; index < column.length; index += 1) {
        gaps.push(column[index]!.top - column[index - 1]!.bottom);
      }
    }
    return {
      columnCount: columns.size,
      gaps,
      heights: rects.map((rect) => rect.height),
      fragments: rects.map((rect) => rect.fragments),
    };
  });

  expect(layout.columnCount).toBeGreaterThanOrEqual(2);
  expect(layout.gaps.length).toBeGreaterThan(0);
  expect(Math.max(...layout.gaps)).toBeLessThanOrEqual(24);
  expect(Math.max(...layout.heights) - Math.min(...layout.heights)).toBeGreaterThan(80);
  expect(layout.fragments.every((count) => count === 1)).toBe(true);
});

test('E40: deleting the last live annotation removes its stale site filter', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker');
  await page.goto(`http://127.0.0.1:8137/fixtures/demo.html`);
  await highlight(page, '#probe-2', 'scoping');
  await page.close();

  const library = await openLibrary(await context.newPage(), extensionId);
  await expect(library.locator('[data-filter-origin="localhost"]')).toContainText('localhost');
  await expect(library.locator('[data-filter-origin="127.0.0.1"]')).toContainText('127.0.0.1');

  await library.locator('[data-filter-origin="localhost"]').click();
  await expect(library.locator('.annotation')).toHaveCount(1);
  await library.locator('button[data-action="delete"]').click();

  // The deleted family's chip and its selected filter both disappear. The
  // remaining live site is shown instead of leaving a hidden stale filter.
  await expect(library.locator('[data-filter-origin="localhost"]')).toHaveCount(0);
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(library.locator('.subtitle')).toContainText('1 of 1');

  // The bin uses its own site universe and count.
  await library.locator('[data-filter="deleted"]').click();
  await expect(library.locator('.annotation')).toHaveCount(1);
  await expect(library.locator('.subtitle')).toContainText('1 of 1');
});

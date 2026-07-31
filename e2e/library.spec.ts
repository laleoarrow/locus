import type { Page } from '@playwright/test';
import { BASE_URL, clickText, expect, highlight, selectText, test } from './extension';

const NESTED = `${BASE_URL}/fixtures/nested.html`;
const DEMO = `${BASE_URL}/fixtures/demo.html`;
const REPEATED = `${BASE_URL}/fixtures/repeated.html`;
const BLUE_KEY = 'c4a90e2';

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

test('E42: bulk color replacement is global, filter-safe, and persistent', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-1', 'Deeply nested inline structure');
  await highlight(page, '#probe-2', 'footnote marker');
  await page.goto(DEMO);
  await highlight(page, '#probe-2', 'scoping');

  // A pre-existing blue target and another yellow source live outside the
  // filters used below. This distinguishes a real whole-library update from
  // an incorrect implementation that only changes visible cards.
  await page.goto(`http://127.0.0.1:8137/fixtures/repeated.html`);
  await selectText(page, '#occurrence-1 p', 'powerhouse');
  await page.evaluate(() => {
    const input = document
      .getElementById('locus-host')
      ?.shadowRoot?.querySelector<HTMLInputElement>('input[type="color"]');
    if (!input) throw new Error('no Locus color input');
    input.value = '#4a90e2';
    input.dispatchEvent(new Event('change'));
  });
  await page.locator(`[data-locus-toolbar] .swatch[data-color="${BLUE_KEY}"]`).click();
  await highlight(page, '#occurrence-2 p', 'powerhouse', 'yellow');

  // A yellow tombstone must not be included in the source count or rewritten.
  await page.goto(`${DEMO}?paper=deleted-yellow`);
  await highlight(page, '#probe-3', 'retrospective');
  await page.close();

  const observedPage = await context.newPage();
  await observedPage.goto(NESTED);
  await expect(observedPage.locator('html')).toHaveAttribute('data-locus-anchored', '2');

  const library = await openLibrary(await context.newPage(), extensionId);
  await library.locator('[data-library="search"]').fill('retrospective');
  await library.locator('button[data-action="delete"]').click();
  await library.locator('[data-filter="clear"]').click();

  await library.locator('[data-filter-color="yellow"]').click();
  await library.locator('[data-filter-origin="localhost"]').click();
  const today = await library.evaluate(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
  await library.locator('[data-filter="from"]').fill(today);
  await expect(library.locator('.annotation')).toHaveCount(3);

  await library.locator('[data-bulk-action="menu"]').click();
  await library.locator('[data-bulk-action="replace-color"]').click();
  const source = library.locator('[data-bulk-color="source"]');
  const target = library.locator('[data-bulk-color="target"]');
  const confirm = library.locator('[data-bulk-color="confirm"]');
  await target.selectOption(BLUE_KEY);
  await expect(library.locator('[data-bulk-color="summary"]')).toContainText(
    '4 live Yellow annotations will change to #4a90e2',
  );

  // Invalid choices remain previewable but cannot be confirmed.
  await target.selectOption('yellow');
  await expect(confirm).toBeDisabled();
  await expect(library.locator('[data-bulk-color="summary"]')).toContainText(
    'Choose a different target colour',
  );
  await source.selectOption('pink');
  await target.selectOption(BLUE_KEY);
  await expect(confirm).toBeDisabled();
  await expect(library.locator('[data-bulk-color="summary"]')).toContainText(
    'no live Pink annotations',
  );

  await source.selectOption('yellow');
  await target.selectOption(BLUE_KEY);

  // Hold the background round-trip open long enough to exercise the real
  // pending state. The shield must live under <body>: the sticky header uses
  // backdrop-filter, which otherwise turns a fixed descendant into a
  // header-sized containing block and leaves the cards interactive.
  await library.evaluate(() => {
    const runtime = chrome.runtime;
    const original = runtime.sendMessage.bind(runtime);
    Object.defineProperty(runtime, 'sendMessage', {
      configurable: true,
      value: (message: unknown) => {
        if ((message as { type?: string })?.type !== 'annotations:replace-color') {
          return original(message);
        }
        return new Promise((resolve, reject) => {
          window.setTimeout(() => {
            void original(message).then(resolve, reject);
          }, 1_800);
        });
      },
    });
  });
  await confirm.click();

  const dialog = library.locator('#bulk-colour-dialog');
  const shield = library.locator('body > .bulk-operation-shield');
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(shield).toBeVisible();
  const shieldCoverage = await shield.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      parentIsBody: element.parentElement === document.body,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(shieldCoverage).toMatchObject({ parentIsBody: true, left: 0, top: 0 });
  expect(shieldCoverage.width).toBe(shieldCoverage.viewportWidth);
  expect(shieldCoverage.height).toBe(shieldCoverage.viewportHeight);

  // Real Playwright clicks must fail actionability while pending. This covers
  // destructive Delete, Add note, and the quote control that opens the page.
  for (const action of [
    library.locator('button[data-action="delete"]').first(),
    library.locator('button[data-action="edit"]').first(),
    library.locator('button.quote').first(),
  ]) {
    let blocked = false;
    try {
      await action.click({ timeout: 200 });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  }
  await expect(library.locator('.note-editor')).toHaveCount(0);
  await expect(library.locator('.annotation')).toHaveCount(3);

  // Keyboard focus is trapped on the busy dialog and cannot tab into cards.
  await expect(dialog).toBeFocused();
  await library.keyboard.press('Tab');
  await expect(dialog).toBeFocused();
  await library.keyboard.press('Shift+Tab');
  await expect(dialog).toBeFocused();
  await expect(shield).toHaveCount(0, { timeout: 5_000 });

  // Only the color dimension moves. Site and date filters stay intact, so the
  // same three records remain visible instead of the page looking empty.
  await expect(library.locator(`[data-filter-color="${BLUE_KEY}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(library.locator('[data-filter-color="yellow"]')).toHaveCount(0);
  await expect(library.locator('[data-filter-origin="localhost"]')).toHaveClass(/on/);
  await expect(library.locator('[data-filter="from"]')).toHaveValue(today);
  await expect(library.locator('.annotation')).toHaveCount(3);
  await expect(library.locator(`.annotation[data-color="${BLUE_KEY}"]`)).toHaveCount(3);
  await expect(library.locator('.subtitle')).toContainText('3 of 5');

  // An already-open article receives the normal annotation broadcast and
  // repaints both of its ranges without a reload.
  await expect
    .poll(() =>
      observedPage.evaluate(() => {
        const highlight = CSS.highlights.get('locus-yellow');
        return highlight ? [...(highlight as unknown as Iterable<Range>)].length : 0;
      }),
    )
    .toBe(0);
  await expect
    .poll(() =>
      observedPage.evaluate((key) => {
        const highlight = CSS.highlights.get(`locus-${key}`);
        return highlight ? [...(highlight as unknown as Iterable<Range>)].length : 0;
      }, BLUE_KEY),
    )
    .toBe(2);

  // The same broadcast refreshes the inferred page palette in an already-open
  // content script. A new selection therefore offers the custom blue now used
  // by this page, without requiring a reload or a global custom-color setting.
  await selectText(observedPage, '#probe-3', 'second paragraph');
  await expect(
    observedPage.locator(`[data-locus-toolbar] .swatch[data-color="${BLUE_KEY}"]`),
  ).toBeVisible();

  // A fresh Library load reads the committed IndexedDB rows, not component
  // memory. All five live rows are blue; the yellow tombstone is unchanged.
  await library.reload();
  await expect(library.locator(`.annotation[data-color="${BLUE_KEY}"]`)).toHaveCount(5);
  await expect(library.locator('.subtitle')).toContainText('5 of 5');

  // Reopening the popover proves its global counts refreshed after commit.
  await library.locator('[data-bulk-action="menu"]').click();
  await library.locator('[data-bulk-action="replace-color"]').click();
  await library.locator('[data-bulk-color="source"]').selectOption('yellow');
  await library.locator('[data-bulk-color="target"]').selectOption(BLUE_KEY);
  await expect(library.locator('[data-bulk-color="summary"]')).toContainText(
    'no live Yellow annotations',
  );
  await expect(library.locator('[data-bulk-color="confirm"]')).toBeDisabled();
  await library.getByRole('button', { name: 'Cancel' }).click();

  await library.locator('[data-filter="deleted"]').click();
  await expect(library.locator('.annotation[data-color="yellow"]')).toHaveCount(1);
  await expect(library.locator('.deleted-badge')).toBeVisible();
});

test('E43: a sync failure never leaves a partial local color replacement', async ({
  context,
  serviceWorker,
  extensionId,
  request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-1', 'Deeply nested inline structure');
  await highlight(page, '#probe-2', 'footnote marker');
  await page.close();

  const library = await openLibrary(await context.newPage(), extensionId);
  await library.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'sync:save',
      patch: {
        enabled: true,
        url: 'http://localhost:8137/dav/bulk-failure/',
        username: 'tester',
        password: 'wrong-password',
      },
    }),
  );

  await library.locator('[data-bulk-action="menu"]').click();
  await library.locator('[data-bulk-action="replace-color"]').click();
  await expect(library.locator('[data-bulk-color="summary"]')).toContainText(
    '2 live Yellow annotations will change to Teal',
  );
  await library.locator('[data-bulk-color="confirm"]').click();
  await expect(library.locator('.annotation[data-color="teal"]')).toHaveCount(2);

  const sync = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
  expect(sync.result.ok).toBe(false);
  expect(sync.result.pushed).toBe(false);
  expect(sync.result.error).toContain('app password');
  const colors = await library.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('locus');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const get = database.transaction('annotations').objectStore('annotations').getAll();
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            database.close();
            resolve(
              (get.result as { color: string; deletedAt: number }[])
                .filter((row) => row.deletedAt === 0)
                .map((row) => row.color)
                .sort(),
            );
          };
        };
      }),
  );
  expect(colors).toEqual(['teal', 'teal']);

  // Fixing the connection retries the complete local batch. The remote file
  // receives both rows together, never a half-recolored intermediate state.
  await library.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'sync:save',
      patch: { password: 'app-password' },
    }),
  );
  const retried = await library.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'sync:now' }),
  );
  expect(retried.result.ok).toBe(true);
  expect(retried.result.pushed).toBe(true);
  const authorization = `Basic ${Buffer.from('tester:app-password').toString('base64')}`;
  const remote = await request.get(
    `${BASE_URL}/dav/bulk-failure/locus-library.json`,
    { headers: { authorization } },
  );
  expect(remote.ok()).toBe(true);
  const backup = (await remote.json()) as {
    annotations: { color: string; deletedAt: number }[];
  };
  expect(
    backup.annotations
      .filter((row) => row.deletedAt === 0)
      .map((row) => row.color)
      .sort(),
  ).toEqual(['teal', 'teal']);

  // Stall exactly one valid PUT for longer than the four-second sync debounce.
  // Its body is captured by the mock before `active` becomes true, so this
  // first pass is guaranteed to contain the old teal rows.
  const armed = await request.get(`${BASE_URL}/__dav-delay-next-put?ms=6500`);
  expect(armed.ok()).toBe(true);
  await library.evaluate(() => {
    void chrome.runtime.sendMessage({ type: 'sync:now' });
  });
  await expect
    .poll(async () => {
      const status = await request.get(`${BASE_URL}/__dav-delay-status`);
      return status.json() as Promise<{ armed: boolean; active: boolean }>;
    })
    .toMatchObject({ armed: false, active: true });

  // Recolour while the PUT is still active. The debounced sync request fires
  // before the stalled pass finishes and must queue one follow-up pass rather
  // than returning "Already syncing" and losing the remote update.
  await library.locator('[data-bulk-action="menu"]').click();
  await library.locator('[data-bulk-action="replace-color"]').click();
  await library.locator('[data-bulk-color="source"]').selectOption('teal');
  await library.locator('[data-bulk-color="target"]').selectOption('pink');
  await expect(library.locator('[data-bulk-color="summary"]')).toContainText(
    '2 live Teal annotations will change to Pink',
  );
  await library.locator('[data-bulk-color="confirm"]').click();
  await expect(library.locator('.annotation[data-color="pink"]')).toHaveCount(2);

  // The first delayed PUT can only write teal. Seeing pink remotely therefore
  // proves the queued follow-up completed with the entire recoloured batch.
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${BASE_URL}/dav/bulk-failure/locus-library.json`,
          { headers: { authorization } },
        );
        if (!response.ok()) return [];
        const current = (await response.json()) as {
          annotations: { color: string; deletedAt: number }[];
        };
        return current.annotations
          .filter((row) => row.deletedAt === 0)
          .map((row) => row.color)
          .sort();
      },
      { timeout: 20_000 },
    )
    .toEqual(['pink', 'pink']);
});

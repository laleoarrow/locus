import { BASE_URL, expect, highlight, test } from './extension';

test('E95: unrelated updates on a long article do not rebuild healthy highlights', async ({ context, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    await chrome.alarms.clear('locus-update-check');
    const scope = globalThis as unknown as { auditAnchorMessages: number };
    scope.auditAnchorMessages = 0;
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'anchor-state:changed' || message.type === 'anchor-state:report') scope.auditAnchorMessages++;
    });
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/fixtures/audit.html`);
  await page.evaluate(() => {
    const content = document.createElement('section');
    content.innerHTML = Array.from({ length: 1_000 }, (_, i) => `<p>Long article paragraph ${i}.</p>`).join('');
    document.body.append(content);
    const ticker = document.createElement('aside');
    ticker.id = 'audit-ticker';
    ticker.textContent = '0';
    document.body.append(ticker);
  });
  await highlight(page, '#claim', 'preserves uncertainty');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.waitForTimeout(650);
  const messages = await serviceWorker.evaluate(() =>
    (globalThis as unknown as { auditAnchorMessages: number }).auditAnchorMessages);
  expect(messages).toBeGreaterThanOrEqual(2); // The first state is still reported.
  const rebuilds = await page.evaluate(async () => {
    let count = 0;
    const observer = new MutationObserver((records) => { count += records.length; });
    // anchorAll writes these attributes whenever it rebuilds, even if the
    // number of resolved highlights has not changed.
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-locus-anchored'] });
    for (let i = 1; i <= 30; i++) {
      document.getElementById('audit-ticker')!.textContent = String(i);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    observer.disconnect();
    return count;
  });
  expect(rebuilds).toBe(0);
  expect(await serviceWorker.evaluate(() =>
    (globalThis as unknown as { auditAnchorMessages: number }).auditAnchorMessages)).toBe(messages);
  await page.locator('#claim').evaluate((paragraph) => { paragraph.textContent = 'The excerpt was temporarily removed.'; });
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '1');
  await page.locator('#claim').evaluate((paragraph) => { paragraph.innerHTML = 'The reading layer preserves <strong>uncertainty</strong> after a real article update.'; });
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '0');
  // Re-enabling must notify a panel opened while the site was dormant even
  // when its restored annotation states equal the last active snapshot.
  const settings = await context.newPage();
  await settings.goto(await serviceWorker.evaluate(() => chrome.runtime.getURL('library.html')));
  await settings.evaluate((origin) => chrome.runtime.sendMessage({ type: 'prefs:toggle-site', origin, disabled: true }), new URL(BASE_URL).origin);
  await expect(page.locator('html')).toHaveAttribute('data-locus-disabled', '1');
  const dormantMessages = await serviceWorker.evaluate(() =>
    (globalThis as unknown as { auditAnchorMessages: number }).auditAnchorMessages);
  await settings.evaluate((origin) => chrome.runtime.sendMessage({ type: 'prefs:toggle-site', origin, disabled: false }), new URL(BASE_URL).origin);
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect.poll(() => serviceWorker.evaluate(() =>
    (globalThis as unknown as { auditAnchorMessages: number }).auditAnchorMessages)).toBeGreaterThan(dormantMessages);

});

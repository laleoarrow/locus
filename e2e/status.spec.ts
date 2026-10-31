import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { BASE_URL, expect, highlight, test } from './extension';
import { davState, readRemoteLibrary } from './sync-remote';

const STATUS_DIALOG = 'Connection status · 连接状态';
const TEST_KEY = 'status-fixture-key-never-display';
const PRIVATE_NOTE = 'PRIVATE_USER_NOTE_NOT_FOR_CONNECTION_TEST';
const DAV_PASSWORD = 'app-password';

async function openLibrary(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(page.locator('[data-status="llm"]')).toBeEnabled();
  return page;
}

async function secondWindow(context: BrowserContext, from: Page): Promise<Page> {
  const [page] = await Promise.all([
    context.waitForEvent('page'),
    from.evaluate(() => chrome.windows.create({ url: chrome.runtime.getURL('library.html'), type: 'normal' })),
  ]);
  await expect(page.locator('[data-status="llm"]')).toBeEnabled();
  return page;
}

async function openStatus(page: Page, service: 'llm' | 'sync') {
  await page.locator(`[data-status="${service}"]`).click();
  const dialog = page.getByRole('dialog', { name: STATUS_DIALOG });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function saveLLM(page: Page, token: string, mode: 'success' | 'unauthorized' | 'hold' = 'success') {
  const result = await page.evaluate((config) => chrome.runtime.sendMessage({
    type: 'llm:save',
    patch: { enabled: true, baseUrl: config.url, model: 'fixture-model', apiKey: config.key },
  }), { url: `${BASE_URL}/__llm/${token}/${mode}`, key: TEST_KEY });
  expect(result.error).toBeUndefined();
  return result;
}

async function llmRequests(request: APIRequestContext, token: string) {
  return (await request.get(`${BASE_URL}/__llm/${token}/requests`)).json();
}

test('E62: LLM status distinguishes configuration from verification and refreshes other windows', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const article = await context.newPage();
  await article.goto(`${BASE_URL}/fixtures/nested.html`);
  await highlight(article, '#probe-2', 'footnote marker');
  const library = await openLibrary(context, extensionId);
  const annotationId = await library.locator('.annotation').getAttribute('data-annotation-id');
  await library.evaluate(({ id, comment }) => chrome.runtime.sendMessage({
    type: 'annotation:set-comment', id, comment,
  }), { id: annotationId, comment: PRIVATE_NOTE });
  const other = await secondWindow(context, library);
  await expect(library.locator('[data-status="llm"]')).toContainText(/未配置|已关闭/);

  const saved = await saveLLM(other, token);
  expect(saved.connection).toMatchObject({ status: 'untested', checkedAt: 0, error: '' });
  await expect(library.locator('[data-status="llm"]')).toContainText('待验证');
  expect((await llmRequests(request, token)).requests).toHaveLength(0);
  const dialog = await openStatus(library, 'llm');
  const section = dialog.locator('[data-status-section="llm"]');
  await expect(section).toContainText(/待验证|未测试|尚未检查|尚未验证/);
  await expect(dialog.locator('[data-status-action="llm-settings"]')).toBeVisible();
  await dialog.locator('[data-status-test="llm"]').click();
  await expect(section).toContainText(/连接成功|验证成功|已连接|已验证/);
  await expect(other.locator('[data-status="llm"]')).toContainText(/成功|已连接|已验证/);
  const verified = await other.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
  expect(verified.connection.status).toBe('success');
  expect(verified.connection.checkedAt).toBeGreaterThan(0);
  const calls = (await llmRequests(request, token)).requests;
  expect(calls).toHaveLength(1);
  expect(calls[0].authorizationPresent).toBe(true);
  expect(JSON.stringify(calls)).not.toContain(PRIVATE_NOTE);
  expect(JSON.stringify(calls)).not.toContain('footnote marker');
  expect(JSON.stringify(calls)).not.toContain(TEST_KEY);

  // Changing the endpoint invalidates the old green status in both windows.
  await saveLLM(other, token, 'unauthorized');
  await expect(section).toContainText(/待验证|未测试|尚未检查|尚未验证/);
  await expect(other.locator('[data-status="llm"]')).toContainText('待验证');
  await dialog.locator('[data-status-test="llm"]').click();
  await expect(section).toContainText(/失败|错误/);
  await expect(section).toContainText(/授权|API key|401/);
  await expect(other.locator('[data-status="llm"]')).toContainText(/失败|错误/);
  await expect(dialog).not.toContainText(TEST_KEY);
  await expect(dialog).not.toContainText('PRIVATE_PROVIDER_DETAIL');
  const failed = await other.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
  expect(failed.connection.status).toBe('error');
  expect(JSON.stringify(failed)).not.toContain(TEST_KEY);
  expect(JSON.stringify(failed)).not.toContain('PRIVATE_PROVIDER_DETAIL');

  await other.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:save', patch: { model: 'replacement-model' } }));
  await expect(section).toContainText(/待验证|未测试|尚未检查|尚未验证/);
  const changed = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
  expect(changed.connection).toMatchObject({ status: 'untested', checkedAt: 0, error: '' });
});

test('E63: WebDAV connection tests are separate from actual sync and configuration changes clear old success', async ({
  context, serviceWorker, extensionId, request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const token = randomUUID();
  const library = await openLibrary(context, extensionId);
  const other = await secondWindow(context, library);
  const configured = await other.evaluate((url) => chrome.runtime.sendMessage({
    type: 'sync:save', patch: { enabled: false, url, username: 'tester', password: 'app-password' },
  }), `${BASE_URL}/dav/${token}/`);
  expect(configured.connection).toMatchObject({ status: 'untested', checkedAt: 0 });
  expect(configured.state.lastSyncAt).toBe(0);
  const dialog = await openStatus(library, 'sync');
  const section = dialog.locator('[data-status-section="sync"]');
  await expect(section).toContainText(/待验证|未测试|尚未检查|尚未验证/);
  await expect(dialog.locator('[data-status-action="sync-settings"]')).toBeVisible();
  await dialog.locator('[data-status-test="sync"]').click();
  await expect(section).toContainText(/连接成功|验证成功|已连接|已验证/);
  const tested = await other.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:status' }));
  expect(tested.connection.status).toBe('success');
  expect(tested.state.lastSyncAt).toBe(0);
  await expect(dialog.locator('[data-status-sync="last-sync"]')).toContainText(/尚未|未同步|暂无/);
  expect(JSON.stringify(tested)).not.toContain(DAV_PASSWORD);

  await other.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:save', patch: { enabled: true } }));
  const synchronized = await other.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:now' }));
  expect(synchronized.result.ok).toBe(true);
  expect(synchronized.state.lastSyncAt).toBeGreaterThan(0);
  await expect(dialog.locator('[data-status-sync="last-sync"]')).not.toContainText(/尚未|未同步|暂无/);
  await expect(other.locator('[data-status="sync"]')).toContainText(/成功|已同步|已连接|已验证/);

  // New destination and credentials must never retain the previous test or
  // last successful synchronization, even though that old server still exists.
  const changed = await other.evaluate((url) => chrome.runtime.sendMessage({
    type: 'sync:save', patch: { enabled: false, url, password: 'fixture-wrong-password' },
  }), `${BASE_URL}/dav/${token}-changed/`);
  expect(changed.connection).toMatchObject({ status: 'untested', checkedAt: 0, error: '' });
  expect(changed.state).toMatchObject({ lastSyncAt: 0, lastError: '', etag: '' });
  await expect(section).toContainText(/待验证|未测试|尚未检查|尚未验证/);
  await expect(dialog.locator('[data-status-sync="last-sync"]')).toContainText(/尚未|未同步|暂无/);
  await dialog.locator('[data-status-test="sync"]').click();
  await expect(section).toContainText(/失败|错误/);
  await expect(dialog).not.toContainText('fixture-wrong-password');
  const rejected = await other.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:status' }));
  expect(rejected.connection.status).toBe('error');
  expect(rejected.state.lastSyncAt).toBe(0);
  expect(JSON.stringify(rejected)).not.toContain('fixture-wrong-password');
});

test('E64: an in-flight LLM connection result cannot validate a newer configuration', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const library = await openLibrary(context, extensionId);
  const other = await secondWindow(context, library);
  await saveLLM(other, token, 'hold');
  const dialog = await openStatus(library, 'llm');
  await dialog.locator('[data-status-test="llm"]').click();
  await expect.poll(async () => (await llmRequests(request, token)).pending).toBe(1);
  await expect(other.locator('[data-status="llm"]')).toContainText('检查中');
  await other.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:save', patch: { model: 'new-model-during-test' } }));
  await expect(other.locator('[data-status="llm"]')).toContainText('待验证');
  await request.post(`${BASE_URL}/__llm/${token}/release`);
  await expect(dialog.locator('[data-status-test="llm"]')).toBeEnabled();
  const current = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
  expect(current.config.model).toBe('new-model-during-test');
  expect(current.connection).toMatchObject({ status: 'untested', checkedAt: 0, error: '' });
  await expect(dialog.locator('[data-status-section="llm"]')).toContainText(/待验证|未测试|尚未检查|尚未验证/);
});

test('E65: an old WebDAV settings form cannot overwrite another window and missing replies remain visible', async ({
  context, serviceWorker, extensionId,
}) => {
  const token = randomUUID();
  const library = await openLibrary(context, extensionId);
  const other = await secondWindow(context, library);
  const firstUrl = `${BASE_URL}/dav/${token}-first/`;
  const newerUrl = `${BASE_URL}/dav/${token}-newer/`;
  await other.evaluate((url) => chrome.runtime.sendMessage({
    type: 'sync:save', patch: { enabled: false, url, username: 'first-user', password: 'fixture-first-password' },
  }), firstUrl);
  const dialog = await openStatus(library, 'sync');
  await dialog.locator('[data-status-action="sync-settings"]').click();
  const form = dialog.locator('.connection-sync-form');
  await expect(form.locator('[data-status-sync="url"]')).toHaveValue(firstUrl);
  await expect(form.locator('[data-status-sync="password"]')).toHaveValue('');
  await form.locator('[data-status-sync="username"]').fill('edited-in-old-form');

  await other.evaluate((url) => chrome.runtime.sendMessage({
    type: 'sync:save', patch: { enabled: false, url, username: 'newer-user', password: 'fixture-newer-password' },
  }), newerUrl);
  // Let the live status refresh arrive before submitting the old input values.
  await expect(dialog.locator('[data-status-section="sync"] .connection-detail')).toContainText(newerUrl);
  await form.locator('[data-status-sync="save"]').click();
  await expect(form.getByRole('alert')).toContainText(/改变|变更|已更新|changed/i);
  await expect(form).toBeVisible();
  await expect(form.locator('[data-status-sync="username"]')).toHaveValue('edited-in-old-form');
  const current = await other.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:status' }));
  expect(current.config).toMatchObject({ url: newerUrl, username: 'newer-user', hasPassword: true });
  expect(await other.evaluate(async () => {
    const saved = await chrome.storage.local.get('sync.config');
    const config = saved['sync.config'] as { password?: string } | undefined;
    return config?.password === 'fixture-newer-password';
  })).toBe(true);

  // Reopening captures the latest revision; a disconnected runtime must show
  // a save error rather than close the form as though it succeeded.
  await dialog.locator('[data-status-action="sync-settings"]').click();
  await expect(form).toHaveCount(0);
  await dialog.locator('[data-status-action="sync-settings"]').click();
  await expect(form.locator('[data-status-sync="url"]')).toHaveValue(newerUrl);
  await library.evaluate(() => {
    const runtime = chrome.runtime;
    const original = runtime.sendMessage.bind(runtime);
    Object.defineProperty(runtime, 'sendMessage', {
      configurable: true,
      value: (message: unknown) => (message as { type?: string })?.type === 'sync:save'
        ? Promise.resolve(undefined) : original(message),
    });
  });
  await form.locator('[data-status-sync="username"]').fill('must-not-save');
  await form.locator('[data-status-sync="save"]').click();
  await expect(form.getByRole('alert')).toContainText('无法保存');
  await expect(form).toBeVisible();
  const unchanged = await other.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:status' }));
  expect(unchanged.config).toMatchObject({ url: newerUrl, username: 'newer-user', hasPassword: true });
});

test('E71: status explanations use structured hover and keyboard tooltips without dismissing the dialog', async ({
  context, serviceWorker, extensionId, request,
}, testInfo) => {
  const token = randomUUID();
  const library = await openLibrary(context, extensionId);
  await saveLLM(library, token);
  const dialog = await openStatus(library, 'llm');
  await expect(dialog.locator('.dialog-help:visible')).toHaveCount(0);
  await expect(library.getByRole('tooltip')).toHaveCount(0);

  const state = dialog.locator('[data-status-help="llm-state"]');
  const stateTip = library.locator('[data-status-help-content="llm-state"]');
  await state.hover();
  await expect(stateTip).toBeVisible();
  await expect(stateTip).toHaveAttribute('role', 'tooltip');
  await expect(stateTip.locator('strong')).toBeVisible();
  expect(await stateTip.locator('ul > li').count()).toBeGreaterThanOrEqual(2);
  await expect(stateTip).toContainText(/验证|测试/);
  await expect(state).toHaveAttribute('aria-describedby', (await stateTip.getAttribute('id'))!);
  await library.screenshot({ path: testInfo.outputPath('connection-status-help.png') });

  // The tooltip must remain readable when the pointer leaves its label for
  // the tooltip itself, including after the hover-close grace period.
  await stateTip.hover();
  await library.waitForTimeout(350);
  await expect(stateTip).toBeVisible();
  expect(await stateTip.evaluate((element) => getComputedStyle(element).pointerEvents)).not.toBe('none');
  await library.keyboard.press('Escape');
  await expect(stateTip).not.toBeVisible();
  await expect(dialog).toBeVisible();

  await library.mouse.move(0, 0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  const checked = dialog.locator('[data-status-help="llm-checked"]');
  for (let step = 0; step < 12; step++) {
    await library.keyboard.press('Tab');
    if (await checked.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(checked).toBeFocused();
  const checkedTip = library.locator('[data-status-help-content="llm-checked"]');
  await expect(checkedTip).toBeVisible();
  await library.keyboard.press('Escape');
  await expect(checkedTip).not.toBeVisible();
  await expect(checked).toBeFocused();
  await expect(dialog).toBeVisible();
  await library.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect((await llmRequests(request, token)).requests).toHaveLength(0);
});

test('E72: status tooltips fit a narrow viewport while errors remain visible and help causes no requests', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const library = await openLibrary(context, extensionId);
  await saveLLM(library, token, 'unauthorized');
  await library.evaluate((url) => chrome.runtime.sendMessage({
    type: 'sync:save', patch: { enabled: false, url, username: 'tester', password: 'app-password' },
  }), `${BASE_URL}/dav/${token}/`);
  const other = await secondWindow(context, library);
  const dialog = await openStatus(library, 'llm');
  const lastSync = dialog.locator('[data-status-help="sync-last-sync"]');
  const lastSyncTip = library.locator('[data-status-help-content="sync-last-sync"]');
  await lastSync.focus();
  await expect(lastSyncTip).toBeVisible();
  const beforeAnchor = (await lastSync.boundingBox())!;
  const beforeTip = (await lastSyncTip.boundingBox())!;

  // An error arriving from another window expands the preceding card without
  // resizing this label; the already-open hint must follow its new position.
  await other.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:test' }));
  const error = dialog.locator('[data-status-section="llm"]').getByRole('alert');
  await expect(error).toContainText(/授权|API key|401/);
  await expect(error).toBeVisible();
  await expect(lastSync).toBeFocused();
  await expect.poll(async () => Math.abs((await lastSync.boundingBox())!.y - beforeAnchor.y)).toBeGreaterThan(5);
  await expect.poll(async () => {
    const anchor = (await lastSync.boundingBox())!;
    const tip = (await lastSyncTip.boundingBox())!;
    return Math.abs((tip.y - anchor.y) - (beforeTip.y - beforeAnchor.y));
  }).toBeLessThan(1);
  await library.keyboard.press('Escape');
  await expect(lastSyncTip).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText(TEST_KEY);
  await expect(dialog).not.toContainText('PRIVATE_PROVIDER_DETAIL');
  expect((await llmRequests(request, token)).requests).toHaveLength(1);

  await library.setViewportSize({ width: 390, height: 700 });
  for (const key of ['llm-state', 'sync-test']) {
    await dialog.locator(`[data-status-help="${key}"]`).hover();
    const tip = library.locator(`[data-status-help-content="${key}"]`);
    await expect(tip).toBeVisible();
    await expect.poll(() => tip.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    })).toBe(true);
    await library.keyboard.press('Escape');
    await expect(tip).not.toBeVisible();
    await expect(dialog).toBeVisible();
  }
  await error.scrollIntoViewIfNeeded();
  await expect(error).toBeVisible();
  await expect(dialog.locator('.dialog-help:visible')).toHaveCount(0);
  expect((await llmRequests(request, token)).requests).toHaveLength(1);
  const dav = await (await request.get(`${BASE_URL}/__dav-state?prefix=${encodeURIComponent(`/dav/${token}/`)}`)).json();
  expect(dav.requests).toHaveLength(0);
});

test('E73: sync frequencies persist, show their next due time and wait for the schedule after edits', async ({
  context, serviceWorker, extensionId, request,
}) => {
  await request.get(`${BASE_URL}/__dav-reset`);
  const url = `${BASE_URL}/dav/${randomUUID()}/`;
  const article = await context.newPage();
  await article.goto(`${BASE_URL}/fixtures/nested.html`);
  await highlight(article, '#probe-2', 'footnote marker');
  const library = await openLibrary(context, extensionId);
  const annotationId = await library.locator('.annotation').getAttribute('data-annotation-id');
  const dialog = await openStatus(library, 'sync');
  await dialog.locator('[data-status-action="sync-settings"]').click();
  const form = dialog.locator('.connection-sync-form');
  await expect(form.locator('[data-status-sync="schedule"]')).toHaveValue('daily');
  await form.locator('[data-status-sync="enabled"]').check();
  await form.locator('[data-status-sync="url"]').fill(url);
  await form.locator('[data-status-sync="username"]').fill('tester');
  await form.locator('[data-status-sync="password"]').fill(DAV_PASSWORD);
  await form.locator('[data-status-sync="save"]').click();
  await expect(form).toHaveCount(0);
  await expect(dialog.locator('[data-status-sync="schedule-status"]')).toContainText('每天');
  const daily = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:status' }));
  expect(daily.config).toMatchObject({ schedule: 'daily', intervalMinutes: 1440 });
  expect(Math.abs(daily.state.nextSyncAt - (Date.now() + 1440 * 60_000))).toBeLessThan(5000);

  await library.evaluate(({ id, comment }) => chrome.runtime.sendMessage({ type: 'annotation:set-comment', id, comment }), {
    id: annotationId, comment: 'Saved locally until the next scheduled sync.',
  });
  // Cover the former edit debounce, not an hours-long scheduled wait.
  await library.waitForTimeout(4600);
  expect((await davState(request, url)).requests).toHaveLength(0);
  await library.evaluate(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'sync:status' });
    await chrome.storage.local.set({ 'sync.schedule': { revision: status.config.revision, nextSyncAt: Date.now() - 1000 } });
    await chrome.alarms.create('locus-sync', { when: Date.now() + 100 });
  });
  await expect.poll(() => library.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'sync:status' })).state.lastSyncAt)).toBeGreaterThan(0);
  expect((await readRemoteLibrary(request, url)).annotations.find((row) => row.id === annotationId)?.comment)
    .toBe('Saved locally until the next scheduled sync.');

  for (const [schedule, minutes, label] of [
    ['hourly', 60, '每小时'], ['weekly', 10080, '每周'], ['manual', 0, '仅手动'],
  ] as const) {
    await dialog.locator('[data-status-action="sync-settings"]').click();
    await form.locator('[data-status-sync="schedule"]').selectOption(schedule);
    await form.locator('[data-status-sync="save"]').click();
    await expect(form).toHaveCount(0);
    await expect(dialog.locator('[data-status-sync="schedule-status"]')).toContainText(label);
    const status = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'sync:status' }));
    expect(status.config).toMatchObject({ schedule, intervalMinutes: minutes });
    const alarm = await library.evaluate(() => chrome.alarms.get('locus-sync'));
    if (minutes) {
      expect(Math.abs(status.state.nextSyncAt - (Date.now() + minutes * 60_000))).toBeLessThan(5000);
      expect(alarm?.scheduledTime).toBe(status.state.nextSyncAt);
      const displayed = await library.evaluate((time) => new Date(time).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }), status.state.nextSyncAt);
      await expect(dialog.locator('[data-status-sync="next-sync"]')).toContainText(displayed);
    } else {
      expect(status.state.nextSyncAt).toBe(0);
      expect(alarm).toBeUndefined();
      await expect(dialog.locator('[data-status-sync="next-sync"]')).toContainText('按需同步');
    }
  }
  await library.reload();
  const reopened = await openStatus(library, 'sync');
  await expect(reopened.locator('[data-status-sync="schedule-status"]')).toContainText('仅手动');
  await reopened.locator('[data-status-action="sync-settings"]').click();
  await expect(reopened.locator('[data-status-sync="schedule"]')).toHaveValue('manual');
});

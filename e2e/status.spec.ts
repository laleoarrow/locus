import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { BASE_URL, expect, highlight, test } from './extension';

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

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';
import { DEFAULT_SUMMARY_PROMPT, PREVIOUS_DEFAULT_SUMMARY_PROMPT } from '../src/domain/llm';
import { BASE_URL, expect, highlight, test } from './extension';

const NESTED = `${BASE_URL}/fixtures/nested.html`;
const DEMO = `${BASE_URL}/fixtures/demo.html`;
const TEST_KEY = 'fixture-llm-key-never-export';
const CUSTOM_PROMPT = '请仅根据本页摘录和笔记，用中文写两个要点，并添加 [1] 引用。';
const REVIEW = 'Review main content · 主要内容';

interface RecordedRequest {
  body: { model: string; messages: Array<{ role: string; content: string }> };
  authorizationPresent: boolean;
  path: string;
}

async function serverState(request: APIRequestContext, token: string): Promise<{
  requests: RecordedRequest[]; pending: number;
}> {
  return (await request.get(`${BASE_URL}/__llm/${token}/requests`)).json();
}

async function seed(context: BrowserContext, extensionId: string, secondPage = false) {
  const page = await context.newPage();
  await page.goto(NESTED);
  await highlight(page, '#probe-2', 'footnote marker');
  if (secondPage) {
    await highlight(page, '#probe-4', 'Quotation blocks');
    await page.goto(DEMO);
    await highlight(page, '#probe-2', 'scoping');
  }
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(library.locator('.page-card')).toHaveCount(secondPage ? 2 : 1);
  await expect(library.locator('[data-status="llm"]')).toBeEnabled();
  const card = library.locator('.page-card').filter({ has: library.locator(`.page-title[title="${NESTED}"]`) });
  await expect(card).toHaveCount(1);
  return { page, library, card };
}

async function saveManual(card: Locator, content: string) {
  await card.locator('[data-summary="edit"]').click();
  await card.locator('[data-summary="text"]').fill(content);
  await card.locator('[data-summary="save"]').click();
  await expect(card.locator('.summary-content')).toHaveText(content);
}

async function openLLMSettings(library: Page) {
  await library.locator('[data-status="llm"]').click();
  await library.getByRole('dialog', { name: 'Connection status · 连接状态' })
    .locator('[data-status-action="llm-settings"]').click();
  await expect(library.getByRole('dialog', { name: 'LLM settings' })).toBeVisible();
}

async function configure(library: Page, token: string, mode = 'success') {
  await openLLMSettings(library);
  await library.locator('[data-llm="enabled"]').check();
  await library.locator('[data-llm="url"]').fill(`${BASE_URL}/__llm/${token}/${mode}`);
  await library.locator('[data-llm="model"]').fill('fixture-model');
  await library.locator('[data-llm="key"]').fill(TEST_KEY);
  await library.locator('[data-llm="prompt"]').fill(CUSTOM_PROMPT);
  await library.locator('[data-llm="save"]').click();
  await expect(library.getByRole('dialog', { name: 'LLM settings' })).not.toBeVisible();
  await expect(library.locator('[data-status="llm"]')).toContainText('待验证');
}

async function storedSummary(library: Page, sourceId: string): Promise<{ content: string; updatedAt: number } | null> {
  return library.evaluate((id) => new Promise((resolve, reject) => {
    const open = indexedDB.open('locus');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('pageSummaries').objectStore('pageSummaries').get(id);
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result ?? null); };
    };
  }), sourceId);
}

test('E56: manual main content persists while AI is off and setup sends nothing', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const { library, card } = await seed(context, extensionId);
  await expect(library.locator('[data-status="llm"]')).toContainText(/已关闭|未配置/);
  await saveManual(card, '手动记录的主要内容，不需要模型。');
  await library.reload();
  await expect(card.locator('.summary-content')).toHaveText('手动记录的主要内容，不需要模型。');
  await card.locator('[data-summary="generate"]').click();
  await expect(library.getByRole('dialog', { name: 'LLM settings' })).toBeVisible();
  await expect(library.locator('[data-llm="enabled"]')).not.toBeChecked();
  await expect(library.locator('[data-llm="prompt"]')).toHaveValue(DEFAULT_SUMMARY_PROMPT);
  const config = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
  expect(config.config).toMatchObject({ enabled: false, hasApiKey: false });
  expect(config.config).not.toHaveProperty('apiKey');
  const sourceId = await card.getAttribute('data-source-id');
  const refused = await library.evaluate((sourceId) => chrome.runtime.sendMessage({ type: 'llm:generate', sourceId }), sourceId);
  expect(refused.error).toContain('启用');
  expect((await serverState(request, token)).requests).toHaveLength(0);
  await library.keyboard.press('Escape');
  await expect(card.locator('[data-summary="generate"]')).toBeFocused();
});

test('E57: live page notes become an editable draft; keys stay masked and out of backups', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const { library, card } = await seed(context, extensionId, true);
  const live = card.locator('.annotation').filter({ hasText: 'footnote marker' });
  await live.locator('[data-action="edit"]').click();
  await live.locator('.note-editor textarea').fill('Keep this personal note.');
  await live.locator('.note-editor button.primary').click();
  await expect(live.locator('.note')).toHaveText('Keep this personal note.');
  await card.locator('.annotation').filter({ hasText: 'Quotation blocks' }).locator('[data-action="delete"]').click();
  await expect(card.locator('.annotation')).toHaveCount(1);
  await saveManual(card, 'Previously reviewed content.');
  await configure(library, token);

  await openLLMSettings(library);
  await expect(library.locator('[data-llm="key"]')).toHaveValue('');
  await expect(library.locator('[data-llm="key"]')).toHaveAttribute('type', 'password');
  await expect(library.locator('[data-llm="key"]')).toHaveAttribute('placeholder', /Saved/);
  await expect(library.locator('[data-llm="prompt"]')).toHaveValue(CUSTOM_PROMPT);
  await library.locator('[data-llm="reset-prompt"]').click();
  await expect(library.locator('[data-llm="prompt"]')).toHaveValue(/不编造/);
  await library.locator('[data-llm="prompt"]').fill(CUSTOM_PROMPT);
  await library.locator('[data-llm="save"]').click();
  const publicConfig = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
  expect(publicConfig.config.hasApiKey).toBe(true);
  expect(JSON.stringify(publicConfig)).not.toContain(TEST_KEY);
  expect((await serverState(request, token)).requests).toHaveLength(0);

  const sourceId = (await card.getAttribute('data-source-id'))!;
  await card.locator('[data-summary="generate"]').click();
  const review = library.getByRole('dialog', { name: REVIEW });
  await expect(review.locator('textarea')).toHaveValue(/主要内容/);
  expect((await storedSummary(library, sourceId))?.content).toBe('Previously reviewed content.');
  const calls = (await serverState(request, token)).requests;
  expect(calls).toHaveLength(1);
  expect(calls[0]?.authorizationPresent).toBe(true);
  expect(calls[0]?.body.model).toBe('fixture-model');
  expect(calls[0]?.body.messages[0]?.content).toContain(CUSTOM_PROMPT);
  const material = JSON.parse(calls[0]!.body.messages[1]!.content);
  expect(material).toEqual({
    title: 'Fixture: nested text nodes', url: NESTED,
    annotations: [{ id: 1, quote: 'footnote marker', note: 'Keep this personal note.' }],
  });
  expect(JSON.stringify(calls)).not.toContain(TEST_KEY);
  expect(JSON.stringify(calls)).not.toContain('Quotation blocks');
  expect(JSON.stringify(calls)).not.toContain('scoping');
  await review.locator('textarea').fill('Edited and reviewed draft [1]');
  await review.locator('[data-summary-review="save"]').click();
  await expect(review).not.toBeVisible();
  await expect(card.locator('.summary-content')).toHaveText('Edited and reviewed draft [1]');
  await library.reload();
  await expect(card.locator('.summary-content')).toHaveText('Edited and reviewed draft [1]');

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(NESTED)}`);
  const [download] = await Promise.all([
    panel.waitForEvent('download'), panel.locator('[data-action="export"]').click(),
  ]);
  const backup = await readFile((await download.path())!, 'utf8');
  expect(backup).not.toContain(TEST_KEY);
  expect(backup).not.toContain('locus.llm.config');
  expect(JSON.parse(backup).pageSummaries).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceId, content: 'Edited and reviewed draft [1]' }),
  ]));
});

test('E58: provider failure preserves saved content and hides provider details', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const { library, card } = await seed(context, extensionId);
  await saveManual(card, 'Keep the reviewed original.');
  await configure(library, token, 'error');
  await card.locator('[data-summary="generate"]').click();
  const review = library.getByRole('dialog', { name: REVIEW });
  await expect(review.getByRole('alert')).toContainText('HTTP 500');
  await expect(review.locator('[data-summary-review="save"]')).toBeDisabled();
  await expect(review).not.toContainText('PRIVATE_PROVIDER_DETAIL');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.locator('.summary-content')).toHaveText('Keep the reviewed original.');
  expect((await serverState(request, token)).requests).toHaveLength(1);
});

for (const changed of ['notes', 'settings'] as const) {
  test(`E59: changing ${changed} during generation rejects the stale reply`, async ({
    context, serviceWorker, extensionId, request,
  }) => {
    const token = randomUUID();
    const { library, card } = await seed(context, extensionId);
    await saveManual(card, 'Keep original while waiting.');
    await configure(library, token, 'hold');
    const annotationId = await card.locator('.annotation').getAttribute('data-annotation-id');
    await card.locator('[data-summary="generate"]').click();
    await expect.poll(async () => (await serverState(request, token)).pending).toBe(1);
    if (changed === 'notes') {
      await library.evaluate((id) => chrome.runtime.sendMessage({ type: 'annotation:set-comment', id, comment: 'Changed during generation.' }), annotationId);
    } else {
      await library.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:save', patch: { prompt: 'Changed during generation.' } }));
    }
    await request.post(`${BASE_URL}/__llm/${token}/release`);
    const review = library.getByRole('dialog', { name: REVIEW });
    await expect(review.getByRole('alert')).toContainText(changed === 'notes' ? 'notes changed' : 'settings changed');
    await expect(review.locator('textarea')).toHaveCount(0);
    await expect(review.locator('[data-summary-review="save"]')).toBeDisabled();
    const connection = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
    expect(connection.connection.status).toBe(changed === 'notes' ? 'success' : 'untested');
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(card.locator('.summary-content')).toHaveText('Keep original while waiting.');
  });
}

test('E60: selected pages generate separate drafts and save as one reviewed batch', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const { library } = await seed(context, extensionId, true);
  await configure(library, token);
  await library.locator('[data-bulk-action="menu"]').click();
  await library.locator('[data-bulk-action="select"]').click();
  await library.locator('[data-selection="all"]').click();
  await expect(library.locator('[data-selection="count"]')).toHaveText('3 selected · 2 pages');
  await library.locator('[data-selection="summarize"]').click();
  const review = library.getByRole('dialog', { name: REVIEW });
  await expect(review.locator('textarea')).toHaveCount(2);
  await expect(review.locator('[data-summary-review="save"]')).toBeEnabled();
  expect(await library.locator('.summary-content').count()).toBe(0);
  const calls = (await serverState(request, token)).requests;
  expect(calls).toHaveLength(2);
  const pages = calls.map((call) => JSON.parse(call.body.messages[1]!.content));
  expect(pages.find((page) => page.url === NESTED).annotations).toHaveLength(2);
  expect(pages.find((page) => page.url === DEMO).annotations).toEqual([{ id: 1, quote: 'scoping', note: '' }]);
  await review.locator('[data-summary-review="save"]').click();
  await expect(review).not.toBeVisible();
  await expect(library.locator('.summary-content')).toHaveCount(2);
  await library.reload();
  await expect(library.locator('.summary-content')).toHaveCount(2);
});

test('E61: a draft cannot overwrite main content saved in another library tab', async ({
  context, serviceWorker, extensionId,
}) => {
  const token = randomUUID();
  const { library, card } = await seed(context, extensionId);
  await saveManual(card, 'Initial reviewed content.');
  await configure(library, token);
  await card.locator('[data-summary="generate"]').click();
  const review = library.getByRole('dialog', { name: REVIEW });
  await expect(review.locator('textarea')).toHaveCount(1);
  const other = await context.newPage();
  await other.goto(`chrome-extension://${extensionId}/library.html`);
  await saveManual(other.locator('.page-card'), 'Newer manual content from another tab.');
  await review.locator('[data-summary-review="save"]').click();
  await expect(review.getByRole('alert')).toContainText('page content changed');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.locator('.summary-content')).toHaveText('Newer manual content from another tab.');
});

test('E75: the exact previous default prompt migrates in settings while custom prompts remain intact', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const { library } = await seed(context, extensionId);
  await library.evaluate((config) => chrome.storage.local.set({ 'locus.llm.config': config }), {
    enabled: true, baseUrl: `${BASE_URL}/__llm/${token}/success`, model: 'fixture-model',
    apiKey: TEST_KEY, prompt: PREVIOUS_DEFAULT_SUMMARY_PROMPT, revision: 17,
  });
  await library.reload();
  await openLLMSettings(library);
  await expect(library.locator('[data-llm="prompt"]')).toHaveValue(DEFAULT_SUMMARY_PROMPT);
  await expect(library.locator('[data-llm="model"]')).toHaveValue('fixture-model');
  await expect(library.locator('[data-llm="key"]')).toHaveValue('');
  const migrated = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
  expect(migrated.config).toMatchObject({ revision: 17, hasApiKey: true, prompt: DEFAULT_SUMMARY_PROMPT });
  const storedBeforeSave = await library.evaluate(async () => {
    const saved = await chrome.storage.local.get('locus.llm.config');
    const config = saved['locus.llm.config'] as { prompt: string; revision: number };
    return { prompt: config.prompt, revision: config.revision };
  });
  expect(storedBeforeSave).toEqual({ prompt: PREVIOUS_DEFAULT_SUMMARY_PROMPT, revision: 17 });
  await library.locator('[data-llm="save"]').click();
  await expect(library.getByRole('dialog', { name: 'LLM settings' })).not.toBeVisible();
  const savedPrompt = await library.evaluate(async () => {
    const saved = await chrome.storage.local.get('locus.llm.config');
    return (saved['locus.llm.config'] as { prompt: string }).prompt;
  });
  expect(savedPrompt).toBe(DEFAULT_SUMMARY_PROMPT);

  for (const custom of [`${PREVIOUS_DEFAULT_SUMMARY_PROMPT} `, CUSTOM_PROMPT]) {
    await library.evaluate(async (prompt) => {
      const stored = await chrome.storage.local.get('locus.llm.config');
      await chrome.storage.local.set({ 'locus.llm.config': { ...(stored['locus.llm.config'] as object), prompt } });
    }, custom);
    await library.reload();
    await openLLMSettings(library);
    await expect(library.locator('[data-llm="prompt"]')).toHaveValue(custom);
    await library.locator('[data-llm="save"]').click();
    await expect(library.getByRole('dialog', { name: 'LLM settings' })).not.toBeVisible();
    const saved = await library.evaluate(() => chrome.runtime.sendMessage({ type: 'llm:status' }));
    expect(saved.config.prompt).toBe(custom);
  }
  expect((await serverState(request, token)).requests).toHaveLength(0);
});

test('E76: overlong provider output cannot become a draft or overwrite reviewed content', async ({
  context, serviceWorker, extensionId, request,
}) => {
  const token = randomUUID();
  const { library, card } = await seed(context, extensionId);
  const original = 'This manually reviewed content is allowed to be longer than the selected quotation.';
  await saveManual(card, original);
  await configure(library, token, 'verbose');
  const sourceId = (await card.getAttribute('data-source-id'))!;
  await card.locator('[data-summary="generate"]').click();
  const review = library.getByRole('dialog', { name: REVIEW });
  await expect(review.getByRole('alert')).toContainText('摘要超过原笔记长度，未生成草稿。');
  await expect(review.locator('textarea')).toHaveCount(0);
  await expect(review.locator('[data-summary-review="save"]')).toBeDisabled();
  await expect(review).not.toContainText('这是冗长的模拟回复');
  expect((await storedSummary(library, sourceId))?.content).toBe(original);
  const calls = (await serverState(request, token)).requests;
  expect(calls).toHaveLength(1);
  expect(calls[0]?.body.messages[0]?.content).toContain(CUSTOM_PROMPT);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.locator('.summary-content')).toHaveText(original);
  await library.reload();
  await expect(card.locator('.summary-content')).toHaveText(original);
  expect((await serverState(request, token)).requests).toHaveLength(1);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LLM_CONFIG, type LLMConfig } from '@/domain/llm';
import { EMPTY_CONNECTION_STATE } from '@/domain/status';
import { EMPTY_SYNC_STATE } from '@/domain/sync';
import { generateSummary, testLLMConnection, validateSummaryRequest } from '@/llm/client';
import { beginLLMConnection, finishLLMConnection, getLLMConfig, getLLMConnection, saveLLMConfig } from '@/llm/store';
import { testConnection } from '@/sync/engine';
import {
  beginSyncConnection, finishSyncConnection, getSyncConfig, getSyncConnection,
  getSyncState, setSyncConfig, setSyncState,
} from '@/sync/store';

let storage: Record<string, unknown>;
const llm: LLMConfig = {
  ...DEFAULT_LLM_CONFIG, enabled: true, baseUrl: 'https://provider.example/v1',
  model: 'fixture-model', apiKey: 'PRIVATE_LLM_KEY', prompt: 'PRIVATE_CUSTOM_PROMPT',
};
const sync = {
  enabled: true, url: 'https://dav.example/folder/', username: 'fixture-user',
  password: 'PRIVATE_DAV_PASSWORD', schedule: 'daily' as const, intervalMinutes: 1440,
};

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(storage[key]) })),
    set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, structuredClone(values))),
  } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LLM connection history', () => {
  it('starts untested and distinguishes saving configuration from a completed check', async () => {
    expect(await getLLMConnection()).toEqual(EMPTY_CONNECTION_STATE);
    await saveLLMConfig(llm);
    expect(await getLLMConnection()).toEqual(EMPTY_CONNECTION_STATE);
    const attempt = await beginLLMConnection((await getLLMConfig()).revision);
    expect(await getLLMConnection()).toMatchObject({ status: 'testing', checkedAt: 0 });
    await finishLLMConnection(attempt!, true);
    expect(await getLLMConnection()).toMatchObject({ status: 'success', error: '' });
    expect((await getLLMConnection()).checkedAt).toBeGreaterThan(0);
    expect(JSON.stringify(await getLLMConnection())).not.toContain(llm.apiKey);
  });

  it('invalidates old checks after configuration changes, including an A → B → A change', async () => {
    await saveLLMConfig(llm);
    const old = await beginLLMConnection((await getLLMConfig()).revision);
    await saveLLMConfig({ model: 'replacement-model' });
    await saveLLMConfig({ model: llm.model });
    expect(await finishLLMConnection(old!, true)).toBe(false);
    expect(await getLLMConnection()).toEqual(EMPTY_CONNECTION_STATE);
    expect(await beginLLMConnection(old!.revision)).toBeNull();
  });

  it('prevents an older response from replacing a newer failure for the same configuration', async () => {
    await saveLLMConfig(llm);
    const revision = (await getLLMConfig()).revision;
    const old = await beginLLMConnection(revision);
    const current = await beginLLMConnection(revision);
    await finishLLMConnection(current!, false, 'Authorization was rejected.');
    expect(await finishLLMConnection(old!, true)).toBe(false);
    expect(await getLLMConnection()).toMatchObject({ status: 'error', error: 'Authorization was rejected.' });
  });

  it('does not turn a previous result into a connection failure for local input validation', async () => {
    await saveLLMConfig(llm);
    const config = await getLLMConfig();
    const tested = await beginLLMConnection(config.revision);
    await finishLLMConnection(tested!, true);
    const previous = await getLLMConnection();
    await beginLLMConnection(config.revision, false);
    const error = await generateSummary(config, { title: '', url: '', annotations: [] }).catch((reason) => reason);
    expect(error.requestAttempted).toBe(false);
    expect(await getLLMConnection()).toEqual(previous);
  });

  it('tests the actual model with fixed synthetic material and safe response errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Synthetic summary [1]' } }],
    })));
    vi.stubGlobal('fetch', fetcher);
    await testLLMConnection(llm);
    const body = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(body.model).toBe(llm.model);
    expect(body.messages[1].content).toContain('synthetic sample');
    expect(JSON.stringify(body)).not.toContain(llm.apiKey);
    expect(JSON.stringify(body)).not.toContain(llm.prompt);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE_PROVIDER_ERROR', { status: 401 })));
    const error = await testLLMConnection(llm).catch((reason) => reason);
    expect(error.requestAttempted).toBe(true);
    expect(error.message).not.toContain('PRIVATE');
  });

  it('validates oversized generation input without stealing an active test', async () => {
    await saveLLMConfig(llm);
    const config = await getLLMConfig();
    const active = await beginLLMConnection(config.revision);
    expect(() => validateSummaryRequest(config, {
      title: 'Page', url: 'https://example.invalid/',
      annotations: [{ quote: 'x'.repeat(120_001), note: '' }],
    })).toThrow('过多');
    expect(await getLLMConnection()).toMatchObject({ status: 'testing' });
    expect(await finishLLMConnection(active!, true)).toBe(true);
    expect(await getLLMConnection()).toMatchObject({ status: 'success' });
  });

  it('treats testing left by a previous worker as untested while retaining completed results', async () => {
    await saveLLMConfig(llm);
    const attempt = await beginLLMConnection((await getLLMConfig()).revision);
    const record = storage['locus.llm.connection'] as Record<string, unknown>;
    record.sessionId = 'previous-worker';
    expect(await getLLMConnection()).toEqual(EMPTY_CONNECTION_STATE);
    record.status = 'success'; record.checkedAt = 123;
    expect(await getLLMConnection()).toEqual({ status: 'success', checkedAt: 123, error: '' });
    expect(attempt).not.toBeNull();
  });
});

describe('WebDAV connection history', () => {
  it('keeps an active test and saved verification when a blur saves unchanged settings', async () => {
    await setSyncConfig(sync);
    const config = await getSyncConfig();
    const attempt = await beginSyncConnection(config.revision);
    const writes = vi.mocked(chrome.storage.local.set).mock.calls.length;
    const unchanged = await setSyncConfig({ username: sync.username });
    expect(unchanged.revision).toBe(config.revision);
    expect(vi.mocked(chrome.storage.local.set).mock.calls).toHaveLength(writes);
    expect(await getSyncConnection()).toMatchObject({ status: 'testing' });
    expect(await finishSyncConnection(attempt!, true)).toBe(true);
    const verified = await getSyncConnection();
    await setSyncConfig(sync, config.revision);
    expect(await getSyncConnection()).toEqual(verified);
    expect((await getSyncConfig()).revision).toBe(config.revision);
    await expect(setSyncConfig(sync, config.revision - 1)).rejects.toThrow('changed in another window');
  });

  it('persists connection success without pretending a sync occurred', async () => {
    await setSyncConfig({ ...sync, enabled: false });
    const config = await getSyncConfig();
    const attempt = await beginSyncConnection(config.revision);
    await finishSyncConnection(attempt!, true);
    expect(await getSyncConnection()).toMatchObject({ status: 'success' });
    expect(await getSyncState()).toEqual(EMPTY_SYNC_STATE);
  });

  it.each([
    { url: 'https://other.example/folder/' },
    { username: 'another-user' },
    { password: 'replacement-password' },
  ])('clears verification and previous sync history when endpoint/auth changes', async (patch) => {
    await setSyncConfig(sync);
    const attempt = await beginSyncConnection((await getSyncConfig()).revision);
    await finishSyncConnection(attempt!, true, '', { lastSyncAt: 123, lastError: '', etag: 'old-etag' });
    await setSyncState({ lastSyncAt: 123, lastError: 'Previous error', etag: 'old-etag' });
    await setSyncConfig(patch);
    expect(await getSyncConnection()).toEqual(EMPTY_CONNECTION_STATE);
    expect(await getSyncState()).toEqual(EMPTY_SYNC_STATE);
    await finishSyncConnection(attempt!, true, '', { lastSyncAt: 999, lastError: '', etag: 'stale-etag' });
    expect(await getSyncConnection()).toEqual(EMPTY_CONNECTION_STATE);
    expect(await getSyncState()).toEqual(EMPTY_SYNC_STATE);
  });

  it('retains historical sync time for scheduling changes while invalidating stale checks', async () => {
    await setSyncConfig(sync);
    const attempt = await beginSyncConnection((await getSyncConfig()).revision);
    await finishSyncConnection(attempt!, true, '', { lastSyncAt: 123, lastError: '', etag: 'valid-etag' });
    await setSyncConfig({ schedule: 'hourly' });
    expect(await getSyncConnection()).toEqual(EMPTY_CONNECTION_STATE);
    expect((await getSyncState()).lastSyncAt).toBe(123);
    expect(await finishSyncConnection(attempt!, false, 'Stale failure')).toBe(false);
    expect((await getSyncState()).lastError).toBe('');
  });

  it('preserves a real sync result without letting it overwrite a newer connection test', async () => {
    await setSyncConfig(sync);
    const revision = (await getSyncConfig()).revision;
    const syncing = await beginSyncConnection(revision);
    const testing = await beginSyncConnection(revision);
    await finishSyncConnection(syncing!, true, '', { lastSyncAt: 321, lastError: '', etag: 'current-etag' });
    expect(await getSyncConnection()).toMatchObject({ status: 'testing' });
    expect((await getSyncState()).lastSyncAt).toBe(321);
    await finishSyncConnection(testing!, false, 'Server unavailable.');
    expect(await getSyncConnection()).toMatchObject({ status: 'error', error: 'Server unavailable.' });
    expect((await getSyncState()).lastSyncAt).toBe(321);
  });

  it('does not expose credentials from unexpected network exceptions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('PRIVATE_DAV_PASSWORD PRIVATE_PROVIDER_DETAIL')));
    const result = await testConnection(sync);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('PRIVATE');
  });

  it('rejects a stale settings form atomically without changing the current config or status', async () => {
    await setSyncConfig(sync);
    const opened = await getSyncConfig();
    await setSyncConfig({ username: 'newer-user' }, opened.revision);
    const current = await getSyncConfig();
    const attempt = await beginSyncConnection(current.revision);
    await finishSyncConnection(attempt!, true);
    const connection = await getSyncConnection();
    await expect(setSyncConfig({ url: 'https://stale.example/', username: 'stale-user' }, opened.revision))
      .rejects.toThrow('changed in another window');
    expect(await getSyncConfig()).toEqual(current);
    expect(await getSyncConnection()).toEqual(connection);
  });

  it('does not carry a saved password to another origin without an explicit replacement', async () => {
    await setSyncConfig(sync);
    await setSyncConfig({ url: 'https://dav.example/different-path/' });
    expect((await getSyncConfig()).password).toBe(sync.password);
    await setSyncConfig({ url: 'https://other.example/folder/' });
    expect((await getSyncConfig()).password).toBe('');
    await setSyncConfig({ url: sync.url, password: 'explicit-new-password' });
    expect((await getSyncConfig()).password).toBe('explicit-new-password');
  });

  it('recovers abandoned WebDAV testing after a worker restart', async () => {
    await setSyncConfig(sync);
    await beginSyncConnection((await getSyncConfig()).revision);
    (storage['sync.connection'] as Record<string, unknown>).sessionId = 'previous-worker';
    expect(await getSyncConnection()).toEqual(EMPTY_CONNECTION_STATE);
    expect(await getSyncState()).toEqual(EMPTY_SYNC_STATE);
  });
});

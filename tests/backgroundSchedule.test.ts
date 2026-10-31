import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '@/db/repo';
import { db } from '@/db/schema';
import { runSync } from '@/sync/engine';
import { rescheduleSyncAlarm, SYNC_ALARM } from '@/sync/schedule';
import { getSyncConfig, getSyncState } from '@/sync/store';
import type { BgRequest, BgResponseFor } from '@/messaging/protocol';
import startBackground from '@/entrypoints/background';

vi.mock('wxt/utils/define-background', () => ({ defineBackground: (start: () => void) => start }));
vi.mock('@/sync/engine', () => ({ runSync: vi.fn(), testConnection: vi.fn(async () => ({ ok: true, error: '' })) }));

let storage: Record<string, unknown>;
let alarm: chrome.alarms.Alarm | undefined;
let onMessage: (message: BgRequest, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => boolean;
let onStartup: () => void;
let onAlarm: (alarm: chrome.alarms.Alarm) => void;
const sourceUrl = 'https://example.test/paper';
const create: BgRequest = { type: 'annotation:create', url: sourceUrl, title: 'Paper', color: 'yellow', comment: 'note', anchor: {
  exact: 'quote', prefix: '', suffix: '', start: 0, end: 5,
  startPoint: { steps: [], textIndex: 0, offset: 0 }, endPoint: { steps: [], textIndex: 0, offset: 5 },
} };
function send<T extends BgRequest>(message: T): Promise<BgResponseFor<T>> {
  return new Promise((resolve) => onMessage(message, { url: 'chrome-extension://fixture/library.html' }, (value) => resolve(value as BgResponseFor<T>)));
}
function fireAlarm() { onAlarm({ name: SYNC_ALARM, scheduledTime: Date.now(), persistAcrossSessions: true }); }

beforeEach(async () => {
  storage = {}; alarm = undefined;
  await Promise.all(db.tables.map((table) => table.clear()));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network is permitted in scheduling unit tests'); }));
  vi.stubGlobal('chrome', {
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(storage[key]) })),
      set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, structuredClone(patch))),
    } },
    runtime: {
      getManifest: () => ({ version: '0.9.2' }), getURL: () => 'chrome-extension://fixture/', sendMessage: vi.fn(async () => undefined),
      onInstalled: { addListener: vi.fn() }, onStartup: { addListener: (listener: typeof onStartup) => { onStartup = listener; } },
      onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } },
    },
    alarms: {
      get: vi.fn(async () => alarm), clear: vi.fn(async () => { alarm = undefined; return true; }),
      create: vi.fn(async (name: string, info: chrome.alarms.AlarmCreateInfo) => { alarm = { name, scheduledTime: info.when!, persistAcrossSessions: true }; }),
      onAlarm: { addListener: (listener: typeof onAlarm) => { onAlarm = listener; } },
    },
    permissions: { getAll: vi.fn(async () => ({ origins: [] })), onAdded: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } },
    scripting: { getRegisteredContentScripts: vi.fn(async () => []) },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
  });
  const prefs = await repo.getPrefs(); vi.spyOn(repo, 'getPrefs').mockResolvedValue({ ...prefs, checkUpdates: false });
  vi.mocked(runSync).mockImplementation(async (_config, state) => ({
    result: { ok: true, pulled: 0, settingsPulled: 0, pushed: false, error: '', uploadedBytes: 0 },
    state: { ...state, lastSyncAt: Date.now(), lastError: '', autoPaused: '' },
  }));
  (startBackground as unknown as () => void)();
  await rescheduleSyncAlarm();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function configure() {
  return send({ type: 'sync:save', patch: { enabled: true, url: 'https://dav.test/folder/', username: 'test', password: 'test' } });
}

describe('background scheduling entry points', () => {
  it('configuration saves, local edits and startup do not initiate or queue real-time sync', async () => {
    const saved = await configure(); const due = saved.state.nextSyncAt;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await send(create);
    onStartup(); await rescheduleSyncAlarm();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runSync).not.toHaveBeenCalled();
    expect((await getSyncState()).nextSyncAt).toBe(due);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an early alarm does nothing; only a due alarm starts one scheduled pass', async () => {
    await configure(); fireAlarm(); await rescheduleSyncAlarm();
    expect(runSync).not.toHaveBeenCalled();
    storage['sync.schedule'] = { revision: (await getSyncConfig()).revision, nextSyncAt: Date.now() - 1 };
    fireAlarm(); fireAlarm();
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledOnce());
    await vi.waitFor(async () => expect((await getSyncState()).lastSyncAt).toBeGreaterThan(0));
    expect(vi.mocked(runSync).mock.calls[0]![4]).toEqual({ fullScan: false });
    expect((await getSyncState()).nextSyncAt).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
  });

  it('manual full sync is explicit and edits made during it wait for the next scheduled or manual run', async () => {
    await configure();
    let release!: (value: Awaited<ReturnType<typeof runSync>>) => void;
    vi.mocked(runSync).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const manual = send({ type: 'sync:now' });
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledOnce());
    expect(vi.mocked(runSync).mock.calls[0]![4]).toEqual({ fullScan: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await send(create);
    release({ result: { ok: true, pulled: 0, settingsPulled: 0, pushed: false, error: '' }, state: await getSyncState() });
    await manual; await vi.advanceTimersByTimeAsync(10_000);
    expect(runSync).toHaveBeenCalledOnce();
    expect(await db.annotations.count()).toBe(1);
  });
});

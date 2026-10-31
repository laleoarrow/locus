import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SYNC_STATE } from '@/domain/sync';
import { rescheduleSyncAlarm, SYNC_ALARM } from '@/sync/schedule';
import { beginSyncConnection, claimScheduledSync, ensureSyncSchedule, finishSyncConnection,
  getSyncConfig, getSyncState, setSyncConfig, setSyncState } from '@/sync/store';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const enabled = { enabled: true, url: 'https://dav.test/folder/', username: 'fixture', password: 'fixture' };
let storage: Record<string, unknown>;
let alarms: Map<string, chrome.alarms.Alarm>;
let now: number;

beforeEach(() => {
  now = 1_000_000_000; storage = {}; alarms = new Map();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('chrome', {
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(storage[key]) })),
      set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, structuredClone(patch))),
    } },
    alarms: {
      get: vi.fn(async (name: string) => alarms.get(name)),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
      create: vi.fn(async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, { name, scheduledTime: info.when!, periodInMinutes: info.periodInMinutes, persistAcrossSessions: true });
      }),
    },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('persisted scheduled sync', () => {
  it('defaults both new configuration and legacy five-minute configuration to daily', async () => {
    expect(await getSyncConfig()).toMatchObject({ schedule: 'daily', intervalMinutes: 1440 });
    storage['sync.config'] = { ...enabled, intervalMinutes: 5, revision: 6 };
    expect(await getSyncConfig()).toMatchObject({ schedule: 'daily', intervalMinutes: 1440 });
    alarms.set(SYNC_ALARM, { name: SYNC_ALARM, scheduledTime: now + 5 * 60_000, periodInMinutes: 5, persistAcrossSessions: true });
    await rescheduleSyncAlarm();
    expect(alarms.get(SYNC_ALARM)).toMatchObject({ scheduledTime: now + DAY, periodInMinutes: undefined });
    expect((await getSyncState()).nextSyncAt).toBe(now + DAY);
  });

  it.each([['hourly', HOUR], ['daily', DAY], ['weekly', 7 * DAY]] as const)('starts %s only after the selected period', async (schedule, delay) => {
    await setSyncConfig({ ...enabled, schedule });
    expect(await ensureSyncSchedule()).toBe(now + delay);
    expect(await claimScheduledSync()).toBeNull();
    now += delay;
    expect(await claimScheduledSync()).toBe((await getSyncConfig()).revision);
    expect((await getSyncState()).nextSyncAt).toBe(now + delay);
  });

  it('preserves the deadline through worker recovery, no-op saves and connection tests', async () => {
    await setSyncConfig(enabled); await rescheduleSyncAlarm(); const due = now + DAY;
    now += HOUR;
    await setSyncConfig({ username: enabled.username }); await rescheduleSyncAlarm();
    const attempt = await beginSyncConnection((await getSyncConfig()).revision);
    await finishSyncConnection(attempt!, true); await rescheduleSyncAlarm();
    alarms.clear(); await rescheduleSyncAlarm();
    expect((await getSyncState()).nextSyncAt).toBe(due);
    expect(alarms.get(SYNC_ALARM)!.scheduledTime).toBe(due);
    expect(chrome.alarms.create).toHaveBeenCalledTimes(2);
  });

  it('a restore of an overdue deadline does not itself claim it or advance it', async () => {
    await setSyncConfig(enabled); const due = await ensureSyncSchedule(); now = due + HOUR;
    await rescheduleSyncAlarm();
    expect((await getSyncState()).nextSyncAt).toBe(due);
    expect(alarms.get(SYNC_ALARM)!.scheduledTime).toBe(due);
  });

  it('rejects an old hourly alarm after changing to weekly', async () => {
    await setSyncConfig({ ...enabled, schedule: 'hourly' }); await ensureSyncSchedule();
    now += 10_000; await setSyncConfig({ schedule: 'weekly' }); const due = await ensureSyncSchedule();
    now += HOUR;
    expect(await claimScheduledSync()).toBeNull(); expect((await getSyncState()).nextSyncAt).toBe(due);
  });

  it('claims only once when two alarms arrive together', async () => {
    await setSyncConfig(enabled); now = await ensureSyncSchedule();
    const revision = (await getSyncConfig()).revision;
    expect(await Promise.all([claimScheduledSync(), claimScheduledSync()])).toEqual([revision, null]);
    expect(await claimScheduledSync()).toBeNull();
  });

  it('serializes concurrent alarm changes so the final choice owns the deadline', async () => {
    await setSyncConfig(enabled);
    await Promise.all([
      setSyncConfig({ schedule: 'hourly' }).then(rescheduleSyncAlarm),
      setSyncConfig({ schedule: 'weekly' }).then(rescheduleSyncAlarm),
    ]);
    expect((await getSyncConfig()).schedule).toBe('weekly');
    expect(alarms.get(SYNC_ALARM)!.scheduledTime).toBe(now + 7 * DAY);
  });

  it('manual mode and disabling remove automatic alarms without clearing quota history', async () => {
    await setSyncConfig(enabled); await rescheduleSyncAlarm();
    await setSyncConfig({ schedule: 'manual' }); await rescheduleSyncAlarm();
    expect((await getSyncState()).nextSyncAt).toBe(0); expect(alarms.has(SYNC_ALARM)).toBe(false);
    await setSyncState({ ...EMPTY_SYNC_STATE, autoPaused: 'quota' });
    await setSyncConfig({ enabled: false }); await setSyncConfig({ enabled: true, schedule: 'hourly' });
    await rescheduleSyncAlarm();
    expect((await getSyncState()).autoPaused).toBe('quota'); expect((await getSyncState()).nextSyncAt).toBe(0);
    expect(alarms.has(SYNC_ALARM)).toBe(false);
  });

  it('rejects even a fabricated due alarm while quota-paused, and schedules anew after a manual success', async () => {
    await setSyncConfig(enabled); await ensureSyncSchedule();
    await setSyncState({ ...EMPTY_SYNC_STATE, autoPaused: 'quota' });
    storage['sync.schedule'] = { revision: (await getSyncConfig()).revision, nextSyncAt: now - 1 };
    expect(await claimScheduledSync()).toBeNull();
    expect((storage['sync.schedule'] as { nextSyncAt: number }).nextSyncAt).toBe(0);
    const attempt = await beginSyncConnection((await getSyncConfig()).revision);
    await finishSyncConnection(attempt!, true, '', { ...EMPTY_SYNC_STATE, autoPaused: '', lastSyncAt: now });
    expect(await ensureSyncSchedule()).toBe(now + DAY);
  });

  it('finishing a run cannot replace the deadline already advanced by its alarm', async () => {
    await setSyncConfig(enabled); now = await ensureSyncSchedule();
    const stateBeforeClaim = await getSyncState(); const revision = await claimScheduledSync();
    const attempt = await beginSyncConnection(revision!);
    await finishSyncConnection(attempt!, true, '', { ...stateBeforeClaim, lastSyncAt: now });
    expect((await getSyncState()).nextSyncAt).toBe(now + DAY);
    expect(storage['sync.state']).not.toHaveProperty('nextSyncAt');
  });

  it('does not revive arbitrary legacy minute intervals or accept unknown schedule choices', async () => {
    await setSyncConfig({ ...enabled, intervalMinutes: 1 });
    expect(await getSyncConfig()).toMatchObject({ schedule: 'daily', intervalMinutes: 1440 });
    await expect(setSyncConfig({ schedule: 'every-minute' as 'daily' })).rejects.toThrow('Choose');
  });
});

import { ensureSyncSchedule } from './store';

export const SYNC_ALARM = 'locus-sync';
let alarmQueue: Promise<unknown> = Promise.resolve();

/** One-shot alarms mirror the persisted deadline; no save or wake-up runs sync. */
export function rescheduleSyncAlarm(): Promise<void> {
  const pending = alarmQueue.then(async () => {
    const nextSyncAt = await ensureSyncSchedule();
    const current = await chrome.alarms.get(SYNC_ALARM);
    if (nextSyncAt === 0) {
      if (current) await chrome.alarms.clear(SYNC_ALARM);
      return;
    }
    if (current && !current.periodInMinutes && current.scheduledTime === nextSyncAt) return;
    await chrome.alarms.clear(SYNC_ALARM);
    await chrome.alarms.create(SYNC_ALARM, { when: nextSyncAt });
  });
  alarmQueue = pending.catch(() => undefined);
  return pending;
}

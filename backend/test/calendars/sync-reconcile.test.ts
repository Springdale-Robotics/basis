import { describe, expect, it } from 'vitest';
import {
  missingEventInsideWindow,
  syncedEventUnchanged,
} from '../../src/modules/calendars/sync-reconcile.js';

/**
 * July 2026 review, calendar HIGH #6 / MEDIUM #7: the pull syncs deleted any
 * local synced row missing from the fetched window (purging history older
 * than 3 months on every run) and rewrote every event unconditionally
 * (revision/ETag churn + unbounded calendar_changes growth).
 */

const base = {
  title: 'Dentist',
  description: null,
  location: 'Main St',
  startTime: new Date('2026-07-10T10:00:00Z'),
  endTime: new Date('2026-07-10T11:00:00Z'),
  allDay: false,
  recurrenceRule: null,
  recurrenceStatus: null,
  recurringEventId: null,
  originalStartTime: null,
};

describe('syncedEventUnchanged', () => {
  it('is true for identical provider data', () => {
    expect(syncedEventUnchanged(base, { ...base })).toBe(true);
  });

  it('is true when Date instances differ but instants match', () => {
    expect(
      syncedEventUnchanged(base, {
        ...base,
        startTime: new Date('2026-07-10T10:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('is false when any synced field changes', () => {
    expect(syncedEventUnchanged(base, { ...base, title: 'Dentist (moved)' })).toBe(false);
    expect(
      syncedEventUnchanged(base, { ...base, startTime: new Date('2026-07-10T10:30:00Z') }),
    ).toBe(false);
    expect(syncedEventUnchanged(base, { ...base, location: null })).toBe(false);
  });
});

describe('missingEventInsideWindow', () => {
  const windowStart = new Date('2026-04-05T00:00:00Z'); // "3 months ago"
  const windowEnd = new Date('2027-07-05T00:00:00Z');

  it('protects events older than the window from deletion', () => {
    const old = {
      startTime: new Date('2025-12-01T10:00:00Z'),
      endTime: new Date('2025-12-01T11:00:00Z'),
    };
    expect(missingEventInsideWindow(old, windowStart, windowEnd)).toBe(false);
  });

  it('allows deletion of events inside the window', () => {
    const recent = {
      startTime: new Date('2026-06-01T10:00:00Z'),
      endTime: new Date('2026-06-01T11:00:00Z'),
    };
    expect(missingEventInsideWindow(recent, windowStart, windowEnd)).toBe(true);
  });

  it('treats a null window end as unbounded (Outlook)', () => {
    const future = {
      startTime: new Date('2028-01-01T10:00:00Z'),
      endTime: new Date('2028-01-01T11:00:00Z'),
    };
    expect(missingEventInsideWindow(future, windowStart, null)).toBe(true);
  });
});

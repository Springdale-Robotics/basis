import { describe, expect, it } from 'vitest';
import {
  expandRecurrence,
  isExcluded,
  findException,
} from '../../src/modules/calendars/recurrence.service.js';
import type { calendarEvents } from '../../src/db/schema/index.js';

type CalendarEvent = typeof calendarEvents.$inferSelect;

/**
 * July 2026 review, calendar HIGH #2: recurrence expanded with a UTC dtstart,
 * so a weekly Monday-evening event in a US timezone recurred on the wrong
 * local day and shifted an hour across DST. Expansion is now anchored to the
 * calendar's timezone.
 */

function makeMaster(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'master-1',
    calendarId: 'cal-1',
    title: 'Test event',
    startTime: new Date('2026-01-05T04:00:00Z'), // Mon 2026-01-05 20:00 PST
    endTime: new Date('2026-01-05T05:00:00Z'),
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    recurrenceExDates: null,
    recurrenceRDates: null,
    recurrenceStatus: 'master',
    ...overrides,
  } as CalendarEvent;
}

const LA = 'America/Los_Angeles';

describe('timezone-aware recurrence expansion', () => {
  it('weekly BYDAY=MO for a Monday-evening PST event recurs on Mondays local time', () => {
    // Mon 8 PM PST = Tue 04:00 UTC. A UTC expansion put these on UTC Mondays
    // (Sunday evening local); the tz-aware one must keep Monday 8 PM local.
    const master = makeMaster({});
    const instances = expandRecurrence(
      master,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
      [],
      LA,
    );

    expect(instances.length).toBeGreaterThanOrEqual(4);
    for (const inst of instances) {
      const local = new Intl.DateTimeFormat('en-US', {
        timeZone: LA,
        weekday: 'short',
        hour: '2-digit',
        hour12: false,
      }).formatToParts(inst.date);
      const parts = Object.fromEntries(local.map((p) => [p.type, p.value]));
      expect(parts.weekday).toBe('Mon');
      expect(parts.hour).toBe('20');
    }
  });

  it('keeps local wall-clock time across the spring DST transition', () => {
    // DST starts 2026-03-08 in the US. Expanding across it, occurrences must
    // stay at 20:00 local, which means the UTC instant shifts by an hour.
    const master = makeMaster({});
    const instances = expandRecurrence(
      master,
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-31T00:00:00Z'),
      [],
      LA,
    );

    expect(instances.length).toBeGreaterThanOrEqual(4);
    const utcHours = new Set(instances.map((i) => i.date.getUTCHours()));
    // Before DST: 04:00 UTC; after: 03:00 UTC — both present in March.
    expect(utcHours).toEqual(new Set([3, 4]));
    for (const inst of instances) {
      const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: LA,
        hour: '2-digit',
        hour12: false,
      }).format(inst.date);
      expect(hour).toBe('20');
    }
  });

  it('respects COUNT termination', () => {
    const master = makeMaster({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3' });
    const instances = expandRecurrence(
      master,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-06-01T00:00:00Z'),
      [],
      LA,
    );
    expect(instances).toHaveLength(3);
  });

  it('applies EXDATE by exact instant', () => {
    const master = makeMaster({
      // Exclude the second occurrence (Mon 2026-01-12 20:00 PST = 01-13 04:00 UTC)
      recurrenceExDates: JSON.stringify(['2026-01-13T04:00:00.000Z']),
    });
    const instances = expandRecurrence(
      master,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
      [],
      LA,
    );
    const times = instances.map((i) => i.date.toISOString());
    expect(times).not.toContain('2026-01-13T04:00:00.000Z');
    expect(times).toContain('2026-01-06T04:00:00.000Z');
  });

  it('attaches exceptions by exact original instant', () => {
    const exception = {
      id: 'ex-1',
      calendarId: 'cal-1',
      recurringEventId: 'master-1',
      originalStartTime: new Date('2026-01-13T04:00:00Z'),
      recurrenceStatus: 'exception',
      startTime: new Date('2026-01-13T06:00:00Z'),
      endTime: new Date('2026-01-13T07:00:00Z'),
      title: 'Moved occurrence',
    } as CalendarEvent;

    const master = makeMaster({});
    const instances = expandRecurrence(
      master,
      new Date('2026-01-10T00:00:00Z'),
      new Date('2026-01-20T00:00:00Z'),
      [exception],
      LA,
    );

    const modified = instances.find((i) => i.isException);
    expect(modified).toBeDefined();
    expect(modified!.exceptionEvent!.id).toBe('ex-1');
  });

  it('defaults to UTC-frame expansion when no timezone is passed', () => {
    const master = makeMaster({ recurrenceRule: 'FREQ=DAILY;COUNT=2' });
    const instances = expandRecurrence(
      master,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(instances.map((i) => i.date.toISOString())).toEqual([
      '2026-01-05T04:00:00.000Z',
      '2026-01-06T04:00:00.000Z',
    ]);
  });
});

describe('exclusion and exception matching helpers', () => {
  it('isExcluded matches exact instants and falls back to local day', () => {
    const occurrence = new Date('2026-01-13T04:00:00Z');
    expect(isExcluded(occurrence, [new Date('2026-01-13T04:00:00Z')], LA)).toBe(true);
    // Legacy exclusion recorded at a slightly different instant, same LA day
    expect(isExcluded(occurrence, [new Date('2026-01-13T03:00:00Z')], LA)).toBe(true);
    // Different LA day
    expect(isExcluded(occurrence, [new Date('2026-01-14T09:00:00Z')], LA)).toBe(false);
  });

  it('findException prefers exact-instant matches', () => {
    const mkEx = (id: string, original: string) =>
      ({ id, originalStartTime: new Date(original), recurrenceStatus: 'exception' }) as CalendarEvent;
    const sameDay = mkEx('day-match', '2026-01-13T02:00:00Z');
    const exact = mkEx('exact-match', '2026-01-13T04:00:00Z');
    const found = findException(new Date('2026-01-13T04:00:00Z'), [sameDay, exact], LA);
    expect(found!.id).toBe('exact-match');
  });
});

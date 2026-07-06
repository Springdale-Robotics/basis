import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendarEvents, calendars } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * July 2026 review, calendar usability HIGH #3 / MEDIUM #4: scope actions on
 * a previously-modified occurrence hit the exception row instead of the
 * master ("delete all" deleted one occurrence; "single" delete let the
 * occurrence reappear at its original time), and re-modifying an occurrence
 * 409'd on the duplicate exception insert.
 */

let ctx: RouteTestContext;
let user: TestUser;
let hhId: string;
let calendarId: string;

async function makeRecurringMaster(): Promise<string> {
  const [master] = await db
    .insert(calendarEvents)
    .values({
      calendarId,
      title: 'Weekly sync',
      startTime: new Date('2026-07-06T10:00:00Z'),
      endTime: new Date('2026-07-06T11:00:00Z'),
      recurrenceRule: 'FREQ=WEEKLY',
      recurrenceStatus: 'master',
      createdById: user.id,
    })
    .returning({ id: calendarEvents.id });
  return master.id;
}

async function makeException(masterId: string, originalStart: string): Promise<string> {
  const [ex] = await db
    .insert(calendarEvents)
    .values({
      calendarId,
      title: 'Weekly sync (moved)',
      startTime: new Date('2026-07-13T14:00:00Z'),
      endTime: new Date('2026-07-13T15:00:00Z'),
      recurringEventId: masterId,
      originalStartTime: new Date(originalStart),
      recurrenceStatus: 'exception',
      createdById: user.id,
    })
    .returning({ id: calendarEvents.id });
  return ex.id;
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  hhId = await ctx.createHousehold('Exception Scopes');
  user = await ctx.createUser(hhId, 'admin');
  const [cal] = await db
    .insert(calendars)
    .values({ householdId: hhId, name: 'Scopes', timezone: 'UTC', createdBy: user.id })
    .returning({ id: calendars.id });
  calendarId = cal.id;
});

afterAll(async () => {
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, calendarId));
  await db.delete(calendars).where(eq(calendars.id, calendarId));
  await ctx.close();
});

describe('scope actions on modified occurrences', () => {
  it('"all" delete on an exception row deletes the whole series', async () => {
    const masterId = await makeRecurringMaster();
    const exId = await makeException(masterId, '2026-07-13T10:00:00Z');

    const res = await user.fetch(`/api/v1/calendars/${calendarId}/events/${exId}`, {
      method: 'DELETE',
      body: JSON.stringify({ scope: 'all' }),
    });
    expect(res.status).toBe(200);

    const rows = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, masterId));
    expect(rows).toHaveLength(0);
  });

  it('"single" delete on an exception row EXDATEs the master so the slot stays gone', async () => {
    const masterId = await makeRecurringMaster();
    const exId = await makeException(masterId, '2026-07-13T10:00:00Z');

    const res = await user.fetch(`/api/v1/calendars/${calendarId}/events/${exId}`, {
      method: 'DELETE',
      body: JSON.stringify({ scope: 'single' }),
    });
    expect(res.status).toBe(200);

    // Exception row gone
    const exRows = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, exId));
    expect(exRows).toHaveLength(0);

    // Master survives with the occurrence excluded
    const [master] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, masterId));
    expect(master).toBeDefined();
    expect(master.recurrenceExDates).toContain('2026-07-13T10:00:00.000Z');
  });

  it('"single" edit of a modified occurrence updates the exception instead of 409ing', async () => {
    const masterId = await makeRecurringMaster();
    const exId = await makeException(masterId, '2026-07-13T10:00:00Z');

    const res = await user.fetch(`/api/v1/calendars/${calendarId}/events/${exId}`, {
      method: 'PATCH',
      body: JSON.stringify({ scope: 'single', title: 'Weekly sync (moved again)' }),
    });
    expect(res.status).toBe(200);

    // Still exactly one exception row for that occurrence, with the new title
    const exceptions = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.recurringEventId, masterId),
          eq(calendarEvents.originalStartTime, new Date('2026-07-13T10:00:00Z'))
        )
      );
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].title).toBe('Weekly sync (moved again)');
  });

  it('"all" edit anchored at an exception row updates the master', async () => {
    const masterId = await makeRecurringMaster();
    const exId = await makeException(masterId, '2026-07-13T10:00:00Z');

    const res = await user.fetch(`/api/v1/calendars/${calendarId}/events/${exId}`, {
      method: 'PATCH',
      body: JSON.stringify({ scope: 'all', title: 'Renamed series' }),
    });
    expect(res.status).toBe(200);

    const [master] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, masterId));
    expect(master.title).toBe('Renamed series');
  });

  it('POST exceptions upserts instead of conflicting on a second modification', async () => {
    const masterId = await makeRecurringMaster();
    const original = '2026-07-20T10:00:00.000Z';

    const first = await user.fetch(`/api/v1/calendars/${calendarId}/events/${masterId}/exceptions`, {
      method: 'POST',
      body: JSON.stringify({
        originalStartTime: original,
        startTime: '2026-07-20T12:00:00.000Z',
        endTime: '2026-07-20T13:00:00.000Z',
      }),
    });
    expect(first.status).toBe(200);

    const second = await user.fetch(`/api/v1/calendars/${calendarId}/events/${masterId}/exceptions`, {
      method: 'POST',
      body: JSON.stringify({
        originalStartTime: original,
        startTime: '2026-07-20T15:00:00.000Z',
        endTime: '2026-07-20T16:00:00.000Z',
      }),
    });
    expect(second.status).toBe(200);

    const exceptions = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.recurringEventId, masterId),
          eq(calendarEvents.originalStartTime, new Date(original))
        )
      );
    expect(exceptions).toHaveLength(1);
    expect(new Date(exceptions[0].startTime).toISOString()).toBe('2026-07-20T15:00:00.000Z');
  });
});

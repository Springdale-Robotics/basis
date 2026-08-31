import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendarEvents, calendars } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * 2026-08-31 amendment to the phase 2 plan: per-occurrence editing of a
 * synced series stays out of scope, and now explicitly includes
 * EXDATE-on-master. Rather than accepting a single-occurrence edit/delete
 * locally and letting it sit undeliverable (silent divergence from every
 * device reading Google), the routes that perform per-occurrence writes
 * refuse them outright on a synced calendar. That's the three sites the
 * amendment names by line number (update scope=single, delete scope=single,
 * cancel-instance) plus a fourth found while implementing it: POST
 * .../events/:id/exceptions, which is what the frontend's drag-to-reschedule
 * and "cancel just this one" actions actually call (CalendarPage.tsx) — same
 * exception-row shape, same risk, same guard.
 *
 * The guard fires on `calendar.isSynced`, not `isReadOnly` — isReadOnly is
 * expected to flip to false once a later task unlocks writes to synced
 * calendars, and this refusal must survive that. Each fixture below sets
 * isReadOnly: false explicitly to prove the guard doesn't depend on it.
 *
 * Per-test calendars, primary-key lookups throughout (basis#112: a suite
 * that passes for the wrong reason via an orphaned fixture row).
 */

let ctx: RouteTestContext;
let user: TestUser;
let hhId: string;
let syncedCalendarId: string;
let localCalendarId: string;

async function makeRecurringMaster(calendarId: string): Promise<string> {
  const [master] = await db
    .insert(calendarEvents)
    .values({
      calendarId,
      title: 'Weekly sync',
      startTime: new Date('2026-09-07T10:00:00Z'),
      endTime: new Date('2026-09-07T11:00:00Z'),
      recurrenceRule: 'FREQ=WEEKLY',
      recurrenceStatus: 'master',
      createdById: user.id,
    })
    .returning({ id: calendarEvents.id });
  return master.id;
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  hhId = await ctx.createHousehold('Single Occurrence Refusal');
  user = await ctx.createUser(hhId, 'admin');

  const [synced] = await db
    .insert(calendars)
    .values({
      householdId: hhId,
      name: 'Synced (Google)',
      timezone: 'UTC',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'fixture@group.calendar.google.com',
    })
    .returning({ id: calendars.id });
  syncedCalendarId = synced.id;

  const [local] = await db
    .insert(calendars)
    .values({
      householdId: hhId,
      name: 'Local',
      timezone: 'UTC',
      type: 'individual',
      isSynced: false,
      isReadOnly: false,
    })
    .returning({ id: calendars.id });
  localCalendarId = local.id;
});

afterAll(async () => {
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, syncedCalendarId));
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, localCalendarId));
  await db.delete(calendars).where(eq(calendars.id, syncedCalendarId));
  await db.delete(calendars).where(eq(calendars.id, localCalendarId));
  await ctx.close();
});

describe('single-occurrence writes on a synced calendar', () => {
  it('PATCH .../events/:id scope=single is refused', async () => {
    const masterId = await makeRecurringMaster(syncedCalendarId);

    const res = await user.fetch(`/api/v1/calendars/${syncedCalendarId}/events/${masterId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        scope: 'single',
        originalStartTime: '2026-09-14T10:00:00Z',
        title: 'Moved',
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toMatch(/repeating event/i);
    expect(body.error.message).toMatch(/whole series|disconnect/i);

    // No exception row should have been created.
    const exceptions = await db.query.calendarEvents.findMany({
      where: eq(calendarEvents.recurringEventId, masterId),
    });
    expect(exceptions).toHaveLength(0);
  });

  it('DELETE .../events/:id scope=single is refused', async () => {
    const masterId = await makeRecurringMaster(syncedCalendarId);

    const res = await user.fetch(`/api/v1/calendars/${syncedCalendarId}/events/${masterId}`, {
      method: 'DELETE',
      body: JSON.stringify({ scope: 'single', originalStartTime: '2026-09-14T10:00:00Z' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toMatch(/repeating event/i);

    // Master must be untouched: no EXDATE written.
    const master = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, masterId),
    });
    expect(master?.recurrenceExDates ?? null).toBeNull();
  });

  it('DELETE .../events/:id/instances/:originalStartTime (cancel) is refused', async () => {
    const masterId = await makeRecurringMaster(syncedCalendarId);

    const res = await user.fetch(
      `/api/v1/calendars/${syncedCalendarId}/events/${masterId}/instances/2026-09-14T10:00:00.000Z`,
      { method: 'DELETE' }
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toMatch(/repeating event/i);

    const master = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, masterId),
    });
    expect(master?.recurrenceExDates ?? null).toBeNull();
  });

  it('POST .../events/:id/exceptions (drag/cancel-one-occurrence) is refused', async () => {
    const masterId = await makeRecurringMaster(syncedCalendarId);

    const res = await user.fetch(`/api/v1/calendars/${syncedCalendarId}/events/${masterId}/exceptions`, {
      method: 'POST',
      body: JSON.stringify({ originalStartTime: '2026-09-14T10:00:00Z', cancelled: true }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toMatch(/repeating event/i);

    const exceptions = await db.query.calendarEvents.findMany({
      where: eq(calendarEvents.recurringEventId, masterId),
    });
    expect(exceptions).toHaveLength(0);
  });
});

describe('single-occurrence writes on a local (non-synced) calendar are unaffected', () => {
  it('PATCH .../events/:id scope=single still creates an exception', async () => {
    const masterId = await makeRecurringMaster(localCalendarId);

    const res = await user.fetch(`/api/v1/calendars/${localCalendarId}/events/${masterId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        scope: 'single',
        originalStartTime: '2026-09-14T10:00:00Z',
        title: 'Moved',
      }),
    });

    expect(res.status).toBe(200);
    const exceptions = await db.query.calendarEvents.findMany({
      where: eq(calendarEvents.recurringEventId, masterId),
    });
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].title).toBe('Moved');
  });

  it('DELETE .../events/:id scope=single still adds an EXDATE', async () => {
    const masterId = await makeRecurringMaster(localCalendarId);

    const res = await user.fetch(`/api/v1/calendars/${localCalendarId}/events/${masterId}`, {
      method: 'DELETE',
      body: JSON.stringify({ scope: 'single', originalStartTime: '2026-09-14T10:00:00Z' }),
    });

    expect(res.status).toBe(200);
    const master = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, masterId),
    });
    expect(master?.recurrenceExDates).toContain('2026-09-14');
  });

  it('DELETE .../events/:id/instances/:originalStartTime (cancel) still adds an EXDATE', async () => {
    const masterId = await makeRecurringMaster(localCalendarId);

    const res = await user.fetch(
      `/api/v1/calendars/${localCalendarId}/events/${masterId}/instances/2026-09-14T10:00:00.000Z`,
      { method: 'DELETE' }
    );

    expect(res.status).toBe(200);
    const master = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, masterId),
    });
    expect(master?.recurrenceExDates).toContain('2026-09-14');
  });

  it('POST .../events/:id/exceptions (drag/cancel-one-occurrence) still creates an exception', async () => {
    const masterId = await makeRecurringMaster(localCalendarId);

    const res = await user.fetch(`/api/v1/calendars/${localCalendarId}/events/${masterId}/exceptions`, {
      method: 'POST',
      body: JSON.stringify({ originalStartTime: '2026-09-14T10:00:00Z', cancelled: true }),
    });

    expect(res.status).toBe(200);
    const exceptions = await db.query.calendarEvents.findMany({
      where: eq(calendarEvents.recurringEventId, masterId),
    });
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].recurrenceStatus).toBe('cancelled');
  });
});

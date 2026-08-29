import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  calendarChanges,
  calendarEvents,
  calendars,
  households,
} from '../../src/db/schema/index.js';

let householdId: string;
let calendarId: string;

beforeAll(async () => {
  const [household] = await db
    .insert(households)
    .values({ name: `trigger-test-${randomUUID()}` })
    .returning();
  householdId = household.id;

  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Trigger fixture',
      type: 'synced',
      isSynced: true,
      syncProvider: 'google',
      syncCalendarId: 'fixture@group.calendar.google.com',
    })
    .returning();
  calendarId = calendar.id;
});

afterAll(async () => {
  // Delete any events left over from tests that don't clean up after
  // themselves (the remote_updated-only and real-field-change tests don't
  // delete their fixture events) before deleting the household. Deleting the
  // household cascades to calendars, which cascades to calendar_events, and
  // that concurrent two-level cascade hits a pre-existing bug in the DELETE
  // trigger (unrelated to this task's changes, reproduced against the
  // original 0004 function too): the trigger's UPDATE against the
  // already-cascade-deleted calendars row returns no sync_token, so the
  // calendar_changes insert violates its NOT NULL constraint. Deleting events
  // up front, while the calendar row still exists, avoids that race.
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, calendarId));
  await db.delete(households).where(eq(households.id, householdId));
});

async function makeEvent(externalId: string | null) {
  const [event] = await db
    .insert(calendarEvents)
    .values({
      calendarId,
      title: 'Fixture',
      startTime: new Date('2026-09-01T10:00:00Z'),
      endTime: new Date('2026-09-01T11:00:00Z'),
      externalId,
    })
    .returning();
  return event;
}

describe('calendar triggers and remote_updated', () => {
  it('ignores a remote_updated-only update: no revision bump, no journal row', async () => {
    const event = await makeEvent('google-event-1');
    const before = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    const journalBefore = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendarId));

    await db
      .update(calendarEvents)
      .set({ remoteUpdated: new Date('2026-08-28T12:00:00Z') })
      .where(eq(calendarEvents.id, event.id));

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    const calAfter = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    const journalAfter = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendarId));

    expect(after!.revision).toBe(event.revision);
    expect(calAfter!.syncToken).toBe(before!.syncToken);
    expect(calAfter!.ctag).toBe(before!.ctag);
    expect(journalAfter.length).toBe(journalBefore.length);
  });

  it('still bumps revision when a real field changes alongside remote_updated', async () => {
    const event = await makeEvent('google-event-2');

    await db
      .update(calendarEvents)
      .set({ title: 'Changed', remoteUpdated: new Date('2026-08-28T12:00:00Z') })
      .where(eq(calendarEvents.id, event.id));

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    expect(after!.revision).toBeGreaterThan(event.revision);
  });

  it('captures external_id onto the journal row when an event is deleted', async () => {
    const event = await makeEvent('google-event-3');

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const [row] = await db
      .select()
      .from(calendarChanges)
      .where(
        and(eq(calendarChanges.calendarId, calendarId), eq(calendarChanges.changeType, 'delete'))
      )
      .orderBy(desc(calendarChanges.syncToken))
      .limit(1);

    expect(row.externalId).toBe('google-event-3');
  });

  it('leaves external_id null on the journal row for a local-only event', async () => {
    const event = await makeEvent(null);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const [row] = await db
      .select()
      .from(calendarChanges)
      .where(
        and(eq(calendarChanges.calendarId, calendarId), eq(calendarChanges.changeType, 'delete'))
      )
      .orderBy(desc(calendarChanges.syncToken))
      .limit(1);

    expect(row.externalId).toBeNull();
  });

  it('has an outbound cursor on every calendar, starting at zero', async () => {
    const calendar = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    expect(calendar!.outboundCursor).toBe(0);
  });
});

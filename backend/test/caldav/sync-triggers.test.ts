import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { setupCalDavTest, type CalDavTestContext } from './harness.js';
import { db } from '../../src/config/database.js';
import { calendarChanges, calendarEvents, calendars } from '../../src/db/schema/index.js';

let ctx: CalDavTestContext;

beforeAll(async () => {
  ctx = await setupCalDavTest();
});

afterAll(async () => {
  await ctx?.close();
});

describe('CalDAV sync triggers (Phase 3c)', () => {
  it('bumps syncToken and writes a change journal entry on INSERT', async () => {
    const before = await db.query.calendars.findFirst({
      where: eq(calendars.id, ctx.calendarId),
      columns: { syncToken: true, ctag: true },
    });
    const beforeToken = before?.syncToken ?? 0;

    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'Trigger smoke test',
        startTime: new Date('2026-06-01T12:00:00Z'),
        endTime: new Date('2026-06-01T13:00:00Z'),
      })
      .returning();

    const after = await db.query.calendars.findFirst({
      where: eq(calendars.id, ctx.calendarId),
      columns: { syncToken: true, ctag: true },
    });
    expect(after?.syncToken).toBe(beforeToken + 1);
    expect(after?.ctag).toBeTruthy();
    expect(after?.ctag).not.toBe(before?.ctag);

    const entries = await db.query.calendarChanges.findMany({
      where: and(
        eq(calendarChanges.calendarId, ctx.calendarId),
        eq(calendarChanges.syncToken, after!.syncToken)
      ),
      orderBy: [asc(calendarChanges.createdAt)],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].changeType).toBe('add');
    expect(entries[0].eventUid).toBe(event.id);

    // Cleanup
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('bumps event revision on UPDATE', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'Revision smoke',
        startTime: new Date('2026-06-01T14:00:00Z'),
        endTime: new Date('2026-06-01T15:00:00Z'),
      })
      .returning();
    expect(event.revision).toBe(1);

    const [updated] = await db
      .update(calendarEvents)
      .set({ title: 'Revision smoke v2' })
      .where(eq(calendarEvents.id, event.id))
      .returning();
    expect(updated.revision).toBe(2);

    const [updated2] = await db
      .update(calendarEvents)
      .set({ title: 'Revision smoke v3' })
      .where(eq(calendarEvents.id, event.id))
      .returning();
    expect(updated2.revision).toBe(3);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('records a delete entry on DELETE with the parent UID', async () => {
    const [master] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'Series master',
        startTime: new Date('2026-06-02T10:00:00Z'),
        endTime: new Date('2026-06-02T11:00:00Z'),
        recurrenceStatus: 'master',
        recurrenceRule: 'FREQ=DAILY;COUNT=3',
      })
      .returning();
    const [exception] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'Series exception',
        startTime: new Date('2026-06-03T10:00:00Z'),
        endTime: new Date('2026-06-03T11:00:00Z'),
        recurrenceStatus: 'exception',
        recurringEventId: master.id,
        originalStartTime: new Date('2026-06-03T10:00:00Z'),
      })
      .returning();

    // Both INSERTs should journal under the master UID (the resource URL).
    const recent = await db.query.calendarChanges.findMany({
      where: and(
        eq(calendarChanges.calendarId, ctx.calendarId),
        eq(calendarChanges.eventUid, master.id)
      ),
      orderBy: [asc(calendarChanges.syncToken)],
    });
    // Expect at least one 'add' entry per row (master + exception both reference master.id).
    const addEntries = recent.filter((e) => e.changeType === 'add');
    expect(addEntries.length).toBeGreaterThanOrEqual(2);

    // Delete the master — cascade deletes the exception. Both should journal.
    await db.delete(calendarEvents).where(eq(calendarEvents.id, master.id));
    const finalEntries = await db.query.calendarChanges.findMany({
      where: and(
        eq(calendarChanges.calendarId, ctx.calendarId),
        eq(calendarChanges.changeType, 'delete')
      ),
    });
    expect(finalEntries.some((e) => e.eventUid === master.id)).toBe(true);
    expect(exception.id).toBeTruthy(); // mute unused
  });
});

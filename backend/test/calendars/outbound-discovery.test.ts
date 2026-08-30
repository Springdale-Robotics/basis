import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendarEvents, calendars, households } from '../../src/db/schema/index.js';
import {
  findCreates,
  findDeletes,
  findUpdates,
  isOutboundCalendar,
} from '../../src/modules/calendars/outbound-discovery.js';

let householdId: string;
let calendarId: string;
// A second synced Google calendar in the same household. Every discovery
// query must be scoped to calendarId — workers run as the DB owner and
// bypass RLS, so nothing else narrows the result set. These fixtures exist
// so a missing eq(calendarId) filter is caught by cross-contamination, not
// just by the single-calendar assertions above (which pass either way).
let otherCalendarId: string;

beforeAll(async () => {
  const [household] = await db
    .insert(households)
    .values({ name: `discovery-${randomUUID()}` })
    .returning();
  householdId = household.id;

  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Discovery fixture',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'fixture@group.calendar.google.com',
    })
    .returning();
  calendarId = calendar.id;

  const [otherCalendar] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Discovery fixture (other calendar)',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'other-fixture@group.calendar.google.com',
    })
    .returning();
  otherCalendarId = otherCalendar.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

const times = {
  startTime: new Date('2026-09-01T10:00:00Z'),
  endTime: new Date('2026-09-01T11:00:00Z'),
};

describe('findCreates', () => {
  it('finds rows that have never been to Google', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Never synced', ...times, externalId: null })
      .returning();

    const creates = await findCreates(calendarId);
    expect(creates.map((e) => e.id)).toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('ignores rows that already have a Google id', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Already there', ...times, externalId: 'g-99' })
      .returning();

    const creates = await findCreates(calendarId);
    expect(creates.map((e) => e.id)).not.toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });
});

describe('findUpdates', () => {
  it('finds a row edited since Google last saw it', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Edited locally',
        ...times,
        externalId: 'g-100',
        remoteUpdated: new Date('2026-08-28T10:00:00Z'),
        updatedAt: new Date('2026-08-28T11:00:00Z'),
      })
      .returning();

    const updates = await findUpdates(calendarId);
    expect(updates.map((e) => e.id)).toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('ignores a row Google has seen since its last local edit', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Google is current',
        ...times,
        externalId: 'g-101',
        remoteUpdated: new Date('2026-08-28T12:00:00Z'),
        updatedAt: new Date('2026-08-28T11:00:00Z'),
      })
      .returning();

    const updates = await findUpdates(calendarId);
    expect(updates.map((e) => e.id)).not.toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('ignores a row with a null remote_updated — that is a create, not an update', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'No provider stamp',
        ...times,
        externalId: 'g-102',
        remoteUpdated: null,
      })
      .returning();

    const updates = await findUpdates(calendarId);
    expect(updates.map((e) => e.id)).not.toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });
});

describe('findDeletes', () => {
  it('returns journal deletes after the cursor, carrying the Google id', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'To delete', ...times, externalId: 'g-200' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const deletes = await findDeletes(calendarId, 0);
    expect(deletes.some((d) => d.externalId === 'g-200')).toBe(true);
  });

  it('respects the cursor', async () => {
    const deletes = await findDeletes(calendarId, 1_000_000);
    expect(deletes).toEqual([]);
  });

  it('excludes a delete once the cursor is advanced to its own syncToken', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'To delete (boundary)', ...times, externalId: 'g-201' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const beforeAdvance = await findDeletes(calendarId, 0);
    const row = beforeAdvance.find((d) => d.externalId === 'g-201');
    expect(row).toBeDefined();

    // Cursor advanced past this row's own token — a gt->gte regression at
    // the boundary would re-return it here.
    const afterAdvance = await findDeletes(calendarId, row!.syncToken);
    expect(afterAdvance.some((d) => d.externalId === 'g-201')).toBe(false);
  });
});

describe('calendar scoping', () => {
  it('findCreates ignores rows belonging to a different calendar', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: otherCalendarId,
        title: 'Never synced, wrong calendar',
        ...times,
        externalId: null,
      })
      .returning();

    const creates = await findCreates(calendarId);
    expect(creates.map((e) => e.id)).not.toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('findUpdates ignores rows belonging to a different calendar', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: otherCalendarId,
        title: 'Edited locally, wrong calendar',
        ...times,
        externalId: 'g-900',
        remoteUpdated: new Date('2026-08-28T10:00:00Z'),
        updatedAt: new Date('2026-08-28T11:00:00Z'),
      })
      .returning();

    const updates = await findUpdates(calendarId);
    expect(updates.map((e) => e.id)).not.toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('findDeletes ignores journal rows belonging to a different calendar', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: otherCalendarId,
        title: 'To delete, wrong calendar',
        ...times,
        externalId: 'g-901',
      })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const deletes = await findDeletes(calendarId, 0);
    expect(deletes.some((d) => d.externalId === 'g-901')).toBe(false);

    // Confirm the row really was journaled — just under the other calendar —
    // so this test is proving scoping, not that the delete never happened.
    const otherDeletes = await findDeletes(otherCalendarId, 0);
    expect(otherDeletes.some((d) => d.externalId === 'g-901')).toBe(true);
  });
});

describe('isOutboundCalendar', () => {
  it('accepts a writable synced Google calendar', () => {
    expect(
      isOutboundCalendar({
        isSynced: true,
        isReadOnly: false,
        syncProvider: 'google',
      } as never)
    ).toBe(true);
  });

  it.each([
    [{ isSynced: true, isReadOnly: false, syncProvider: 'outlook' }, 'outlook has no outbound path'],
    [{ isSynced: true, isReadOnly: true, syncProvider: 'google' }, 'still read-only'],
    [{ isSynced: false, isReadOnly: false, syncProvider: 'google' }, 'not synced'],
  ])('rejects %o (%s)', (calendar) => {
    expect(isOutboundCalendar(calendar as never)).toBe(false);
  });
});

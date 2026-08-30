import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

/**
 * Task 2 of the Google Calendar sync engine (phase 2): echo suppression on
 * the pull.
 *
 * echo-suppression.test.ts proves the *decision function* (syncedEventUnchanged)
 * treats a matching remote_updated as "unchanged" and a differing one as
 * "changed". That is necessary but not sufficient: it says nothing about
 * what actually happens at the database when a real pull runs against a row
 * where only Google's `updated` stamp moved (a change to a field Basis
 * doesn't mirror — an attendee RSVP, a color, a reminder). In that case
 * syncedEventUnchanged correctly returns false (remote_updated differs), so
 * the pull does execute `.set(eventData)` — and the only thing this test
 * file exists to check is what the *trigger* does with that write.
 *
 * This exercises the real `syncCalendarFromGoogle`, mocked one layer below
 * at the googleapis client (same technique as
 * google-sync-refresh-failure.test.ts), against the real Postgres triggers
 * from drizzle/0018_calendar_outbound_sync.sql. No triggers are mocked.
 */

const eventsList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(): void {}
        generateAuthUrl(): string {
          return '';
        }
      },
    },
    calendar: vi.fn(() => ({
      events: { list: eventsList },
    })),
  },
}));

process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-google-client-secret';

const { syncCalendarFromGoogle } = await import('../../src/modules/calendars/google-sync.service.js');
const { encrypt } = await import('../../src/lib/crypto.js');
const { db } = await import('../../src/config/database.js');
const { calendars, calendarEvents, calendarChanges, households } = await import(
  '../../src/db/schema/index.js'
);

let hhId: string;

function freshCredentials(): string {
  return encrypt(
    JSON.stringify({
      access_token: 'valid-access-token',
      refresh_token: 'valid-refresh-token',
      // Far enough out that syncCalendarFromGoogle never takes the refresh
      // branch — refreshAccessToken is deliberately not even stubbed above.
      expiry_date: Date.now() + 60 * 60 * 1000,
    })
  );
}

async function makeSyncedCalendar() {
  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId: hhId,
      name: `Echo Pull Test ${randomUUID().slice(0, 8)}`,
      type: 'synced',
      timezone: 'UTC',
      isSynced: true,
      syncProvider: 'google',
      syncCalendarId: 'primary',
      syncCredentials: freshCredentials(),
    })
    .returning();
  return calendar;
}

function mockGoogleResponse(items: Record<string, unknown>[]): void {
  eventsList.mockResolvedValue({ data: { items, nextPageToken: undefined } });
}

beforeAll(async () => {
  hhId = randomUUID();
  await db.insert(households).values({ id: hhId, name: `Echo Pull Household ${hhId.slice(0, 8)}` });
});

afterAll(async () => {
  // Same pre-existing DELETE-trigger/cascade race documented in
  // outbound-triggers.test.ts: delete calendar_events up front, while their
  // calendars row still exists, before letting the household cascade take
  // the rest.
  const householdCalendars = await db.query.calendars.findMany({ where: eq(calendars.householdId, hhId) });
  for (const calendar of householdCalendars) {
    await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, calendar.id));
  }
  await db.delete(calendars).where(eq(calendars.householdId, hhId));
  await db.delete(households).where(eq(households.id, hhId));
});

afterEach(() => {
  eventsList.mockReset();
});

describe('syncCalendarFromGoogle: echo suppression against real triggers', () => {
  it('a pull where only remote_updated moves does not bump revision, does not journal, does not reroll ctag/syncToken', async () => {
    const calendar = await makeSyncedCalendar();

    const startTime = new Date('2026-09-01T09:00:00Z');
    const endTime = new Date('2026-09-01T09:15:00Z');
    const firstStamp = new Date('2026-08-28T12:00:00Z');
    const localEditStamp = new Date('2026-08-29T08:00:00Z');

    // Seed a row exactly as an earlier pull (or a push, in a later task)
    // would have left it: fields matching what Google will return, and
    // updatedAt already ahead of remote_updated — as a genuine local edit
    // that Google has not seen yet would leave it. That local-edit stamp is
    // the thing this test must find undisturbed at the end: the pull must
    // not touch updatedAt.
    const [existing] = await db
      .insert(calendarEvents)
      .values({
        calendarId: calendar.id,
        title: 'Standup',
        description: null,
        location: null,
        startTime,
        endTime,
        allDay: false,
        externalId: 'g-echo-1',
        remoteUpdated: firstStamp,
        updatedAt: localEditStamp,
      })
      .returning();

    // Google returns the identical event — same title/time/etc — but with a
    // newer `updated` stamp, as if something Basis doesn't mirror (e.g. an
    // attendee) changed over there.
    mockGoogleResponse([
      {
        id: 'g-echo-1',
        summary: 'Standup',
        start: { dateTime: startTime.toISOString() },
        end: { dateTime: endTime.toISOString() },
        updated: '2026-08-30T00:00:00.000Z',
      },
    ]);

    const calendarBefore = await db.query.calendars.findFirst({ where: eq(calendars.id, calendar.id) });
    const journalBefore = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendar.id));

    await syncCalendarFromGoogle(calendar.id, hhId);

    const after = await db.query.calendarEvents.findFirst({ where: eq(calendarEvents.id, existing.id) });
    const calendarAfter = await db.query.calendars.findFirst({ where: eq(calendars.id, calendar.id) });
    const journalAfter = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendar.id));

    // The write did happen — remote_updated moved to Google's new stamp.
    expect(after!.remoteUpdated?.toISOString()).toBe('2026-08-30T00:00:00.000Z');

    // But nothing a CalDAV client could observe changed.
    expect(after!.revision).toBe(existing.revision);
    expect(calendarAfter!.syncToken).toBe(calendarBefore!.syncToken);
    expect(calendarAfter!.ctag).toBe(calendarBefore!.ctag);
    expect(journalAfter.length).toBe(journalBefore.length);

    // And updated_at — the local-edit marker a later task's outbound sweep
    // reads — is exactly where the pre-existing local edit left it. If the
    // pull's update had set updatedAt (out of habit, or because eventData
    // carried it), this would have moved to "now" and the row would look
    // freshly locally edited.
    expect(after!.updatedAt.toISOString()).toBe(localEditStamp.toISOString());
  });

  it('a freshly pulled event has updatedAt pinned to remote_updated, not now()', async () => {
    const calendar = await makeSyncedCalendar();

    const startTime = new Date('2026-09-05T09:00:00Z');
    const endTime = new Date('2026-09-05T09:30:00Z');
    const googleStamp = '2026-01-15T00:00:00.000Z'; // long in the past

    mockGoogleResponse([
      {
        id: 'g-echo-new-1',
        summary: 'New from Google',
        start: { dateTime: startTime.toISOString() },
        end: { dateTime: endTime.toISOString() },
        updated: googleStamp,
      },
    ]);

    await syncCalendarFromGoogle(calendar.id, hhId);

    // Scoped to this test's own calendar: an unscoped lookup by externalId
    // alone can match a leftover fixture row from another test run (e.g. one
    // whose afterAll never got a chance to clean up), silently hiding a
    // regression behind stale data with coincidentally-correct values.
    const inserted = await db.query.calendarEvents.findFirst({
      where: and(eq(calendarEvents.calendarId, calendar.id), eq(calendarEvents.externalId, 'g-echo-new-1')),
    });

    expect(inserted).toBeTruthy();
    expect(inserted!.remoteUpdated?.toISOString()).toBe(googleStamp);
    // The invariant this whole task exists to establish:
    // updated_at > remote_updated  =>  locally edited since Google last saw it.
    // Left at the insert's now() default, this freshly pulled event's
    // updatedAt would sit far after remoteUpdated and look locally edited,
    // and a later task's outbound sweep would push it straight back.
    expect(inserted!.updatedAt.toISOString()).toBe(googleStamp);
    expect(inserted!.updatedAt.getTime()).not.toBeGreaterThan(inserted!.remoteUpdated!.getTime());
  });

  it('a real field change alongside a moved remote_updated still bumps revision and journals (the guard is not too aggressive)', async () => {
    const calendar = await makeSyncedCalendar();

    const startTime = new Date('2026-09-02T09:00:00Z');
    const endTime = new Date('2026-09-02T09:15:00Z');
    const firstStamp = new Date('2026-08-28T12:00:00Z');

    const [existing] = await db
      .insert(calendarEvents)
      .values({
        calendarId: calendar.id,
        title: 'Standup',
        description: null,
        location: null,
        startTime,
        endTime,
        allDay: false,
        externalId: 'g-echo-2',
        remoteUpdated: firstStamp,
      })
      .returning();

    mockGoogleResponse([
      {
        id: 'g-echo-2',
        summary: 'Standup (renamed)',
        start: { dateTime: startTime.toISOString() },
        end: { dateTime: endTime.toISOString() },
        updated: '2026-08-30T00:00:00.000Z',
      },
    ]);

    const calendarBefore = await db.query.calendars.findFirst({ where: eq(calendars.id, calendar.id) });
    const journalBefore = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendar.id));

    await syncCalendarFromGoogle(calendar.id, hhId);

    const after = await db.query.calendarEvents.findFirst({ where: eq(calendarEvents.id, existing.id) });
    const calendarAfter = await db.query.calendars.findFirst({ where: eq(calendars.id, calendar.id) });
    const journalAfter = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendar.id));

    expect(after!.title).toBe('Standup (renamed)');
    expect(after!.revision).toBeGreaterThan(existing.revision);
    expect(calendarAfter!.syncToken).toBeGreaterThan(calendarBefore!.syncToken);
    expect(calendarAfter!.ctag).not.toBe(calendarBefore!.ctag);
    expect(journalAfter.length).toBe(journalBefore.length + 1);
  });
});

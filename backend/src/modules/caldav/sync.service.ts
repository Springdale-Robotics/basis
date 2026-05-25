import { randomBytes } from 'crypto';
import { eq, gt, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  calendarChanges,
  calendarEvents,
  calendars,
  type CalendarChange,
  type CalendarChangeType,
} from '../../db/schema/index.js';

/**
 * Bump a calendar's sync state in response to an event mutation.
 *
 * Caller is expected to have already written the event change to the DB
 * (or to be about to delete it). This:
 *   1. Atomically increments the calendar's syncToken
 *   2. Sets a fresh ctag (legacy-compat collection version token)
 *   3. Appends an entry to the calendar_changes journal so future
 *      sync-collection REPORTs can replay the change
 *
 * `eventUid` is the iCalendar UID — i.e. the event resource's URL slug in
 * CalDAV — not the internal DB id. Stable across master + exception rows.
 */
export async function bumpCalendarChange(
  calendarId: string,
  eventUid: string,
  changeType: CalendarChangeType
): Promise<{ syncToken: number; ctag: string }> {
  const ctag = randomBytes(8).toString('hex');
  const [row] = await db
    .update(calendars)
    .set({
      syncToken: sql`${calendars.syncToken} + 1`,
      ctag,
      updatedAt: new Date(),
    })
    .where(eq(calendars.id, calendarId))
    .returning({ syncToken: calendars.syncToken });
  if (!row) {
    throw new Error(`bumpCalendarChange: calendar ${calendarId} not found`);
  }
  await db.insert(calendarChanges).values({
    calendarId,
    eventUid,
    changeType,
    syncToken: row.syncToken,
  });
  return { syncToken: row.syncToken, ctag };
}

/**
 * Bump the event's revision counter — the input for ETag derivation.
 * Format: "<eventId>-<revision>". Each PUT bumps revision; clients use the
 * tag in If-Match preconditions to detect concurrent overwrites.
 */
export async function bumpEventRevision(eventId: string): Promise<number> {
  const [row] = await db
    .update(calendarEvents)
    .set({ revision: sql`${calendarEvents.revision} + 1`, updatedAt: new Date() })
    .where(eq(calendarEvents.id, eventId))
    .returning({ revision: calendarEvents.revision });
  if (!row) {
    throw new Error(`bumpEventRevision: event ${eventId} not found`);
  }
  return row.revision;
}

export function eventEtag(eventId: string, revision: number): string {
  return `"${eventId}-${revision}"`;
}

/**
 * Replay calendar_changes entries since the client's last seen syncToken.
 * Returns adds/updates/deletes in order. Empty array means the client is
 * already up to date.
 *
 * Note: if the same UID appears multiple times (add then update etc.), the
 * REPORT handler will collapse to the latest state. We keep the raw journal
 * here so the handler has full information.
 */
export async function listChangesSince(
  calendarId: string,
  sinceSyncToken: number
): Promise<CalendarChange[]> {
  return db.query.calendarChanges.findMany({
    where: (c, { and, eq: eqOp }) =>
      and(eqOp(c.calendarId, calendarId), gt(c.syncToken, sinceSyncToken)),
    orderBy: (c, { asc }) => [asc(c.syncToken)],
  });
}

/**
 * Current sync state of a calendar, as needed by PROPFIND `getctag` and
 * `sync-token` properties. Lazily fills in ctag on first read for any
 * calendar that predates this schema.
 */
export async function getCalendarSyncState(calendarId: string): Promise<{
  syncToken: number;
  ctag: string;
}> {
  const cal = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
    columns: { syncToken: true, ctag: true },
  });
  if (!cal) throw new Error(`Calendar ${calendarId} not found`);
  if (cal.ctag) return { syncToken: cal.syncToken, ctag: cal.ctag };
  // Backfill — first read after schema add.
  const ctag = randomBytes(8).toString('hex');
  await db.update(calendars).set({ ctag }).where(eq(calendars.id, calendarId));
  return { syncToken: cal.syncToken, ctag };
}

import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { calendarChanges, calendarEvents } from '../../db/schema/index.js';
import type { Calendar, CalendarEvent } from '../../db/schema/calendars.js';

/**
 * What a synced calendar owes its provider, derived from state rather than
 * from hooks on the routes that write events.
 *
 * The routes are the wrong place. Basis has three write paths into
 * calendar_events — the REST routes (~20 direct writes in
 * calendars.routes.ts), CalDAV (events.service.ts and the DELETE handler),
 * and the pull itself — and they share no service layer to hang a hook on.
 * basis#101 is what that costs: a check added to one path and missed on
 * another. State cannot be missed. A row with no external_id has never been
 * to Google no matter who wrote it.
 *
 * Deletes are the one thing state cannot express, because the row is gone.
 * Those come off the calendar_changes journal, which the Postgres trigger
 * writes for every path equally.
 */

/** Only a writable, synced, Google calendar has anywhere to push to. */
export function isOutboundCalendar(calendar: Calendar): boolean {
  return (
    calendar.isSynced === true &&
    calendar.isReadOnly === false &&
    calendar.syncProvider === 'google'
  );
}

/** Rows that have never been to Google. */
export function findCreates(calendarId: string): Promise<CalendarEvent[]> {
  return db.query.calendarEvents.findMany({
    where: and(eq(calendarEvents.calendarId, calendarId), isNull(calendarEvents.externalId)),
  });
}

/**
 * Rows edited locally since Google last saw them.
 *
 * NULL-safe by construction: when remote_updated is NULL the comparison is
 * NULL, which is not true, so the row is skipped here. Such a row is either a
 * create (no external_id) or one that predates this feature, which the next
 * pull will stamp.
 */
export function findUpdates(calendarId: string): Promise<CalendarEvent[]> {
  return db.query.calendarEvents.findMany({
    where: and(
      eq(calendarEvents.calendarId, calendarId),
      isNotNull(calendarEvents.externalId),
      isNotNull(calendarEvents.remoteUpdated),
      sql`${calendarEvents.updatedAt} > ${calendarEvents.remoteUpdated}`
    ),
  });
}

/**
 * Deletes recorded in the journal since the calendar's cursor.
 *
 * The journal is shared with CalDAV's sync-token replay, so nothing here
 * deletes rows — the cursor is advanced instead.
 */
export function findDeletes(
  calendarId: string,
  cursor: number
): Promise<Array<{ syncToken: number; externalId: string | null }>> {
  return db
    .select({
      syncToken: calendarChanges.syncToken,
      externalId: calendarChanges.externalId,
    })
    .from(calendarChanges)
    .where(
      and(
        eq(calendarChanges.calendarId, calendarId),
        eq(calendarChanges.changeType, 'delete'),
        gt(calendarChanges.syncToken, cursor)
      )
    )
    .orderBy(asc(calendarChanges.syncToken));
}

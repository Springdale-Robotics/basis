/**
 * Shared reconciliation helpers for the external pull syncs (Google/Outlook).
 *
 * Two behaviors both syncs need:
 *
 * 1. Deletion scoped to the fetched window. The pulls only fetch a window of
 *    provider events, but used to delete ANY local synced row missing from
 *    the response — silently purging all synced history older than the
 *    window on every run.
 *
 * 2. No-op update detection. Unconditionally rewriting every event on every
 *    hourly sync bumped each row's revision via the CalDAV triggers, churning
 *    ETags (clients re-download everything) and appending unbounded
 *    calendar_changes journal rows.
 */

interface SyncedEventRow {
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  recurrenceRule?: string | null;
  recurrenceStatus?: string | null;
  recurringEventId?: string | null;
  originalStartTime?: Date | null;
  externalId?: string | null;
  remoteUpdated?: Date | null;
}

interface IncomingEventData {
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  recurrenceRule?: string | null;
  recurrenceStatus?: string | null;
  recurringEventId?: string | null;
  originalStartTime?: Date | null;
  remoteUpdated?: Date | null;
}

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** True when the incoming provider data matches the stored row — skip the write. */
export function syncedEventUnchanged(existing: SyncedEventRow, incoming: IncomingEventData): boolean {
  // Google's own `updated` stamp is the authoritative "did anything change
  // over there" signal, including changes to fields Basis does not mirror.
  if (!sameInstant(existing.remoteUpdated, incoming.remoteUpdated)) {
    return false;
  }

  return (
    existing.title === incoming.title &&
    (existing.description ?? null) === (incoming.description ?? null) &&
    (existing.location ?? null) === (incoming.location ?? null) &&
    sameInstant(existing.startTime, incoming.startTime) &&
    sameInstant(existing.endTime, incoming.endTime) &&
    existing.allDay === incoming.allDay &&
    (existing.recurrenceRule ?? null) === (incoming.recurrenceRule ?? null) &&
    (existing.recurrenceStatus ?? null) === (incoming.recurrenceStatus ?? null) &&
    (existing.recurringEventId ?? null) === (incoming.recurringEventId ?? null) &&
    sameInstant(existing.originalStartTime ?? null, incoming.originalStartTime ?? null)
  );
}

/**
 * A locally-stored synced event missing from the provider response should be
 * deleted ONLY if it lies inside the fetched window — outside it, its absence
 * means nothing (we didn't ask for it).
 */
export function missingEventInsideWindow(
  existing: { startTime: Date; endTime: Date },
  windowStart: Date,
  windowEnd: Date | null,
): boolean {
  const start = new Date(existing.startTime).getTime();
  const end = new Date(existing.endTime).getTime();
  if (end < windowStart.getTime()) return false;
  if (windowEnd && start > windowEnd.getTime()) return false;
  return true;
}

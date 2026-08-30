import { Job } from 'bullmq';
import type { Logger } from 'pino';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { calendarEvents, calendars } from '../db/schema/index.js';
import type { Calendar, CalendarEvent } from '../db/schema/index.js';
import {
  createGoogleEvent,
  deleteGoogleEvent,
  getValidAccessToken,
  updateGoogleEvent,
} from '../modules/calendars/google-sync.service.js';
import {
  findCreates,
  findDeletes,
  findUpdates,
  isOutboundCalendar,
} from '../modules/calendars/outbound-discovery.js';
import { logger } from '../lib/logger.js';

export interface CalendarOutboundJobData {
  calendarId: string;
}

export interface OutboundResult {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
}

// Bounded so a calendar with one persistently failing item cannot keep this
// job — and the worker slot it occupies — looping forever. A healthy
// calendar never gets close to this: every pass that makes progress shrinks
// what the next pass's discovery finds, so N pending changes clear in one
// pass regardless of N. Only a change that fails on every attempt burns
// passes, and it burns at most this many before the sweep gives up and
// leaves it for the next trigger.
const MAX_SWEEP_PASSES = 10;

/**
 * A brand-new recurrence override has no Google identity to attach to.
 * createGoogleEvent only knows how to call events.insert, which makes a
 * free-standing event — it has no way to express "this is occurrence N of
 * series X" (that needs recurringEventId + originalStartTime, which the
 * create path never sets). Calling it on a 'exception' row would sit a
 * second, unrelated event alongside the occurrence Google's own RRULE
 * expansion already produces at that same time — a visible duplicate on the
 * household's calendar. Calling it on a 'cancelled' row is worse: there is
 * nothing at Google to attach the cancellation to, so it would invent a
 * phantom "cancelled" event with no series relationship at all.
 *
 * Both are worse than doing nothing, so neither status is pushed as a
 * create. Only masters and plain (non-recurring) events do, until instance-
 * level override support exists for creates.
 */
function isPushableCreate(event: CalendarEvent): boolean {
  return event.recurrenceStatus !== 'exception' && event.recurrenceStatus !== 'cancelled';
}

/**
 * An update is a different situation: a row reaches findUpdates only with
 * externalId already set, and for an 'exception' row that id was assigned by
 * Google itself as a real instance id (from an earlier pull of a modified
 * occurrence). Patching that id with updateGoogleEvent is exactly the
 * correct way to edit one occurrence — there is no free-standing-duplicate
 * risk here, because the write targets an id Google already recognises as
 * belonging to the series.
 *
 * 'cancelled' is left out even so: this task's updateGoogleEvent never sends
 * a status field, so there is no way to push whatever a local edit to an
 * already-cancelled occurrence is supposed to mean (re-cancel? un-cancel?
 * neither is defined), and guessing wrong risks corrupting an occurrence
 * Google already considers resolved. Skipped, not pushed, not counted as
 * failed — same as the create-path decision, and for the same reason: no
 * defined outcome beats a guessed one.
 */
function isPushableUpdate(event: CalendarEvent): boolean {
  return event.recurrenceStatus !== 'cancelled';
}

function toGoogleEventInput(event: CalendarEvent): {
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrence?: string;
} {
  return {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: event.startTime,
    end: event.endTime,
    allDay: event.allDay,
    recurrence: event.recurrenceRule ?? undefined,
  };
}

/** Google says "already gone" as either a numeric or stringified HTTP
 * status, spread across `.code` (gaxios' catch-all) or `.status` (the actual
 * HTTP status field) depending on where in the client the error surfaced. */
function isAlreadyGone(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown };
  const candidates = [e?.code, e?.status].map((v) => (typeof v === 'string' ? Number(v) : v));
  return candidates.includes(404) || candidates.includes(410);
}

/**
 * Resolve a Google access token for this calendar, tolerating credentials
 * that fail to decrypt or parse.
 *
 * The pull path (syncCalendarFromGoogle) treats that failure as fatal to the
 * whole job, which is right there — a pull either happens or it doesn't.
 * The sweep's unit of success is the individual item, so a bad token belongs
 * in the same bucket as an item Google itself rejects: it degrades to
 * per-item `failed` counts (via a 401 from Google) rather than taking down
 * every other pending change on the calendar before any of them is
 * attempted.
 */
async function resolveAccessToken(calendar: Calendar, log: Logger): Promise<string> {
  try {
    return await getValidAccessToken(calendar);
  } catch (err) {
    log.warn({ err }, 'Could not derive a Google access token from stored credentials');
    return calendar.syncCredentials ?? '';
  }
}

/**
 * Push one calendar's pending changes to Google.
 *
 * Serialisation is by job id — a sweep is enqueued as
 * `calendar-outbound-<calendarId>`, and BullMQ won't run two jobs sharing a
 * live id. That dedupe stops applying the moment a job goes active, so an
 * edit made mid-sweep would otherwise sit unpushed until something else
 * triggered a fresh sweep. Looping until discovery comes back empty closes
 * that window without a second queue.
 */
export async function processCalendarOutboundJob(
  job: Job<CalendarOutboundJobData>
): Promise<OutboundResult> {
  const { calendarId } = job.data;
  const log = logger.child({ jobId: job.id, calendarId });
  const result: OutboundResult = { created: 0, updated: 0, deleted: 0, failed: 0 };

  const calendar = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
  });

  // isOutboundCalendar deliberately doesn't check syncCalendarId — every
  // Google call below needs it, so that's checked here instead of relying on
  // a non-null assertion further down.
  if (
    !calendar ||
    !isOutboundCalendar(calendar) ||
    !calendar.syncCalendarId ||
    !calendar.syncCredentials
  ) {
    return result;
  }

  const googleCalendarId = calendar.syncCalendarId;
  const accessToken = await resolveAccessToken(calendar, log);
  let cursor = calendar.outboundCursor;

  for (let pass = 0; pass < MAX_SWEEP_PASSES; pass += 1) {
    const [creates, updates, deletes] = await Promise.all([
      findCreates(calendarId),
      findUpdates(calendarId),
      findDeletes(calendarId, cursor),
    ]);

    const pushableCreates = creates.filter(isPushableCreate);
    const pushableUpdates = updates.filter(isPushableUpdate);
    const skipped = creates.length - pushableCreates.length + (updates.length - pushableUpdates.length);
    if (skipped > 0) {
      log.debug({ skipped }, 'Skipping recurrence overrides — not pushed by this sweep');
    }

    if (pushableCreates.length === 0 && pushableUpdates.length === 0 && deletes.length === 0) {
      return result;
    }

    for (const event of pushableCreates) {
      try {
        const remote = await createGoogleEvent(accessToken, googleCalendarId, toGoogleEventInput(event));
        const stamp = remote.updated ? new Date(remote.updated) : new Date();
        await db
          .update(calendarEvents)
          .set({
            externalId: remote.id,
            // Clamped past updatedAt: if Google's clock is behind ours, an
            // unclamped stamp would leave the row satisfying
            // `updated_at > remote_updated` and it would get a pointless
            // update push on the very next pass before self-healing.
            remoteUpdated: stamp > event.updatedAt ? stamp : new Date(event.updatedAt.getTime() + 1),
          })
          .where(eq(calendarEvents.id, event.id));
        result.created += 1;
      } catch (err) {
        log.warn({ err, eventId: event.id }, 'Outbound create failed');
        result.failed += 1;
      }
    }

    for (const event of pushableUpdates) {
      try {
        const remote = await updateGoogleEvent(
          accessToken,
          googleCalendarId,
          event.externalId!,
          toGoogleEventInput(event)
        );
        const stamp = remote.updated ? new Date(remote.updated) : new Date();
        // remote_updated is the ONLY column touched by this write. The
        // 0018 trigger guard special-cases an update that changes nothing
        // else, so this push does not bump revision, reroll the ctag, or
        // append a calendar_changes row. Adding updatedAt here — a habit
        // elsewhere in this codebase — would defeat that guard and bring
        // back per-push ETag churn for every CalDAV client watching this
        // calendar. See outbound-worker.test.ts for the assertion against
        // real Postgres triggers.
        await db
          .update(calendarEvents)
          .set({
            remoteUpdated: stamp > event.updatedAt ? stamp : new Date(event.updatedAt.getTime() + 1),
          })
          .where(eq(calendarEvents.id, event.id));
        result.updated += 1;
      } catch (err) {
        log.warn({ err, eventId: event.id }, 'Outbound update failed');
        result.failed += 1;
      }
    }

    for (const change of deletes) {
      // A row that never reached Google has nothing to delete there — the
      // cursor still advances past it, but there is no call to make.
      if (change.externalId) {
        try {
          await deleteGoogleEvent(accessToken, googleCalendarId, change.externalId);
          result.deleted += 1;
        } catch (err) {
          if (isAlreadyGone(err)) {
            result.deleted += 1;
          } else {
            log.warn({ err, externalId: change.externalId }, 'Outbound delete failed');
            result.failed += 1;
            // Stop advancing the cursor past something unresolved — leave it
            // for the next sweep to retry rather than skip it forever.
            break;
          }
        }
      }
      cursor = change.syncToken;
    }

    if (cursor !== calendar.outboundCursor) {
      await db.update(calendars).set({ outboundCursor: cursor }).where(eq(calendars.id, calendarId));
      calendar.outboundCursor = cursor;
    }

    if (result.created + result.updated + result.deleted > 0) {
      // Marks the calendar "active" for the five-minute polling tick. Set
      // here rather than inferred from outstanding work, which goes false
      // the instant this sweep succeeds.
      await db
        .update(calendars)
        .set({ lastOutboundAt: new Date() })
        .where(eq(calendars.id, calendarId));
    }
  }

  log.warn({ result }, 'Outbound sweep hit its pass limit with work outstanding');
  return result;
}

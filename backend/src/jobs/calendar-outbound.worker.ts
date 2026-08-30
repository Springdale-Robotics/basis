import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { calendarEvents, calendars } from '../db/schema/index.js';
import type { CalendarEvent } from '../db/schema/index.js';
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
import { parseExDates, parseRDates } from '../modules/calendars/recurrence.service.js';
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
// pass regardless of N. The loop also breaks early (see the bottom of
// processCalendarOutboundJob) the moment a pass makes no progress at all, so
// this cap is a last-resort backstop, not the normal way a stuck item gets
// bounded — see the fix-round report (I1) for why the naive "always run 10
// passes" version was itself a 10x-failure amplifier.
const MAX_SWEEP_PASSES = 10;

/**
 * True when this row carries a per-occurrence override (an EXDATE or RDATE
 * on a recurring master) that neither createGoogleEvent nor updateGoogleEvent
 * knows how to send.
 *
 * Both write functions build `recurrence` as a single RRULE line
 * (`toGoogleEventInput` below only ever reads `recurrenceRule`) and, on an
 * update, `eventBody.recurrence = [...]` *replaces* Google's whole recurrence
 * array rather than merging into it. Pushing a master with a local EXDATE —
 * the row `calendars.routes.ts`'s two "cancel one occurrence" routes
 * (`DELETE .../events/:id` with scope 'single', and
 * `DELETE .../events/:id/instances/:originalStartTime`) actually produce,
 * per an owner review that traced this exact path — would silently erase
 * every exclusion Google already had for that series: the cancelled
 * occurrence reappears at Google (and on every device reading it), and any
 * previously-Google-side-cancelled occurrences come back too.
 *
 * Refused rather than pushed wrong. Caught in isPushableCreate/isPushableUpdate
 * below, not counted as failed — this is the same "silently deferred, not
 * counted as an error" bucket as the recurrenceStatus exclusions, because it
 * isn't a Google-side error, it's a known gap in what this task's mapping can
 * express. The row stays dirty (remote_updated untouched) and is
 * rediscovered on every future sweep until instance-override support exists.
 */
function hasUnpushableRecurrenceEdits(event: CalendarEvent): boolean {
  return parseExDates(event.recurrenceExDates).length > 0 || parseRDates(event.recurrenceRDates).length > 0;
}

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
 * level override support exists for creates. A master that itself already
 * carries an EXDATE/RDATE before its first push is excluded for the same
 * reason as hasUnpushableRecurrenceEdits documents above: the create path
 * has no way to send those exclusions either, so pushing it now would create
 * the full, un-excluded series at Google.
 */
function isPushableCreate(event: CalendarEvent): boolean {
  if (event.recurrenceStatus === 'exception' || event.recurrenceStatus === 'cancelled') return false;
  if (hasUnpushableRecurrenceEdits(event)) return false;
  return true;
}

/**
 * An update is a different situation from a create for recurrence overrides:
 * a row reaches findUpdates only with externalId already set, and for an
 * 'exception' row that id was assigned by Google itself as a real instance
 * id (from an earlier pull of a modified occurrence). Patching that id with
 * updateGoogleEvent is exactly the correct way to edit one occurrence —
 * there is no free-standing-duplicate risk here, because the write targets
 * an id Google already recognises as belonging to the series.
 *
 * 'cancelled' is left out even so: this task's updateGoogleEvent never sends
 * a status field, so there is no way to push whatever a local edit to an
 * already-cancelled occurrence is supposed to mean (re-cancel? un-cancel?
 * neither is defined), and guessing wrong risks corrupting an occurrence
 * Google already considers resolved. Skipped, not pushed, not counted as
 * failed — same as the create-path decision, and for the same reason: no
 * defined outcome beats a guessed one.
 *
 * A master with an EXDATE/RDATE is refused for the reason documented on
 * hasUnpushableRecurrenceEdits above — this is the actual, common path onto
 * this row shape (a household cancelling one occurrence of an existing
 * Google-synced series edits the *master*, not a 'cancelled' row), which is
 * why this check is not folded into the recurrenceStatus condition above.
 */
function isPushableUpdate(event: CalendarEvent): boolean {
  if (event.recurrenceStatus === 'cancelled') return false;
  if (hasUnpushableRecurrenceEdits(event)) return false;
  return true;
}

/**
 * True when this create's shape can be safely expressed by createGoogleEvent
 * as currently written. Two independent gaps in that mapping, both
 * pre-existing and both invisible until this task actually called it:
 *
 *  - All-day: Basis stores an all-day event as an *inclusive* noon-to-noon
 *    range (a one-day event has startTime === endTime; see
 *    EventForm.tsx's handleFormSubmit), but Google's `end.date` is
 *    *exclusive*. createGoogleEvent takes the date portion of each
 *    timestamp as-is, so a one-day event pushes as `start.date == end.date`
 *    — a zero-length range — and a multi-day event lands a day short.
 *  - Recurring: Google requires `start.timeZone` on a recurring insert so it
 *    can interpret the RRULE's DST behaviour, but createGoogleEvent's
 *    parameter shape has no timeZone field at all, and nothing plumbs
 *    calendars.timezone through to it. No recurring create can carry one
 *    today.
 *
 * Neither is fixed here — that's explicitly a design conversation, not a
 * fix-round change, because fixing the date arithmetic or adding timezone
 * plumbing changes what gets sent to Google, not just what gets refused.
 * Refused creates are counted `failed` (unlike the recurrence-status/EXDATE
 * skips above, which aren't errors) and left with externalId still null, so
 * they're rediscovered by findCreates on every future sweep until the
 * mapping is fixed.
 */
function isCreateExpressible(event: CalendarEvent): boolean {
  if (event.allDay) {
    const startDate = event.startTime.toISOString().slice(0, 10);
    const endDate = event.endTime.toISOString().slice(0, 10);
    if (!(endDate > startDate)) return false;
  }
  if (event.recurrenceRule) return false;
  return true;
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
 * Push one calendar's pending changes to Google.
 *
 * Serialisation is by job id — a sweep is enqueued as
 * `calendar-outbound-<calendarId>`, and BullMQ won't run two jobs sharing a
 * live id. That dedupe stops applying the moment a job goes active, so an
 * edit made mid-sweep would otherwise sit unpushed until something else
 * triggered a fresh sweep. Looping until discovery comes back empty (or a
 * pass makes no progress — see the bottom of the loop) closes that window
 * without a second queue.
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

  // No fallback here on purpose: an earlier draft of this worker caught a
  // decrypt/parse failure and fell back to shipping the raw (still
  // encrypted) syncCredentials string as the bearer token — which means a
  // calendar with genuinely broken credentials would send its own ciphertext
  // to Google in an Authorization header on every attempted call, and every
  // "happy path" test passed only because token resolution never actually
  // ran (a basis#112-shaped test gap). Fail the whole sweep fast instead,
  // the same posture the pull path (syncCalendarFromGoogle) already takes
  // for the same failure.
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(calendar);
  } catch (err) {
    log.error({ err }, 'Could not obtain a Google access token; aborting this sweep');
    await db
      .update(calendars)
      .set({
        syncError: 'Outbound push failed: could not obtain a Google access token from stored credentials.',
      })
      .where(eq(calendars.id, calendarId));
    return result;
  }

  let cursor = calendar.outboundCursor;
  let stoppedForNoProgress = false;

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

    const progressBefore = result.created + result.updated + result.deleted;

    for (const event of pushableCreates) {
      if (!isCreateExpressible(event)) {
        log.warn(
          { eventId: event.id },
          'Outbound create refused: this all-day/recurrence shape cannot be expressed by the current Google mapping'
        );
        result.failed += 1;
        continue;
      }
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

    const progressAfter = result.created + result.updated + result.deleted;

    if (progressAfter > progressBefore) {
      // Marks the calendar "active" for the five-minute polling tick. Set
      // here rather than inferred from outstanding work, which goes false
      // the instant this sweep succeeds.
      await db
        .update(calendars)
        .set({ lastOutboundAt: new Date() })
        .where(eq(calendars.id, calendarId));
    } else {
      // Nothing succeeded this pass. Discovery will hand back exactly the
      // same stuck items next pass (nothing about their state changed), so
      // further passes would only repeat the same failed API calls at
      // MAX_SWEEP_PASSES cost for zero additional benefit — the mid-sweep-
      // pickup guarantee only needs the loop to keep going when something
      // *succeeded*, since that's the only case where new discovery could
      // differ from this pass's.
      stoppedForNoProgress = true;
      break;
    }
  }

  if (stoppedForNoProgress) {
    log.warn({ result }, 'Outbound sweep stopped: a pass made no progress');
  } else {
    log.warn({ result }, 'Outbound sweep hit its pass limit with work outstanding');
  }

  if (result.failed > 0 && result.created + result.updated + result.deleted === 0) {
    // Nothing succeeded across the whole invocation. The pull path
    // (syncCalendarFromGoogle) writes the same column on failure and clears
    // it to null on a successful pull — sharing it here means a healthy pull
    // next hour will silently clear this message even if outbound is still
    // wedged, before a dedicated outbound error surface exists. Flagged for
    // the design conversation rather than solved here.
    await db
      .update(calendars)
      .set({
        syncError: `Outbound push failed for ${result.failed} pending change${result.failed === 1 ? '' : 's'}; will retry on the next sweep.`,
      })
      .where(eq(calendars.id, calendarId));
  }

  return result;
}

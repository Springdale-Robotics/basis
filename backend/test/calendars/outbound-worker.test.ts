import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { encrypt } from '../../src/lib/crypto.js';

const createGoogleEvent = vi.fn();
const updateGoogleEvent = vi.fn();
const deleteGoogleEvent = vi.fn();

vi.mock('../../src/modules/calendars/google-sync.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createGoogleEvent: (...args: unknown[]) => createGoogleEvent(...args),
  updateGoogleEvent: (...args: unknown[]) => updateGoogleEvent(...args),
  deleteGoogleEvent: (...args: unknown[]) => deleteGoogleEvent(...args),
}));

const { db } = await import('../../src/config/database.js');
const { calendarChanges, calendarEvents, calendars, households } = await import(
  '../../src/db/schema/index.js'
);
const { processCalendarOutboundJob } = await import(
  '../../src/jobs/calendar-outbound.worker.js'
);
const { findCreates, findUpdates } = await import(
  '../../src/modules/calendars/outbound-discovery.js'
);

// A fresh household + calendar per test, not a shared fixture. The sweep
// processes *every* pending journal delete for a calendar on every call, so
// a shared calendar means one test's cleanup (deleting the previous test's
// leftover event, which itself journals a delete) becomes another test's
// unexpected extra work — a real cross-test bleed this suite hit while
// writing it, not a hypothetical. Per-test calendars make each test's
// journal state its own. See test/calendars/outbound-triggers.test.ts's
// afterAll comment for the companion gotcha this also avoids: cascading a
// household delete through calendars -> calendar_events can race the DELETE
// trigger if events aren't cleared first.
let householdId: string;
let calendarId: string;

const times = {
  startTime: new Date('2026-09-01T10:00:00Z'),
  endTime: new Date('2026-09-01T11:00:00Z'),
};

const runSweep = () =>
  processCalendarOutboundJob({ id: 'test', data: { calendarId } } as never);

// Real ciphertext, not a placeholder string. An earlier draft used
// syncCredentials: 'unused-in-this-test' and fell back to shipping that
// raw string to Google as a bearer token whenever it failed to decrypt —
// which is every test, since it isn't valid ciphertext. That meant every
// happy-path test passed *because* real token resolution never ran, not
// because it worked (a basis#112-shaped gap). Building this with encrypt()
// exercises the real getValidAccessToken path, expiry_date is set far
// enough out that it never takes the refresh branch (which would hit a
// real, unmocked Google endpoint).
const validCredentials = () =>
  encrypt(
    JSON.stringify({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expiry_date: Date.now() + 3600_000,
    })
  );

beforeEach(async () => {
  createGoogleEvent.mockReset();
  updateGoogleEvent.mockReset();
  deleteGoogleEvent.mockReset();

  const [household] = await db
    .insert(households)
    .values({ name: `outbound-${randomUUID()}` })
    .returning();
  householdId = household.id;

  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Outbound fixture',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'fixture@group.calendar.google.com',
      syncCredentials: validCredentials(),
    })
    .returning();
  calendarId = calendar.id;
});

afterEach(async () => {
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, calendarId));
  await db.delete(households).where(eq(households.id, householdId));
});

describe('outbound sweep', () => {
  it('creates an event at Google and stores the returned id', async () => {
    // Later than "now" so the create path's clock-skew clamp (see the
    // worker's comment on the create branch) never engages — this asserts
    // Google's stamp is stored as-is, not the clamp's fallback.
    const googleUpdated = new Date(Date.now() + 60_000).toISOString();
    createGoogleEvent.mockResolvedValue({ id: 'g-new', updated: googleUpdated });

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'New locally', ...times })
      .returning();

    const result = await runSweep();

    expect(createGoogleEvent).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    expect(after!.externalId).toBe('g-new');
    expect(after!.remoteUpdated).toEqual(new Date(googleUpdated));
  });

  it('does not re-push an event it just created', async () => {
    createGoogleEvent.mockResolvedValue({
      id: 'g-new',
      updated: new Date(Date.now() + 60_000).toISOString(),
    });
    await db.insert(calendarEvents).values({ calendarId, title: 'Once only', ...times });

    await runSweep();
    createGoogleEvent.mockClear();
    updateGoogleEvent.mockClear();
    await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(updateGoogleEvent).not.toHaveBeenCalled();
  });

  it('pushes a local edit and advances remote_updated past updated_at, without bumping revision or the journal', async () => {
    updateGoogleEvent.mockResolvedValue({ id: 'g-1', updated: '2026-08-28T14:00:00.000Z' });

    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Edited',
        ...times,
        externalId: 'g-1',
        remoteUpdated: new Date('2026-08-28T10:00:00Z'),
        updatedAt: new Date('2026-08-28T11:00:00Z'),
      })
      .returning();

    // Captured straight from Postgres, not asserted against a mock — this is
    // the outbound-triggers.test.ts pattern, run here against the worker's
    // real UPDATE statement rather than a hand-crafted one.
    const calBefore = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    const journalBefore = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendarId));

    const result = await runSweep();

    expect(updateGoogleEvent).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1);

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    expect(after!.remoteUpdated!.getTime()).toBeGreaterThan(after!.updatedAt.getTime());

    const calAfter = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    const journalAfter = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendarId));

    // The push's UPDATE touches only remote_updated, so the 0018 trigger
    // guard should make it invisible: no revision bump (ETag stability for
    // CalDAV clients), no sync_token/ctag churn, no journal row. Verified
    // against real Postgres triggers, not a description of them.
    expect(after!.revision).toBe(event.revision);
    expect(calAfter!.syncToken).toBe(calBefore!.syncToken);
    expect(calAfter!.ctag).toBe(calBefore!.ctag);
    expect(journalAfter.length).toBe(journalBefore.length);
  });

  it('deletes at Google using the id captured on the journal row', async () => {
    deleteGoogleEvent.mockResolvedValue(undefined);

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Doomed', ...times, externalId: 'g-del' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const result = await runSweep();

    expect(deleteGoogleEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'g-del');
    expect(result.deleted).toBe(1);
  });

  it('treats a 404 from Google on delete as success — already gone', async () => {
    deleteGoogleEvent.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Already gone', ...times, externalId: 'g-404' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const result = await runSweep();
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('treats a 410 (Gone) the same way, via the HTTP status field rather than code', async () => {
    deleteGoogleEvent.mockRejectedValue(Object.assign(new Error('Gone'), { status: 410 }));

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Also already gone', ...times, externalId: 'g-410' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const result = await runSweep();
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('skips journal deletes for events that never reached Google', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Local only', ...times, externalId: null })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    await runSweep();
    expect(deleteGoogleEvent).not.toHaveBeenCalled();
  });

  it('advances the cursor so a second sweep re-does nothing', async () => {
    deleteGoogleEvent.mockResolvedValue(undefined);

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Doomed twice', ...times, externalId: 'g-cursor' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    await runSweep();
    deleteGoogleEvent.mockClear();
    await runSweep();

    expect(deleteGoogleEvent).not.toHaveBeenCalled();
  });

  it('does nothing for a read-only calendar', async () => {
    await db
      .update(calendars)
      .set({ isReadOnly: true })
      .where(eq(calendars.id, calendarId));
    await db.insert(calendarEvents).values({ calendarId, title: 'Locked', ...times });

    const result = await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 0 });
  });

  it('leaves a never-synced cancelled recurrence exception unpushed (create path)', async () => {
    // Never been to Google (externalId null), so it would otherwise show up
    // in findCreates. There is no Google write here that can express "cancel
    // occurrence N of series X" — createGoogleEvent only knows how to make a
    // brand-new standalone event, which would invent a phantom cancelled
    // event with no relationship to any series. Out of scope for this sweep.
    await db.insert(calendarEvents).values({
      calendarId,
      title: 'Skip me',
      ...times,
      recurrenceStatus: 'cancelled',
    });

    const result = await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 0 });
  });

  it('leaves a never-synced modified recurrence exception unpushed (create path)', async () => {
    // Same reasoning as the cancelled case: pushing this as an ordinary
    // create would produce a duplicate standalone event alongside the
    // occurrence Google's own RRULE expansion already generates at that
    // time slot.
    await db.insert(calendarEvents).values({
      calendarId,
      title: 'Also skip me',
      ...times,
      recurrenceStatus: 'exception',
    });

    const result = await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 0 });
  });

  it('pushes an edit to an already-synced recurrence exception (update path)', async () => {
    // Unlike the create-path case above, this row already has a real Google
    // instance id — it arrived via an earlier pull of a modified occurrence.
    // Patching that id is exactly the correct way to edit one occurrence, so
    // the update path treats it like any other pushable update.
    updateGoogleEvent.mockResolvedValue({ id: 'g-exc-1', updated: '2026-08-28T14:00:00.000Z' });

    await db.insert(calendarEvents).values({
      calendarId,
      title: 'Edited occurrence',
      ...times,
      recurrenceStatus: 'exception',
      externalId: 'g-exc-1',
      remoteUpdated: new Date('2026-08-28T10:00:00Z'),
      updatedAt: new Date('2026-08-28T11:00:00Z'),
    });

    const result = await runSweep();

    expect(updateGoogleEvent).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1);
  });

  it('leaves an edit to an already-synced cancelled occurrence unpushed (update path)', async () => {
    // updateGoogleEvent never sends a status field, so there is no way to
    // express what an edit to an already-cancelled occurrence should even
    // mean at Google. Skipped rather than guessed — same reasoning as the
    // create-path decision, applied to the one recurrenceStatus where an
    // externalId existing doesn't change the answer.
    await db.insert(calendarEvents).values({
      calendarId,
      title: 'Edited but cancelled',
      ...times,
      recurrenceStatus: 'cancelled',
      externalId: 'g-exc-2',
      remoteUpdated: new Date('2026-08-28T10:00:00Z'),
      updatedAt: new Date('2026-08-28T11:00:00Z'),
    });

    const result = await runSweep();

    expect(updateGoogleEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 0 });
  });

  it('C1: refuses to push a master with an EXDATE, leaving it dirty and rediscoverable rather than pushing and wiping the exclusion', async () => {
    // The dominant "cancel one occurrence" path never creates a 'cancelled'
    // row at all — calendars.routes.ts's two cancel-an-occurrence routes
    // (DELETE .../events/:id with scope 'single', and DELETE
    // .../events/:id/instances/:originalStartTime) both add an EXDATE to the
    // *master* row and bump its updatedAt. That master then reaches this
    // sweep as an ordinary dirty update. Before this fix, updateGoogleEvent's
    // recurrence field replaced Google's whole recurrence array with just
    // the RRULE line, silently wiping the EXDATE Google already had.
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Recurring with an excluded occurrence',
        ...times,
        recurrenceRule: 'FREQ=WEEKLY',
        recurrenceStatus: 'master',
        recurrenceExDates: JSON.stringify(['2026-09-08T10:00:00.000Z']),
        externalId: 'g-recur-1',
        remoteUpdated: new Date('2026-08-28T10:00:00Z'),
        updatedAt: new Date('2026-08-28T11:00:00Z'),
      })
      .returning();

    const result = await runSweep();

    expect(updateGoogleEvent).not.toHaveBeenCalled();
    // Deferred, not an error: this is the same "out of scope, not failed"
    // bucket as the recurrenceStatus skips above.
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 0 });

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    // remote_updated untouched — still dirty by the same predicate a healthy
    // update would have cleared.
    expect(after!.remoteUpdated).toEqual(new Date('2026-08-28T10:00:00Z'));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(after!.remoteUpdated!.getTime());

    // The assertion that actually distinguishes deferral from loss: this row
    // is still sitting in findUpdates for the next sweep to find, not
    // silently dropped.
    const stillPending = await findUpdates(calendarId);
    expect(stillPending.map((e) => e.id)).toContain(event.id);
  });

  it('C1: refuses to create a recurring event that already carries an EXDATE before its first push', async () => {
    // Same underlying gap as the update-path case, hit from the other side:
    // a brand-new (never-synced) master that already has a local exclusion
    // before it's ever reached Google. createGoogleEvent has no way to send
    // that exclusion either, so pushing it now would create the full,
    // un-excluded series.
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'New series, one occurrence already excluded',
        ...times,
        recurrenceRule: 'FREQ=WEEKLY',
        recurrenceStatus: 'master',
        recurrenceExDates: JSON.stringify(['2026-09-08T10:00:00.000Z']),
      })
      .returning();

    const result = await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 0 });

    const stillPending = await findCreates(calendarId);
    expect(stillPending.map((e) => e.id)).toContain(event.id);
  });

  it('C2 (superseded 2026-08-31): a one-day all-day event now pushes, not refused', async () => {
    // Round 1 refused this shape outright — Basis stores a one-day all-day
    // event as an inclusive noon-to-noon range on the same date (see
    // EventForm.tsx's handleFormSubmit), but Google's end.date is exclusive,
    // and pushed as-is start.date === end.date would be a zero-length range.
    //
    // The 2026-08-31 amendment says this is a bug to fix, not a boundary to
    // guard: toGoogleAllDayEndDate (google-sync.service.ts) now does the
    // inclusive-to-exclusive conversion, so isCreateExpressible no longer
    // refuses all-day shapes at all. createGoogleEvent is mocked in this
    // file, so this test only proves the worker stopped refusing the create
    // and passed the raw start/end through — the conversion itself is
    // covered against the real function in all-day-google-mapping.test.ts.
    const day = new Date('2026-09-05T12:00:00Z');
    createGoogleEvent.mockResolvedValue({
      id: 'g-allday',
      updated: new Date(Date.now() + 60_000).toISOString(),
    });

    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'One-day all-day event',
        startTime: day,
        endTime: day,
        allDay: true,
      })
      .returning();

    const result = await runSweep();

    expect(createGoogleEvent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: 1, updated: 0, deleted: 0, failed: 0 });

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    expect(after!.externalId).toBe('g-allday');
  });

  it('C2: refuses to create a recurring event, since this mapping never attaches a time zone', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'New recurring series',
        ...times,
        recurrenceRule: 'FREQ=WEEKLY',
        recurrenceStatus: 'master',
      })
      .returning();

    const result = await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 1 });

    const stillPending = await findCreates(calendarId);
    expect(stillPending.map((e) => e.id)).toContain(event.id);
  });

  it('I2: records a calendar-level error when a sweep ends with failures and nothing succeeded', async () => {
    createGoogleEvent.mockRejectedValue(new Error('Google is down'));
    await db.insert(calendarEvents).values({ calendarId, title: 'Always fails', ...times });

    const result = await runSweep();
    expect(result.failed).toBeGreaterThan(0);
    expect(result.created + result.updated + result.deleted).toBe(0);

    const cal = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    expect(cal!.syncError).toContain('Outbound push failed');
  });

  it('I2: does not touch the calendar error when at least one item succeeds', async () => {
    createGoogleEvent.mockResolvedValue({
      id: 'g-ok',
      updated: new Date(Date.now() + 60_000).toISOString(),
    });
    await db.insert(calendarEvents).values({ calendarId, title: 'Succeeds', ...times });

    await runSweep();

    const cal = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    expect(cal!.syncError).toBeNull();
  });

  it('I5: fails the sweep fast on undecryptable credentials, without ever calling Google or shipping ciphertext as a token', async () => {
    await db
      .update(calendars)
      .set({ syncCredentials: 'not-valid-ciphertext' })
      .where(eq(calendars.id, calendarId));
    await db.insert(calendarEvents).values({ calendarId, title: 'Should not push', ...times });

    const result = await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(updateGoogleEvent).not.toHaveBeenCalled();
    expect(deleteGoogleEvent).not.toHaveBeenCalled();
    // Nothing was attempted at all — discovery isn't even consulted once the
    // token can't be resolved.
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 0 });

    const cal = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    expect(cal!.syncError).toContain('access token');
  });

  it('picks up work that appears mid-sweep instead of waiting for the next trigger', async () => {
    let calls = 0;
    createGoogleEvent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        // An edit lands while the first item is in flight.
        await db.insert(calendarEvents).values({ calendarId, title: 'Late arrival', ...times });
      }
      return { id: `g-${calls}`, updated: new Date(Date.now() + 60_000).toISOString() };
    });

    await db.insert(calendarEvents).values({ calendarId, title: 'First', ...times });

    const result = await runSweep();
    expect(result.created).toBe(2);
  });

  it('does not spin forever on a persistently failing item', async () => {
    createGoogleEvent.mockRejectedValue(new Error('Google is down'));
    await db.insert(calendarEvents).values({ calendarId, title: 'Always fails', ...times });

    const result = await runSweep();

    // I1 fix: a pass that makes no progress stops the loop immediately,
    // rather than burning the full MAX_SWEEP_PASSES retrying an item that
    // cannot succeed. Discovery would hand back this same row every pass
    // (nothing about its state changes on failure), so a second attempt in
    // the same invocation could only repeat the first one's outcome. One
    // call, not ten — the naive "always run every pass" version was itself
    // a 10x-failure amplifier against a wedged calendar or a Google outage.
    expect(createGoogleEvent).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
    expect(result.created).toBe(0);
  });

  it('keeps looping past a persistent failure as long as something else is still making progress', async () => {
    // Proves the no-progress break (I1) doesn't cut the loop short while
    // there's real work to do — it only stops once a pass truly achieves
    // nothing. One item fails every time; three more each need their own
    // pass to arrive (mimicking edits landing mid-sweep, as in the "picks up
    // work that appears mid-sweep" test above).
    createGoogleEvent.mockImplementation(async (_token: unknown, _calId: unknown, input: { summary: string }) => {
      if (input.summary === 'Never succeeds') {
        throw new Error('Google is down for this one');
      }
      return { id: `g-${input.summary}`, updated: new Date(Date.now() + 60_000).toISOString() };
    });

    await db.insert(calendarEvents).values({ calendarId, title: 'Never succeeds', ...times });
    await db.insert(calendarEvents).values({ calendarId, title: 'Succeeds pass 1', ...times });

    const result = await runSweep();

    // Pass 1: 'Never succeeds' fails, 'Succeeds pass 1' succeeds — progress
    // was made, so the loop continues. Pass 2: only 'Never succeeds' is left
    // (still undiscovered by findCreates since it never got an externalId)
    // — no progress, loop stops. Two attempts at the stuck item, not one and
    // not ten.
    expect(result.created).toBe(1);
    expect(result.failed).toBe(2);
    expect(createGoogleEvent).toHaveBeenCalledTimes(3);
  });
});

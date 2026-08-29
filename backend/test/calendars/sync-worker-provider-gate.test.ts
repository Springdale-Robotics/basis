import { randomUUID } from 'crypto';
import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { CalendarSyncJobData } from '../../src/jobs/calendar-sync.worker.js';

/**
 * Fix round 1, Task 7: the mapped "Testing" explanation for a Google
 * invalid_grant failure was written to calendars.sync_error by the service,
 * then immediately clobbered by calendar-sync.worker.ts, which recomputed
 * the message from the raw rethrown error. The fix maps the message inside
 * the worker's catch too — gated on syncProvider, since Google's "check your
 * consent screen" advice would be actively misleading on an Outlook failure
 * that also happens to look like invalid_grant.
 *
 * This exercises processCalendarSyncJob itself (not just the mapper in
 * isolation) because the bug was specifically about the worker discarding
 * the mapping — a unit test of describeGoogleSyncError alone would not have
 * caught it.
 */

const syncCalendarFromGoogle = vi.fn();
const syncCalendarFromOutlook = vi.fn();

vi.mock('../../src/modules/calendars/google-sync.service.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/modules/calendars/google-sync.service.js')>(
    '../../src/modules/calendars/google-sync.service.js'
  );
  return { ...actual, syncCalendarFromGoogle };
});

vi.mock('../../src/modules/calendars/outlook-sync.service.js', () => ({
  syncCalendarFromOutlook,
}));

const { processCalendarSyncJob } = await import('../../src/jobs/calendar-sync.worker.js');
const { db } = await import('../../src/config/database.js');
const { calendars, households } = await import('../../src/db/schema/index.js');

let hhId: string;
let googleCalendarId: string;
let outlookCalendarId: string;

function job(calendarId: string): Job<CalendarSyncJobData> {
  return {
    id: `gate-${calendarId}`,
    data: { type: 'sync_single', calendarId, householdId: hhId },
  } as Job<CalendarSyncJobData>;
}

beforeAll(async () => {
  hhId = randomUUID();
  await db.insert(households).values({ id: hhId, name: `Sync Gate Test ${hhId.slice(0, 8)}` });

  const [google] = await db
    .insert(calendars)
    .values({
      householdId: hhId,
      name: 'Google Calendar',
      timezone: 'UTC',
      isSynced: true,
      syncProvider: 'google',
    })
    .returning({ id: calendars.id });
  googleCalendarId = google.id;

  const [outlook] = await db
    .insert(calendars)
    .values({
      householdId: hhId,
      name: 'Outlook Calendar',
      timezone: 'UTC',
      isSynced: true,
      syncProvider: 'outlook',
    })
    .returning({ id: calendars.id });
  outlookCalendarId = outlook.id;
});

afterAll(async () => {
  await db.delete(calendars).where(eq(calendars.householdId, hhId));
  await db.delete(households).where(eq(households.id, hhId));
});

afterEach(() => {
  syncCalendarFromGoogle.mockReset();
  syncCalendarFromOutlook.mockReset();
});

describe('processCalendarSyncJob provider-gated error mapping', () => {
  it('maps a Google invalid_grant failure to the Testing explanation', async () => {
    syncCalendarFromGoogle.mockRejectedValue(
      Object.assign(new Error('invalid_grant'), {
        response: { data: { error: 'invalid_grant' } },
      })
    );

    const results = await processCalendarSyncJob(job(googleCalendarId));

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Testing');
    expect(results[0].error).toContain('reconnect');

    // The results array isn't what a household sees — GET /:id/sync/status
    // reads calendars.sync_error, which handleSyncFailure also writes
    // (`${errorMessage}|count:N`). Confirm the mapped message survives that
    // write too, not just the in-memory result.
    const [row] = await db
      .select({ syncError: calendars.syncError })
      .from(calendars)
      .where(eq(calendars.id, googleCalendarId));
    expect(row.syncError).toContain('Testing');
    expect(row.syncError).toContain('|count:1');
  });

  it('does not apply Google consent-screen advice to an Outlook invalid_grant failure', async () => {
    const outlookMessage = 'invalid_grant: AADSTS700082 refresh token has expired';
    syncCalendarFromOutlook.mockRejectedValue(new Error(outlookMessage));

    const results = await processCalendarSyncJob(job(outlookCalendarId));

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe(outlookMessage);
    expect(results[0].error).not.toContain('Testing');
    expect(results[0].error).not.toContain('Google Cloud console');
  });
});

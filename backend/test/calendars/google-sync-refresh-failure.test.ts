import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * Fix round 2, Task 7 (Critical finding): round 1's worker-level gate
 * (test/calendars/sync-worker-provider-gate.test.ts) mocked
 * `syncCalendarFromGoogle` itself, which substituted away the real
 * function's internal catch-and-rethrow — the exact place the bug lived.
 * That test could prove the worker's gate exists; it could never prove the
 * gate had anything real to work with, because `syncCalendarFromGoogle`'s
 * refresh-catch used to swallow the original `invalid_grant` error and
 * rethrow a brand-new generic `Error('Failed to refresh access token')`.
 *
 * This test exercises the REAL `syncCalendarFromGoogle`. It mocks one layer
 * below it — the googleapis OAuth2 client's `refreshAccessToken()` — so the
 * service function runs its own try/catch/rethrow for real, and asserts
 * that what escapes the function still maps to the "Testing" explanation.
 */

const refreshAccessToken = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(): void {}
        refreshAccessToken(): Promise<{ credentials: { access_token: string; expiry_date: number } }> {
          return refreshAccessToken();
        }
        generateAuthUrl(): string {
          return '';
        }
      },
    },
    // Not exercised on this failure path (the function throws before
    // reaching the Calendar API), but present so an accidental call fails
    // loudly instead of hitting the real network.
    calendar: vi.fn(() => {
      throw new Error('calendar() should not be reached on a refresh failure');
    }),
  },
}));

// google-sync.service.ts's OAuth2Client type import is type-only (erased at
// runtime), so mocking 'googleapis' alone is enough — no need to touch
// 'google-auth-library'.

process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-google-client-secret';

const { syncCalendarFromGoogle, describeGoogleSyncError } = await import(
  '../../src/modules/calendars/google-sync.service.js'
);
const { encrypt } = await import('../../src/lib/crypto.js');
const { db } = await import('../../src/config/database.js');
const { calendars, households } = await import('../../src/db/schema/index.js');

let hhId: string;
let calendarId: string;

function encryptedExpiredCredentials(): string {
  return encrypt(
    JSON.stringify({
      access_token: 'stale-access-token',
      refresh_token: 'stale-refresh-token',
      // Already expired, so syncCalendarFromGoogle takes the refresh branch.
      expiry_date: Date.now() - 60_000,
    })
  );
}

beforeAll(async () => {
  hhId = randomUUID();
  await db.insert(households).values({ id: hhId, name: `Refresh Failure Test ${hhId.slice(0, 8)}` });

  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId: hhId,
      name: 'Google Calendar',
      timezone: 'UTC',
      isSynced: true,
      syncProvider: 'google',
      syncCalendarId: 'primary',
      syncCredentials: encryptedExpiredCredentials(),
    })
    .returning({ id: calendars.id });
  calendarId = calendar.id;
});

afterAll(async () => {
  await db.delete(calendars).where(eq(calendars.householdId, hhId));
  await db.delete(households).where(eq(households.id, hhId));
});

afterEach(() => {
  refreshAccessToken.mockReset();
});

describe('syncCalendarFromGoogle refresh failure (real function, mocked googleapis)', () => {
  it('rethrows the original invalid_grant error, not a generic replacement', async () => {
    refreshAccessToken.mockRejectedValue(
      Object.assign(new Error('invalid_grant'), {
        response: { data: { error: 'invalid_grant' } },
      })
    );

    let thrown: unknown;
    try {
      await syncCalendarFromGoogle(calendarId, hhId);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    // This is the regression this test exists to catch: before the fix, the
    // service swallowed the real error here and threw a new generic one, so
    // this message would have been 'Failed to refresh access token'.
    expect((thrown as Error).message).not.toBe('Failed to refresh access token');

    // What actually escapes the function must still be mappable — proving
    // the worker's provider-gated describeGoogleSyncError call (round 1) has
    // something real to work with on the scheduled sync path.
    const mapped = describeGoogleSyncError(thrown);
    expect(mapped).toContain('Testing');
    expect(mapped).toContain('reconnect');

    // The DB write inside the same catch (unrelated to this fix, verified
    // here for completeness) should already carry the mapped message.
    const [row] = await db
      .select({ syncError: calendars.syncError })
      .from(calendars)
      .where(eq(calendars.id, calendarId));
    expect(row.syncError).toContain('Testing');
  });
});

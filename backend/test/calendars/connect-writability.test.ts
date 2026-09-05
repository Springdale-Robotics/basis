import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteTestContext, TestUser } from '../helpers/route-harness.js';

/**
 * The first real coverage of /sync/google/complete and /sync/outlook/complete
 * — `grep -rln "sync/google/complete\|syncRoutes" backend/test/` returned
 * nothing before this file. Exists to pin down two guarantees that only a
 * live route can prove:
 *
 * 1. A Google calendar connects read-only unless this Google account's own
 *    accessRole on it is 'owner' or 'writer'. Before this fix, the route
 *    unconditionally set isReadOnly: false for every Google connection —
 *    fine for a calendar the household owns, silently wrong for one they
 *    can only read (a partner's shared calendar, Holidays, a school
 *    calendar): every push against it would 403 forever, and a delete would
 *    403 while the local row was already gone, letting the next pull
 *    recreate it.
 * 2. Outlook still connects read-only regardless. Unlike the deleted
 *    `unlock.test.ts` assertion this replaces — which inserted a fixture
 *    with isReadOnly: true and then asserted it read back true, proving
 *    nothing about the route at all — this one calls the actual connect
 *    handler and would fail if sync.routes.ts's Outlook branch were ever
 *    flipped to isReadOnly: false.
 */

const getGoogleCalendarAccessRole = vi.fn();
const syncCalendarFromGoogle = vi.fn();
const syncCalendarFromOutlook = vi.fn();

vi.mock('../../src/modules/calendars/google-sync.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getGoogleCalendarAccessRole: (...args: unknown[]) => getGoogleCalendarAccessRole(...args),
  syncCalendarFromGoogle: (...args: unknown[]) => syncCalendarFromGoogle(...args),
}));

vi.mock('../../src/modules/calendars/outlook-sync.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  syncCalendarFromOutlook: (...args: unknown[]) => syncCalendarFromOutlook(...args),
}));

const { redis } = await import('../../src/config/redis.js');
const { setupRouteTest } = await import('../helpers/route-harness.js');

let ctx: RouteTestContext;
let user: TestUser;

beforeEach(async () => {
  getGoogleCalendarAccessRole.mockReset();
  syncCalendarFromGoogle.mockReset().mockResolvedValue({ created: 0, updated: 0, deleted: 0 });
  syncCalendarFromOutlook.mockReset().mockResolvedValue({ created: 0, updated: 0, deleted: 0 });

  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold('Connect writability');
  user = await ctx.createUser(householdId, 'admin');
});

afterEach(async () => {
  await ctx.close();
});

async function connectGoogle(googleCalendarId: string) {
  await redis.setex(
    `oauth:google:tokens:${user.id}`,
    600,
    JSON.stringify({ access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3_600_000 })
  );
  return user.fetch('/api/v1/calendars/sync/google/complete', {
    method: 'POST',
    body: JSON.stringify({ googleCalendarId, name: 'Test Google' }),
  });
}

async function connectOutlook(outlookCalendarId: string) {
  await redis.setex(
    `oauth:outlook:tokens:${user.id}`,
    600,
    JSON.stringify({ access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3_600_000 })
  );
  return user.fetch('/api/v1/calendars/sync/outlook/complete', {
    method: 'POST',
    body: JSON.stringify({ outlookCalendarId, name: 'Test Outlook' }),
  });
}

describe('POST /calendars/sync/google/complete', () => {
  it.each([
    ['owner', false],
    ['writer', false],
    ['reader', true],
    ['freeBusyReader', true],
    [undefined, true],
  ] as const)('accessRole %s connects with isReadOnly %s', async (accessRole, expectedReadOnly) => {
    getGoogleCalendarAccessRole.mockResolvedValueOnce(accessRole);

    const res = await connectGoogle(`g-${accessRole ?? 'none'}@group.calendar.google.com`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.calendar.isReadOnly).toBe(expectedReadOnly);
  });

  it('re-reads the role from Google rather than trusting the request body', async () => {
    getGoogleCalendarAccessRole.mockResolvedValueOnce('reader');

    const res = await connectGoogle('some-shared-calendar@group.calendar.google.com');
    expect(res.status).toBe(200);

    // The route body never carries a role at all — the only source of truth
    // is the server-side call this test just proved gets made.
    expect(getGoogleCalendarAccessRole).toHaveBeenCalledWith(
      'at',
      'some-shared-calendar@group.calendar.google.com'
    );
    const body = await res.json();
    expect(body.data.calendar.isReadOnly).toBe(true);
  });
});

describe('POST /calendars/sync/outlook/complete', () => {
  it('always connects read-only — there is no outbound path for Outlook', async () => {
    const res = await connectOutlook('o-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.calendar.isReadOnly).toBe(true);
  });
});

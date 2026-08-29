import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RouteTestContext, TestUser } from '../helpers/route-harness.js';

/**
 * When Google refuses a request during the connect flow, the household has to
 * be told what to do about it.
 *
 * Observed on a live box: the Google Cloud project had not enabled the
 * Calendar API. Google returned a 403 whose message named the problem and
 * carried a one-click activation URL. The route did not catch it, so Fastify's
 * handler turned it into a generic 500 and the calendar picker rendered an
 * empty dropdown — no error, no explanation, nothing to act on. Diagnosing it
 * required reading the box's journal.
 */

const listGoogleCalendars = vi.fn();

vi.mock('../../src/modules/calendars/google-sync.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listGoogleCalendars: (...args: unknown[]) => listGoogleCalendars(...args),
}));

const { redis } = await import('../../src/config/redis.js');
const { setupRouteTest } = await import('../helpers/route-harness.js');

let ctx: RouteTestContext;
let user: TestUser;

const serviceDisabled = () =>
  Object.assign(
    new Error(
      'Google Calendar API has not been used in project 461160055088 before or ' +
        'it is disabled. Enable it by visiting ' +
        'https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=461160055088 ' +
        'then retry.'
    ),
    {
      code: 403,
      response: {
        data: { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } },
      },
    }
  );

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold('Connect errors');
  user = await ctx.createUser(householdId, 'admin');
  await redis.setex(
    `oauth:google:tokens:${user.id}`,
    600,
    JSON.stringify({ access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3_600_000 })
  );
});

afterAll(async () => {
  await redis.del(`oauth:google:tokens:${user.id}`);
  await ctx.close();
});

describe('GET /calendars/sync/google/calendars', () => {
  it("surfaces Google's explanation instead of an unhandled 500", async () => {
    listGoogleCalendars.mockRejectedValueOnce(serviceDisabled());

    const res = await user.fetch('/api/v1/calendars/sync/google/calendars');
    const body = await res.json();

    // Not a generic 500 — the household must be able to act on this.
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(body)).toMatch(/Calendar API/i);
    expect(JSON.stringify(body)).toContain('calendar-json.googleapis.com');
  });

  it('still returns the calendar list when Google is happy', async () => {
    listGoogleCalendars.mockResolvedValueOnce([
      { id: 'primary', summary: 'Sam', primary: true },
    ]);

    const res = await user.fetch('/api/v1/calendars/sync/google/calendars');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.calendars).toHaveLength(1);
  });
});

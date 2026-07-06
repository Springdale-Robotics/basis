import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { deviceRules, devices } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * July 2026 review, platform-ops MEDIUM #6: GET /:id/rules read rules for any
 * device id with no household check, and DELETE .../rules/:ruleId deleted any
 * rule by id alone.
 */

let ctx: RouteTestContext;
let adminA: TestUser;
let adminB: TestUser;
let bDeviceId: string;
let bRuleId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  const hhA = await ctx.createHousehold('Devices A');
  const hhB = await ctx.createHousehold('Devices B');
  adminA = await ctx.createUser(hhA, 'admin');
  adminB = await ctx.createUser(hhB, 'admin');

  const [device] = await db
    .insert(devices)
    .values({ householdId: hhB, name: 'B Tablet', type: 'tablet' })
    .returning({ id: devices.id });
  bDeviceId = device.id;

  const [rule] = await db
    .insert(deviceRules)
    .values({ deviceId: bDeviceId, ruleType: 'always', allowedPages: [], deniedPages: [] })
    .returning({ id: deviceRules.id });
  bRuleId = rule.id;
});

afterAll(async () => {
  await ctx.close();
});

describe('device rules tenancy', () => {
  it('GET /:id/rules denies a foreign device', async () => {
    const res = await adminA.fetch(`/api/v1/devices/${bDeviceId}/rules`);
    expect(res.status).toBe(404);

    const own = await adminB.fetch(`/api/v1/devices/${bDeviceId}/rules`);
    expect(own.status).toBe(200);
  });

  it('DELETE .../rules/:ruleId cannot delete a foreign rule', async () => {
    const res = await adminA.fetch(`/api/v1/devices/${bDeviceId}/rules/${bRuleId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);

    const rows = await db
      .select({ id: deviceRules.id })
      .from(deviceRules)
      .where(eq(deviceRules.id, bRuleId));
    expect(rows).toHaveLength(1);
  });
});

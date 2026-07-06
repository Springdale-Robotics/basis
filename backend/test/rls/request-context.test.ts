import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * RLS stage 2 — prove the request plumbing. An authenticated request must run
 * its DB queries under `SET ROLE basis_rls` with app.household_id set to the
 * caller's household. A broken context would silently fall back to the owner
 * (RLS bypassed) and still return correct data via the app-level filters, so
 * this asserts the DB role + household directly via /auth/db-context.
 */

let ctx: RouteTestContext;
let userA: TestUser;
let userB: TestUser;

beforeAll(async () => {
  ctx = await setupRouteTest();
  const hhA = await ctx.createHousehold('RLS Ctx A');
  const hhB = await ctx.createHousehold('RLS Ctx B');
  userA = await ctx.createUser(hhA, 'admin');
  userB = await ctx.createUser(hhB, 'admin');
});

afterAll(async () => {
  await ctx.close();
});

describe('RLS request context plumbing', () => {
  it('runs request queries as basis_rls scoped to the caller household', async () => {
    const res = await userA.fetch('/api/v1/auth/db-context');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { role: string; household: string } };
    expect(body.data.role).toBe('basis_rls');
    expect(body.data.household).toBe(userA.householdId);
  });

  it('scopes each request to its own household (no cross-request leak)', async () => {
    const [aRes, bRes] = await Promise.all([
      userA.fetch('/api/v1/auth/db-context'),
      userB.fetch('/api/v1/auth/db-context'),
    ]);
    const a = (await aRes.json()) as { data: { household: string } };
    const b = (await bRes.json()) as { data: { household: string } };
    expect(a.data.household).toBe(userA.householdId);
    expect(b.data.household).toBe(userB.householdId);
    expect(a.data.household).not.toBe(b.data.household);
  });

  it('repeated requests on the same user keep the right context (pool reuse)', async () => {
    // Fire several in sequence + parallel; a leaked/dirty pooled connection
    // would surface here as the wrong household.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => userA.fetch('/api/v1/auth/db-context')),
    );
    for (const res of results) {
      const body = (await res.json()) as { data: { role: string; household: string } };
      expect(body.data.role).toBe('basis_rls');
      expect(body.data.household).toBe(userA.householdId);
    }
  });
});

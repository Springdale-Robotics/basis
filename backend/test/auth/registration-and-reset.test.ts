import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { sessions } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * July 2026 review, auth CRITICALs: /auth/register accepted any request with
 * a valid householdId (self-escalation for kids/visitors, internet-reachable
 * with remote access), and password reset pretended to email a link no mailer
 * could send. Registration now requires an invite; recovery is an admin reset.
 */

let ctx: RouteTestContext;
let admin: TestUser;
let member: TestUser;
let otherAdmin: TestUser;
let hhId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  hhId = await ctx.createHousehold('Auth Fixes');
  admin = await ctx.createUser(hhId, 'admin');
  member = await ctx.createUser(hhId, 'member');
  const otherHh = await ctx.createHousehold('Auth Fixes B');
  otherAdmin = await ctx.createUser(otherHh, 'admin');
});

afterAll(async () => {
  await ctx.close();
});

describe('registration is invite-only', () => {
  it('POST /auth/register no longer exists', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'intruder@test.local',
        password: 'password123',
        displayName: 'Intruder',
        householdId: hhId,
      }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /auth/forgot-password no longer exists', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'someone@test.local' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('admin password reset', () => {
  it('an admin can reset a member password, revoking their sessions', async () => {
    const res = await admin.fetch(`/api/v1/users/${member.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'brand-new-password' }),
    });
    expect(res.status).toBe(200);

    // All of the member's sessions are gone
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, member.id));
    expect(rows).toHaveLength(0);
  });

  it('a member cannot reset passwords', async () => {
    // member's session was just revoked; mint a fresh member
    const member2 = await ctx.createUser(hhId, 'member');
    const res = await member2.fetch(`/api/v1/users/${admin.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'hostile-password' }),
    });
    expect(res.status).toBe(403);
  });

  it('an admin cannot reset a password outside their household', async () => {
    const res = await otherAdmin.fetch(`/api/v1/users/${admin.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'cross-tenant-pass' }),
    });
    expect(res.status).toBe(404);

    // The admin's session still works
    const me = await admin.fetch('/api/v1/auth/me');
    expect(me.status).toBe(200);
  });

  it('an admin cannot use it on their own account', async () => {
    const res = await admin.fetch(`/api/v1/users/${admin.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'self-reset-pass' }),
    });
    expect(res.status).toBe(400);
  });
});

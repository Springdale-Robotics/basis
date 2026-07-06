import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { lists, permissions } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * July 2026 review, auth HIGH: PATCH/DELETE /permissions/:type/:id/:permissionId
 * authorized the caller against the URL resource but then mutated the
 * permission row by id alone — admin on one resource could edit or delete any
 * permission row in the database, including other households'. The mutation
 * must be scoped to (id, resourceType, resourceId).
 */

let ctx: RouteTestContext;
let userA: TestUser;
let userB: TestUser;
let aListId: string;
let bListId: string;
let bPermissionId: string;

async function makeList(householdId: string, createdBy: string, name: string): Promise<string> {
  const [row] = await db
    .insert(lists)
    .values({ householdId, name, createdBy })
    .returning({ id: lists.id });
  return row.id;
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  const hhA = await ctx.createHousehold('Perms A');
  const hhB = await ctx.createHousehold('Perms B');
  userA = await ctx.createUser(hhA, 'admin');
  userB = await ctx.createUser(hhB, 'admin');

  aListId = await makeList(hhA, userA.id, 'A List');
  bListId = await makeList(hhB, userB.id, 'B List');

  // Household B's permission row — the target of the attack
  const [bPerm] = await db
    .insert(permissions)
    .values({
      resourceType: 'list',
      resourceId: bListId,
      granteeType: 'user',
      granteeId: userB.id,
      permissionLevel: 'view',
      createdBy: userB.id,
    })
    .returning({ id: permissions.id });
  bPermissionId = bPerm.id;
});

afterAll(async () => {
  await ctx.close();
});

describe('permission mutation scoping', () => {
  it('PATCH cannot edit a permission row belonging to a different resource', async () => {
    // userA is authorized on their own list, but passes B's permission id
    const res = await userA.fetch(`/api/v1/permissions/list/${aListId}/${bPermissionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ level: 'admin' }),
    });
    expect(res.status).toBe(404);

    const [bPerm] = await db
      .select()
      .from(permissions)
      .where(eq(permissions.id, bPermissionId));
    expect(bPerm.permissionLevel).toBe('view');
  });

  it('DELETE cannot revoke a permission row belonging to a different resource', async () => {
    const res = await userA.fetch(`/api/v1/permissions/list/${aListId}/${bPermissionId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);

    const rows = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.id, bPermissionId));
    expect(rows).toHaveLength(1);
  });

  it('PATCH and DELETE still work for a permission on the authorized resource', async () => {
    // Grant via the API, then update and revoke it
    const grant = await userA.fetch(`/api/v1/permissions/list/${aListId}`, {
      method: 'POST',
      body: JSON.stringify({ granteeType: 'user', granteeId: userA.id, level: 'view' }),
    });
    expect(grant.status).toBe(200);
    const granted = (await grant.json()) as any;
    const permissionId = granted.data.permission.id;

    const patch = await userA.fetch(`/api/v1/permissions/list/${aListId}/${permissionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ level: 'edit' }),
    });
    expect(patch.status).toBe(200);

    const del = await userA.fetch(`/api/v1/permissions/list/${aListId}/${permissionId}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);

    const rows = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.id, permissionId));
    expect(rows).toHaveLength(0);
  });
});

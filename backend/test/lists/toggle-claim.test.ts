import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { listItems, lists } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * July 2026 review, lists HIGHs: the toggle endpoint was toggle-only (offline
 * replays inverted other devices' changes), the wishlist claim was an
 * unguarded check-then-write (two simultaneous claims both "won" → duplicate
 * gifts), and item mutations never verified the list belonged to the caller's
 * household.
 */

let ctx: RouteTestContext;
let userA: TestUser;
let userB: TestUser;
let userC: TestUser;
let foreignUser: TestUser;
let hhId: string;
let checklistId: string;
let wishlistId: string;

async function makeItem(listId: string, content: string): Promise<string> {
  const [row] = await db
    .insert(listItems)
    .values({ listId, content, createdBy: userA.id })
    .returning({ id: listItems.id });
  return row.id;
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  hhId = await ctx.createHousehold('Lists Semantics');
  userA = await ctx.createUser(hhId, 'admin');
  userB = await ctx.createUser(hhId, 'admin');
  userC = await ctx.createUser(hhId, 'admin');
  const foreignHh = await ctx.createHousehold('Lists Foreign');
  foreignUser = await ctx.createUser(foreignHh, 'admin');

  const [checklist] = await db
    .insert(lists)
    .values({ householdId: hhId, name: 'Groceries', type: 'checklist', createdBy: userA.id })
    .returning({ id: lists.id });
  checklistId = checklist.id;

  const [wishlist] = await db
    .insert(lists)
    .values({
      householdId: hhId,
      name: 'Birthday',
      type: 'wishlist',
      recipientUserId: userA.id,
      createdBy: userA.id,
    })
    .returning({ id: lists.id });
  wishlistId = wishlist.id;
});

afterAll(async () => {
  await ctx.close();
});

describe('toggle accepts an explicit target state', () => {
  it('setting isChecked=true twice is idempotent (replay-safe)', async () => {
    const itemId = await makeItem(checklistId, 'Milk');

    // Device B checks it online
    const first = await userB.fetch(`/api/v1/lists/${checklistId}/items/${itemId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ isChecked: true }),
    });
    expect(first.status).toBe(200);

    // Device A's offline queue replays its own "check" — must NOT invert
    const replay = await userA.fetch(`/api/v1/lists/${checklistId}/items/${itemId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ isChecked: true }),
    });
    expect(replay.status).toBe(200);

    const [row] = await db.select().from(listItems).where(eq(listItems.id, itemId));
    expect(row.isChecked).toBe(true);
  });

  it('a body-less call still toggles (legacy clients)', async () => {
    const itemId = await makeItem(checklistId, 'Eggs');

    const res = await userA.fetch(`/api/v1/lists/${checklistId}/items/${itemId}/toggle`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    let [row] = await db.select().from(listItems).where(eq(listItems.id, itemId));
    expect(row.isChecked).toBe(true);

    const res2 = await userA.fetch(`/api/v1/lists/${checklistId}/items/${itemId}/toggle`, {
      method: 'POST',
    });
    expect(res2.status).toBe(200);
    [row] = await db.select().from(listItems).where(eq(listItems.id, itemId));
    expect(row.isChecked).toBe(false);
  });
});

describe('wishlist claim is race-safe', () => {
  it('concurrent claims produce exactly one winner', async () => {
    const itemId = await makeItem(wishlistId, 'Lego set');

    const [resB, resC] = await Promise.all([
      userB.fetch(`/api/v1/lists/${wishlistId}/items/${itemId}/claim`, { method: 'POST' }),
      userC.fetch(`/api/v1/lists/${wishlistId}/items/${itemId}/claim`, { method: 'POST' }),
    ]);

    const statuses = [resB.status, resC.status].sort();
    expect(statuses).toEqual([200, 409]);

    const [row] = await db.select().from(listItems).where(eq(listItems.id, itemId));
    expect(row.claimedByUserId).not.toBeNull();
  });

  it('claiming an already-claimed item conflicts; the claimant can unclaim', async () => {
    const itemId = await makeItem(wishlistId, 'Bicycle');

    const claim = await userB.fetch(`/api/v1/lists/${wishlistId}/items/${itemId}/claim`, {
      method: 'POST',
    });
    expect(claim.status).toBe(200);

    const steal = await userC.fetch(`/api/v1/lists/${wishlistId}/items/${itemId}/claim`, {
      method: 'POST',
    });
    expect(steal.status).toBe(409);

    const unclaim = await userB.fetch(`/api/v1/lists/${wishlistId}/items/${itemId}/claim`, {
      method: 'POST',
    });
    expect(unclaim.status).toBe(200);

    const [row] = await db.select().from(listItems).where(eq(listItems.id, itemId));
    expect(row.claimedByUserId).toBeNull();
  });

  it('the recipient never sees claim metadata in toggle/patch responses', async () => {
    const itemId = await makeItem(wishlistId, 'Book');
    await userB.fetch(`/api/v1/lists/${wishlistId}/items/${itemId}/claim`, { method: 'POST' });

    // userA is the wishlist recipient
    const patch = await userA.fetch(`/api/v1/lists/${wishlistId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'the sequel please' }),
    });
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as any;
    expect(patchBody.data.item.claimedByUserId).toBeNull();

    const toggle = await userA.fetch(`/api/v1/lists/${wishlistId}/items/${itemId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ isChecked: true }),
    });
    expect(toggle.status).toBe(200);
    const toggleBody = (await toggle.json()) as any;
    expect(toggleBody.data.item.claimedByUserId).toBeNull();
  });
});

describe('list item routes are household-scoped', () => {
  it('a foreign user cannot toggle, edit, delete, reorder, or clear', async () => {
    const itemId = await makeItem(checklistId, 'Butter');

    // Denied either by the resource permission middleware (403) or the
    // household ownership check (404) — both are acceptable rejections.
    const denied = [403, 404];

    const toggle = await foreignUser.fetch(
      `/api/v1/lists/${checklistId}/items/${itemId}/toggle`,
      { method: 'POST', body: JSON.stringify({ isChecked: true }) },
    );
    expect(denied).toContain(toggle.status);

    const patch = await foreignUser.fetch(`/api/v1/lists/${checklistId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: 'defaced' }),
    });
    expect(denied).toContain(patch.status);

    const del = await foreignUser.fetch(`/api/v1/lists/${checklistId}/items/${itemId}`, {
      method: 'DELETE',
    });
    expect(denied).toContain(del.status);

    const reorder = await foreignUser.fetch(`/api/v1/lists/${checklistId}/items/reorder`, {
      method: 'POST',
      body: JSON.stringify({ order: [{ id: itemId, sortOrder: 99 }] }),
    });
    expect(denied).toContain(reorder.status);

    const clear = await foreignUser.fetch(`/api/v1/lists/${checklistId}/items/checked`, {
      method: 'DELETE',
    });
    expect(denied).toContain(clear.status);

    const [row] = await db.select().from(listItems).where(eq(listItems.id, itemId));
    expect(row.content).toBe('Butter');
    expect(row.isChecked).toBe(false);
  });

  it('deleting a parent item cascades to its subtasks', async () => {
    const parentId = await makeItem(checklistId, 'Parent');
    const [child] = await db
      .insert(listItems)
      .values({
        listId: checklistId,
        content: 'Child',
        parentItemId: parentId,
        createdBy: userA.id,
      })
      .returning({ id: listItems.id });

    const del = await userA.fetch(`/api/v1/lists/${checklistId}/items/${parentId}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);

    const rows = await db
      .select({ id: listItems.id })
      .from(listItems)
      .where(eq(listItems.parentItemId, parentId));
    expect(rows).toHaveLength(0);

    const childRows = await db
      .select({ id: listItems.id })
      .from(listItems)
      .where(eq(listItems.id, child.id));
    expect(childRows).toHaveLength(0);
  });
});

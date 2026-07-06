import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  inventoryAreas,
  inventoryItems,
  inventoryStock,
  recipeIngredients,
  recipes,
} from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * Cross-household isolation tests for the inventory routes flagged in the
 * July 2026 review: any logged-in user could deplete, reconcile, zero out,
 * or inject stock belonging to another household. Every mutation here is
 * attempted by household A against household B's data and must 404 without
 * side effects — followed by a positive control proving the same call works
 * within the caller's own household.
 */

let ctx: RouteTestContext;
let userA: TestUser;
let userB: TestUser;

// Household B fixtures (the victim)
let bItemId: string;
let bAreaId: string;
let bStockId: string;
let bRecipeId: string;

// Household A fixtures (the attacker's own, for positive controls)
let aItemId: string;
let aItem2Id: string;
let aAreaId: string;
let aStockId: string;

async function makeItem(householdId: string, name: string): Promise<string> {
  const [row] = await db
    .insert(inventoryItems)
    .values({ householdId, name: `${name} ${randomUUID().slice(0, 8)}`, defaultUnit: 'g' })
    .returning({ id: inventoryItems.id });
  return row.id;
}

async function makeArea(householdId: string, name: string): Promise<string> {
  const [row] = await db
    .insert(inventoryAreas)
    .values({ householdId, name, locationType: 'pantry' })
    .returning({ id: inventoryAreas.id });
  return row.id;
}

async function makeStock(itemId: string, areaId: string, quantity = '500'): Promise<string> {
  const [row] = await db
    .insert(inventoryStock)
    .values({ itemId, areaId, quantity, unit: 'g', confidence: 100, source: 'manual' })
    .returning({ id: inventoryStock.id });
  return row.id;
}

async function stockCount(itemId: string): Promise<number> {
  const rows = await db
    .select({ id: inventoryStock.id })
    .from(inventoryStock)
    .where(eq(inventoryStock.itemId, itemId));
  return rows.length;
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  const hhA = await ctx.createHousehold('Tenancy A');
  const hhB = await ctx.createHousehold('Tenancy B');
  userA = await ctx.createUser(hhA, 'admin');
  userB = await ctx.createUser(hhB, 'admin');

  bItemId = await makeItem(hhB, 'B Flour');
  bAreaId = await makeArea(hhB, 'B Pantry');
  bStockId = await makeStock(bItemId, bAreaId);

  const [recipe] = await db
    .insert(recipes)
    .values({ householdId: hhB, title: 'B Secret Recipe', createdBy: userB.id })
    .returning({ id: recipes.id });
  bRecipeId = recipe.id;
  await db.insert(recipeIngredients).values({
    recipeId: bRecipeId,
    name: 'flour',
    inventoryItemId: bItemId,
  });

  aItemId = await makeItem(hhA, 'A Flour');
  aItem2Id = await makeItem(hhA, 'A Bread Flour');
  aAreaId = await makeArea(hhA, 'A Pantry');
  aStockId = await makeStock(aItemId, aAreaId);
});

afterAll(async () => {
  await ctx.close();
});

describe('inventory cross-household isolation', () => {
  it('GET /items/:id/confidence denies a foreign item', async () => {
    const res = await userA.fetch(`/api/v1/inventory/items/${bItemId}/confidence`);
    expect(res.status).toBe(404);

    const own = await userA.fetch(`/api/v1/inventory/items/${aItemId}/confidence`);
    expect(own.status).toBe(200);
  });

  it('POST /items/:id/deplete cannot touch a foreign item', async () => {
    const res = await userA.fetch(`/api/v1/inventory/items/${bItemId}/deplete`, {
      method: 'POST',
      body: JSON.stringify({ quantity: 100, unit: 'g' }),
    });
    expect(res.status).toBe(404);
    expect(await stockCount(bItemId)).toBe(1);

    const own = await userA.fetch(`/api/v1/inventory/items/${aItemId}/deplete`, {
      method: 'POST',
      body: JSON.stringify({ quantity: 100, unit: 'g' }),
    });
    expect(own.status).toBe(200);
  });

  it('POST /items/:id/reconcile cannot replace foreign stock', async () => {
    const res = await userA.fetch(`/api/v1/inventory/items/${bItemId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ quantity: 1, unit: 'g', areaId: bAreaId }),
    });
    expect(res.status).toBe(404);

    const [bStock] = await db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.id, bStockId));
    expect(bStock).toBeDefined();
    expect(parseFloat(bStock.quantity)).toBe(500);

    // Own item but foreign area must also be rejected
    const foreignArea = await userA.fetch(`/api/v1/inventory/items/${aItemId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ quantity: 1, unit: 'g', areaId: bAreaId }),
    });
    expect(foreignArea.status).toBe(404);

    const own = await userA.fetch(`/api/v1/inventory/items/${aItemId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ quantity: 250, unit: 'g', areaId: aAreaId }),
    });
    expect(own.status).toBe(200);
  });

  it('POST /items/:id/out-of-stock cannot zero a foreign item', async () => {
    const res = await userA.fetch(`/api/v1/inventory/items/${bItemId}/out-of-stock`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(await stockCount(bItemId)).toBe(1);
  });

  it('POST /stock cannot inject stock into a foreign household', async () => {
    const res = await userA.fetch('/api/v1/inventory/stock', {
      method: 'POST',
      body: JSON.stringify({ itemId: bItemId, areaId: bAreaId, quantity: 999 }),
    });
    expect(res.status).toBe(404);
    expect(await stockCount(bItemId)).toBe(1);

    // Own item + foreign area is also rejected
    const mixed = await userA.fetch('/api/v1/inventory/stock', {
      method: 'POST',
      body: JSON.stringify({ itemId: aItemId, areaId: bAreaId, quantity: 999 }),
    });
    expect(mixed.status).toBe(404);

    const own = await userA.fetch('/api/v1/inventory/stock', {
      method: 'POST',
      body: JSON.stringify({ itemId: aItemId, areaId: aAreaId, quantity: 10 }),
    });
    expect(own.status).toBe(200);
  });

  it('PATCH /stock/:id cannot re-point a row at a foreign item or area', async () => {
    const res = await userA.fetch(`/api/v1/inventory/stock/${aStockId}`, {
      method: 'PATCH',
      body: JSON.stringify({ itemId: bItemId }),
    });
    expect(res.status).toBe(404);

    const areaRes = await userA.fetch(`/api/v1/inventory/stock/${aStockId}`, {
      method: 'PATCH',
      body: JSON.stringify({ areaId: bAreaId }),
    });
    expect(areaRes.status).toBe(404);

    // And a foreign stock row can't be edited at all
    const foreignRow = await userA.fetch(`/api/v1/inventory/stock/${bStockId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 1 }),
    });
    expect(foreignRow.status).toBe(404);
  });

  it('POST /areas/reorder cannot move a foreign area', async () => {
    const res = await userA.fetch('/api/v1/inventory/areas/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: [{ id: bAreaId, sortOrder: 99 }] }),
    });
    expect(res.status).toBe(200);

    const [bArea] = await db
      .select()
      .from(inventoryAreas)
      .where(eq(inventoryAreas.id, bAreaId));
    expect(bArea.sortOrder).not.toBe(99);
  });

  it('GET /items/:id/linked-recipes does not leak foreign recipe links', async () => {
    const res = await userA.fetch(`/api/v1/inventory/items/${bItemId}/linked-recipes`);
    expect(res.status).toBe(404);
  });

  it('POST /items/:id/relink cannot rewrite foreign recipe ingredients', async () => {
    // Foreign source item
    const res = await userA.fetch(`/api/v1/inventory/items/${bItemId}/relink`, {
      method: 'POST',
      body: JSON.stringify({ newItemId: aItemId }),
    });
    expect(res.status).toBe(404);

    // Own source item, foreign target
    const res2 = await userA.fetch(`/api/v1/inventory/items/${aItemId}/relink`, {
      method: 'POST',
      body: JSON.stringify({ newItemId: bItemId }),
    });
    expect(res2.status).toBe(404);

    // B's ingredient link is untouched
    const [ing] = await db
      .select()
      .from(recipeIngredients)
      .where(
        and(
          eq(recipeIngredients.recipeId, bRecipeId),
          eq(recipeIngredients.inventoryItemId, bItemId)
        )
      );
    expect(ing).toBeDefined();

    // Positive control: relink within household A works
    const own = await userA.fetch(`/api/v1/inventory/items/${aItemId}/relink`, {
      method: 'POST',
      body: JSON.stringify({ newItemId: aItem2Id }),
    });
    expect(own.status).toBe(200);
  });
});

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

describe('inventory tenancy — defaultAreaId cannot point at another household', () => {
  /**
   * inventory_stock's RLS policy constrains item_id only, so nothing at the
   * database layer catches a foreign area_id. An item carrying another
   * household's defaultAreaId propagates into stock rows, and
   * inventory_stock.areaId is onDelete: cascade — so the other household
   * deleting that area silently deletes this household's stock.
   */

  it('POST /items refuses a foreign defaultAreaId and creates nothing', async () => {
    const res = await userA.fetch('/api/v1/inventory/items', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Foreign Area Create',
        defaultUnit: 'g',
        defaultAreaId: bAreaId,
      }),
    });
    expect(res.status).toBe(404);

    const leaked = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.name, 'Foreign Area Create'),
    });
    expect(leaked).toBeUndefined();

    // Positive control: the caller's own area is accepted.
    const own = await userA.fetch('/api/v1/inventory/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Own Area Create', defaultUnit: 'g', defaultAreaId: aAreaId }),
    });
    expect(own.status).toBe(200);
  });

  it('PATCH /items/:id refuses a foreign defaultAreaId and leaves the item unchanged', async () => {
    const before = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, aItemId),
    });

    const res = await userA.fetch(`/api/v1/inventory/items/${aItemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ defaultAreaId: bAreaId }),
    });
    expect(res.status).toBe(404);

    const after = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, aItemId),
    });
    expect(after?.defaultAreaId).toBe(before?.defaultAreaId ?? null);

    // Positive control. (This schema is `.optional()` but not `.nullable()`,
    // so clearing via null is a 400 from Zod — only batch-update accepts null.)
    expect(
      (
        await userA.fetch(`/api/v1/inventory/items/${aItemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ defaultAreaId: aAreaId }),
        })
      ).status
    ).toBe(200);
  });

  it('POST /items/quick-create refuses a foreign defaultAreaId', async () => {
    const res = await userA.fetch('/api/v1/inventory/items/quick-create', {
      method: 'POST',
      body: JSON.stringify({ name: 'Foreign Area Quick', defaultAreaId: bAreaId }),
    });
    expect(res.status).toBe(404);

    const leaked = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.name, 'Foreign Area Quick'),
    });
    expect(leaked).toBeUndefined();

    const own = await userA.fetch('/api/v1/inventory/items/quick-create', {
      method: 'POST',
      body: JSON.stringify({ name: 'Own Area Quick', defaultAreaId: aAreaId }),
    });
    expect(own.status).toBe(200);
  });

  it('POST /items/batch refuses the whole batch when one item names a foreign area', async () => {
    const res = await userA.fetch('/api/v1/inventory/items/batch', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { name: 'Batch Good', defaultUnit: 'g', defaultAreaId: aAreaId },
          { name: 'Batch Foreign', defaultUnit: 'g', defaultAreaId: bAreaId },
        ],
      }),
    });
    expect(res.status).toBe(404);

    // All-or-nothing: the valid sibling must not have been inserted either.
    const good = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.name, 'Batch Good'),
    });
    expect(good).toBeUndefined();

    const own = await userA.fetch('/api/v1/inventory/items/batch', {
      method: 'POST',
      body: JSON.stringify({ items: [{ name: 'Batch Own', defaultUnit: 'g', defaultAreaId: aAreaId }] }),
    });
    expect(own.status).toBe(200);
  });

  it('POST /items/batch-update refuses a foreign defaultAreaId', async () => {
    const res = await userA.fetch('/api/v1/inventory/items/batch-update', {
      method: 'POST',
      body: JSON.stringify({ itemIds: [aItemId], updates: { defaultAreaId: bAreaId } }),
    });
    expect(res.status).toBe(404);

    const after = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, aItemId),
    });
    expect(after?.defaultAreaId).not.toBe(bAreaId);

    const own = await userA.fetch('/api/v1/inventory/items/batch-update', {
      method: 'POST',
      body: JSON.stringify({ itemIds: [aItemId], updates: { defaultAreaId: aAreaId } }),
    });
    expect(own.status).toBe(200);
  });

  it('POST /shopping-list/put-away refuses a foreign fallback area', async () => {
    // This one writes area_id straight onto inventory_stock, where RLS offers
    // no protection at all.
    const stockInBAreaBefore = (
      await db.select().from(inventoryStock).where(eq(inventoryStock.areaId, bAreaId))
    ).length;

    const res = await userA.fetch('/api/v1/inventory/shopping-list/put-away', {
      method: 'POST',
      body: JSON.stringify({ defaultAreaId: bAreaId }),
    });
    expect(res.status).toBe(404);

    // B legitimately has its own stock in that area, so count rather than
    // asserting emptiness — what matters is that put-away added nothing.
    const after = await db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.areaId, bAreaId));
    expect(after).toHaveLength(stockInBAreaBefore);

    const own = await userA.fetch('/api/v1/inventory/shopping-list/put-away', {
      method: 'POST',
      body: JSON.stringify({ defaultAreaId: aAreaId }),
    });
    expect(own.status).toBe(200);
  });
});

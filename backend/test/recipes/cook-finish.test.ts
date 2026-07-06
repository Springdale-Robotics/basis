import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  inventoryAreas,
  inventoryItems,
  inventoryStock,
  mealPlans,
  recipeIngredients,
  recipes,
} from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * July 2026 review, recipes HIGH #2: cook-flow deduction always ran at 1x
 * (the frontend never passed a session or multiplier) and the meal-plan
 * "cooked" state was unreachable. /finish now accepts servingsMultiplier
 * directly and the frontend passes multiplier + mealPlanId through cook mode.
 */

let ctx: RouteTestContext;
let user: TestUser;
let hhId: string;
let recipeId: string;
let itemId: string;

async function totalStock(item: string): Promise<number> {
  const rows = await db
    .select({ quantity: inventoryStock.quantity })
    .from(inventoryStock)
    .where(eq(inventoryStock.itemId, item));
  return rows.reduce((s, r) => s + parseFloat(r.quantity), 0);
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  hhId = await ctx.createHousehold('Cook Finish');
  user = await ctx.createUser(hhId, 'admin');

  const [area] = await db
    .insert(inventoryAreas)
    .values({ householdId: hhId, name: 'Pantry', locationType: 'pantry' })
    .returning({ id: inventoryAreas.id });

  const [item] = await db
    .insert(inventoryItems)
    .values({ householdId: hhId, name: 'Cook Flour', defaultUnit: 'g' })
    .returning({ id: inventoryItems.id });
  itemId = item.id;

  await db.insert(inventoryStock).values({
    itemId,
    areaId: area.id,
    quantity: '1000',
    unit: 'g',
    confidence: 100,
    source: 'manual',
  });

  const [recipe] = await db
    .insert(recipes)
    .values({ householdId: hhId, title: 'Scaled Bread', createdBy: user.id, servings: 2 })
    .returning({ id: recipes.id });
  recipeId = recipe.id;

  await db.insert(recipeIngredients).values({
    recipeId,
    name: 'flour',
    inventoryItemId: itemId,
    quantity: '100',
    unit: 'g',
  });
});

afterAll(async () => {
  await ctx.close();
});

describe('cook finish', () => {
  it('deducts at the requested servings multiplier and marks the meal plan cooked', async () => {
    const [mealPlan] = await db
      .insert(mealPlans)
      .values({
        householdId: hhId,
        recipeId,
        plannedDate: '2026-07-05',
        mealType: 'dinner',
        servingsMultiplier: '2',
      })
      .returning({ id: mealPlans.id });

    const before = await totalStock(itemId);

    const res = await user.fetch(`/api/v1/recipes/${recipeId}/finish`, {
      method: 'POST',
      body: JSON.stringify({
        deductInventory: true,
        servingsMultiplier: 2,
        mealPlanId: mealPlan.id,
      }),
    });
    expect(res.status).toBe(200);

    const after = await totalStock(itemId);
    // 100 g x 2 servings multiplier
    expect(before - after).toBeCloseTo(200, 3);

    const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, mealPlan.id));
    expect(plan.cookedAt).not.toBeNull();
  });

  it('deducts at 1x when no multiplier is sent', async () => {
    const before = await totalStock(itemId);

    const res = await user.fetch(`/api/v1/recipes/${recipeId}/finish`, {
      method: 'POST',
      body: JSON.stringify({ deductInventory: true }),
    });
    expect(res.status).toBe(200);

    const after = await totalStock(itemId);
    expect(before - after).toBeCloseTo(100, 3);
  });

  it('marks the meal plan cooked even without deduction', async () => {
    const [mealPlan] = await db
      .insert(mealPlans)
      .values({
        householdId: hhId,
        recipeId,
        plannedDate: '2026-07-06',
        mealType: 'lunch',
      })
      .returning({ id: mealPlans.id });

    const res = await user.fetch(`/api/v1/recipes/${recipeId}/finish`, {
      method: 'POST',
      body: JSON.stringify({ deductInventory: false, mealPlanId: mealPlan.id }),
    });
    expect(res.status).toBe(200);

    const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, mealPlan.id));
    expect(plan.cookedAt).not.toBeNull();
  });

  it('cook-session endpoints are household-scoped', async () => {
    const foreignHh = await ctx.createHousehold('Cook Foreign');
    const foreign = await ctx.createUser(foreignHh, 'admin');

    const start = await foreign.fetch(`/api/v1/recipes/${recipeId}/cook`, {
      method: 'POST',
      body: JSON.stringify({ servingsMultiplier: 2 }),
    });
    expect(start.status).toBe(404);

    const own = await user.fetch(`/api/v1/recipes/${recipeId}/cook`, {
      method: 'POST',
      body: JSON.stringify({ servingsMultiplier: 2 }),
    });
    expect(own.status).toBe(200);
    const session = ((await own.json()) as any).data.session;

    const foreignGet = await foreign.fetch(`/api/v1/recipes/cooking/${session.id}`);
    expect(foreignGet.status).toBe(404);

    const ownGet = await user.fetch(`/api/v1/recipes/cooking/${session.id}`);
    expect(ownGet.status).toBe(200);
  });
});

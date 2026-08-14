import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  setupRouteTest,
  json,
  type RouteTestContext,
  type TestUser,
} from '../helpers/route-harness.js';
import { db } from '../../src/config/database.js';
import { inventoryItems, ingredientAliases } from '../../src/db/schema/index.js';

let ctx: RouteTestContext;
let user: TestUser;
let householdId: string;
let itemId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Alias Admin');
  user = await ctx.createUser(householdId, 'admin');
  const [item] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', internalId: 'HM-ALIASUI' })
    .returning();
  itemId = item.id;
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

async function seedAlias(aliasName: string, canonicalItemId = itemId, owner = householdId) {
  const [row] = await db
    .insert(ingredientAliases)
    .values({ householdId: owner, canonicalItemId, aliasName, aliasType: 'exact' })
    .returning();
  return row;
}

describe('GET /inventory/ingredient-aliases', () => {
  it('lists what the household has learned, with the item each points at', async () => {
    await seedAlias('evoo');
    const res = await user.fetch('/api/v1/inventory/ingredient-aliases');
    const body = await json(res);

    expect(res.status).toBe(200);
    const evoo = body.data.aliases.find((a: { aliasName: string }) => a.aliasName === 'evoo');
    expect(evoo).toMatchObject({ aliasName: 'evoo', itemId, itemName: 'Olive Oil' });
  });

  it('tidies the stored key for display', async () => {
    // Descriptor stripping leaves punctuation behind in the persisted key
    // (", chicken breast"). The key is frozen — other modules read the table
    // with the same normalizer — so it's cleaned for display only.
    await seedAlias(', chicken breast');
    const body = await json(await user.fetch('/api/v1/inventory/ingredient-aliases'));
    const row = body.data.aliases.find((a: { aliasName: string }) => a.aliasName === ', chicken breast');
    expect(row.displayName).toBe('chicken breast');
  });

  it('does not leak another household\'s learned names', async () => {
    const otherHousehold = await ctx.createHousehold('Someone Else');
    const [otherItem] = await db
      .insert(inventoryItems)
      .values({ householdId: otherHousehold, name: 'Their Oil', internalId: 'HM-ALIASX' })
      .returning();
    await seedAlias('their secret name', otherItem.id, otherHousehold);

    const body = await json(await user.fetch('/api/v1/inventory/ingredient-aliases'));
    const names = body.data.aliases.map((a: { aliasName: string }) => a.aliasName);
    expect(names).not.toContain('their secret name');
  });
});

describe('DELETE /inventory/ingredient-aliases/:id', () => {
  it('forgets a learned name', async () => {
    const alias = await seedAlias('liquid gold');
    const res = await user.fetch(`/api/v1/inventory/ingredient-aliases/${alias.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);

    const remaining = await db.query.ingredientAliases.findFirst({
      where: eq(ingredientAliases.id, alias.id),
    });
    expect(remaining).toBeUndefined();
  });

  it('refuses to delete an alias belonging to another household', async () => {
    const otherHousehold = await ctx.createHousehold('Not Yours');
    const [otherItem] = await db
      .insert(inventoryItems)
      .values({ householdId: otherHousehold, name: 'Their Salt', internalId: 'HM-ALIASY' })
      .returning();
    const alias = await seedAlias('theirs', otherItem.id, otherHousehold);

    const res = await user.fetch(`/api/v1/inventory/ingredient-aliases/${alias.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);

    const stillThere = await db.query.ingredientAliases.findFirst({
      where: eq(ingredientAliases.id, alias.id),
    });
    expect(stillThere).toBeTruthy();
  });
});

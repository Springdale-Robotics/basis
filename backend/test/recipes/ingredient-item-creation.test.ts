import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  setupRouteTest,
  json,
  type RouteTestContext,
  type TestUser,
} from '../helpers/route-harness.js';
import { db } from '../../src/config/database.js';
import { inventoryItems } from '../../src/db/schema/index.js';
import { isCRFParserAvailable } from '../../src/services/crf-ingredient-parser.js';

const crfUp = await isCRFParserAvailable();
if (!crfUp) {
  console.warn('[ingredient-item-creation.test] CRF unreachable — naming tests skipped');
}

let ctx: RouteTestContext;
let user: TestUser;
let householdId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Catalog Building');
  user = await ctx.createUser(householdId, 'admin');
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

const createItems = (ingredients: Array<{ name: string; unit?: string }>) =>
  user.fetch('/api/v1/recipes/ingredients/create-items', {
    method: 'POST',
    body: JSON.stringify({ ingredients }),
  });

const catalog = () =>
  db.query.inventoryItems.findMany({ where: eq(inventoryItems.householdId, householdId) });

describe.skipIf(!crfUp)('POST /recipes/ingredients/create-items', () => {
  it('names items for a catalog, not for a recipe line', async () => {
    const res = await createItems([
      { name: 'boneless, skinless chicken breasts', unit: 'piece' },
      { name: 'extra-virgin olive oil', unit: 'cup' },
    ]);
    const { data } = await json(res);

    expect(res.status).toBe(200);
    // Previously these went in verbatim, so the catalog filled up with
    // "boneless, skinless chicken breasts".
    const names = data.results.map((r: { itemName: string }) => r.itemName).sort();
    expect(names).toEqual(['Chicken Breast', 'Olive Oil']);
    expect(data.results.every((r: { action: string }) => r.action === 'created')).toBe(true);
  });

  it('assigns a category so new items are not uncategorised', async () => {
    const { data } = await json(await createItems([{ name: 'ground beef' }]));
    const item = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, data.results[0].itemId),
    });
    expect(item?.category).toBe('Meat');
  });

  it('does not seed defaultUnit from a recipe measurement', async () => {
    // "2 tbsp butter" says nothing about how butter is stocked, and a wrong
    // defaultUnit silently corrupts every later conversion.
    const { data } = await json(await createItems([{ name: 'unsalted butter', unit: 'tbsp' }]));
    const item = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, data.results[0].itemId),
    });
    expect(item?.defaultUnit).toBeNull();
  });

  it('keeps a container unit, which is a plausible way to stock something', async () => {
    const { data } = await json(await createItems([{ name: 'crusty bread', unit: 'loaf' }]));
    const item = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, data.results[0].itemId),
    });
    expect(item?.defaultUnit).toBe('loaf');
  });

  it('links to an item that already exists instead of duplicating it', async () => {
    const before = (await catalog()).length;
    const { data } = await json(await createItems([{ name: 'Ground beef' }]));

    expect(data.results[0].action).toBe('linked');
    expect((await catalog()).length).toBe(before);
  });

  it('creates one item when several ingredients canonicalise to the same name', async () => {
    // The review found a second recipe re-creating "olive oil" three minutes
    // after the first, because each row was resolved against a stale catalog.
    const before = (await catalog()).length;
    const { data } = await json(
      await createItems([
        { name: 'chopped fresh parsley' },
        { name: 'finely chopped parsley' },
        { name: 'parsley, chopped' },
      ])
    );

    const itemIds = new Set(data.results.map((r: { itemId: string }) => r.itemId));
    expect(itemIds.size).toBe(1);
    expect((await catalog()).length).toBe(before + 1);
  });

  it('reports a near-match rather than silently substituting it', async () => {
    // "Olive Oil" exists from the first test. A household may legitimately
    // stock light olive oil separately, so this is theirs to decide.
    const { data } = await json(await createItems([{ name: 'light olive oil' }]));
    const result = data.results[0];

    expect(result.action).toBe('created');
    expect(result.similarTo?.name).toBe('Olive Oil');
  });

  it('maps every input name to a result, so the caller can fan them back out', async () => {
    const inputs = [{ name: 'smoked paprika' }, { name: 'ground cumin' }];
    const { data } = await json(await createItems(inputs));
    expect(data.results.map((r: { originalName: string }) => r.originalName)).toEqual([
      'smoked paprika',
      'ground cumin',
    ]);
  });
});

describe('POST /recipes/ingredients/create-items — access control', () => {
  it('refuses a member without inventory edit rights', async () => {
    const visitor = await ctx.createUser(householdId, 'visitor');
    const res = await visitor.fetch('/api/v1/recipes/ingredients/create-items', {
      method: 'POST',
      body: JSON.stringify({ ingredients: [{ name: 'contraband' }] }),
    });
    expect(res.status).toBe(403);
  });

  it('creates items only in the caller\'s own household', async () => {
    const otherHousehold = await ctx.createHousehold('Elsewhere');
    const other = await ctx.createUser(otherHousehold, 'admin');

    await other.fetch('/api/v1/recipes/ingredients/create-items', {
      method: 'POST',
      body: JSON.stringify({ ingredients: [{ name: 'saffron threads' }] }),
    });

    const mine = await catalog();
    expect(mine.map((i) => i.name)).not.toContain('Saffron Thread');
  });
});

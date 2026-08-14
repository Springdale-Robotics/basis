import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  setupRouteTest,
  json,
  type RouteTestContext,
  type TestUser,
} from '../helpers/route-harness.js';
import { db } from '../../src/config/database.js';
import { inventoryItems, recipeIngredients, recipes } from '../../src/db/schema/index.js';
import { isCRFParserAvailable } from '../../src/services/crf-ingredient-parser.js';

const crfUp = await isCRFParserAvailable();
if (!crfUp) {
  console.warn('[import-confirm.test] CRF unreachable — confirm tests skipped');
}

let ctx: RouteTestContext;
let user: TestUser;
let householdId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Import Confirm');
  user = await ctx.createUser(householdId, 'admin');
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

const post = (path: string, body: unknown) =>
  user.fetch(path, { method: 'POST', body: JSON.stringify(body) });

async function importText(text: string) {
  const started = await json(await post('/api/v1/recipes/import/start', {
    sourceType: 'text',
    sourceData: text,
    rawText: text,
  }));
  const sessionId = started.data.sessionId as string;
  const fetched = await json(await user.fetch(`/api/v1/recipes/import/${sessionId}`));
  return { sessionId, session: fetched.data.session };
}

const storedIngredients = (recipeId: string) =>
  db.query.recipeIngredients.findMany({ where: eq(recipeIngredients.recipeId, recipeId) });

describe.skipIf(!crfUp)('confirming an import', () => {
  it('keeps the inventory link when the user renames an ingredient', async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ householdId, name: 'Basmati Rice', internalId: 'HM-CONF1' })
      .returning();

    const { sessionId, session } = await importText(
      'Plain Rice\n\nIngredients\n2 cups basmati rice\n1 tsp salt\n\nInstructions\n1. Rinse.\n2. Cook.\n'
    );
    const rice = session.ingredientMatches.find((m: { parsedName: string }) => /rice/i.test(m.parsedName));
    expect(rice.matchedItemId).toBe(item.id);

    // The user tidies the wording on the review screen. The link was joined to
    // the match by name, so renaming silently dropped it.
    const edited = session.parsedRecipe.ingredients.map((i: { name: string }) =>
      /rice/i.test(i.name) ? { ...i, name: 'basmati rice (rinsed)' } : i
    );
    const confirmed = await json(
      await post(`/api/v1/recipes/import/${sessionId}/confirm`, { ingredients: edited })
    );

    const rows = await storedIngredients(confirmed.data.recipeId);
    const riceRow = rows.find((r) => /rice/i.test(r.name));
    expect(riceRow?.name).toBe('basmati rice (rinsed)');
    expect(riceRow?.inventoryItemId).toBe(item.id);
  });

  it('keeps ingredient group headings', async () => {
    const { sessionId } = await importText(
      [
        'Layered Bake',
        '',
        'Ingredients',
        'For the sauce:',
        '2 cups tomato puree',
        '1 tsp oregano',
        'For the topping:',
        '1 cup breadcrumbs',
        '2 tbsp butter',
        '',
        'Instructions',
        '1. Make the sauce.',
        '2. Add the topping and bake.',
        '',
      ].join('\n')
    );

    const confirmed = await json(await post(`/api/v1/recipes/import/${sessionId}/confirm`, {}));
    const rows = await storedIngredients(confirmed.data.recipeId);

    // Groups were parsed correctly and then discarded: the group map was keyed
    // by raw line text while the stored names had been through CRF.
    // "For the sauce:" is recorded as "sauce" — the parser drops the leading
    // "for the", which reads better as a heading.
    const groups = Object.fromEntries(rows.map((r) => [r.name, r.groupName]));
    expect(groups['tomato puree']).toBe('sauce');
    expect(groups['oregano']).toBe('sauce');
    expect(groups['breadcrumbs']).toBe('topping');
    expect(groups['butter']).toBe('topping');
  });

  it('remembers where an imported recipe came from', async () => {
    const payload = JSON.stringify({
      version: '1.0',
      type: 'recipe',
      recipe: {
        title: 'Sourced Recipe',
        sourceUrl: 'https://example.com/the-original',
        author: 'A Cook',
        cuisine: 'Italian',
        instructions: ['Do the thing.'],
        ingredients: [{ name: 'water', quantity: 1, unit: 'cup' }],
      },
    });
    const started = await json(await post('/api/v1/recipes/import/start', {
      sourceType: 'text',
      sourceData: payload,
      rawText: payload,
    }));
    const confirmed = await json(
      await post(`/api/v1/recipes/import/${started.data.sessionId}/confirm`, {})
    );

    const recipe = await db.query.recipes.findFirst({
      where: eq(recipes.id, confirmed.data.recipeId),
    });
    // Import 200 recipes from the web and none of them could say where they
    // came from — no way to re-check, re-import or attribute.
    expect(recipe?.sourceUrl).toBe('https://example.com/the-original');
  });

  it('refuses to create a recipe with nothing in it', async () => {
    const { sessionId } = await importText('aaaa');
    const res = await post(`/api/v1/recipes/import/${sessionId}/confirm`, {});
    expect(res.status).toBe(400);
  });
});

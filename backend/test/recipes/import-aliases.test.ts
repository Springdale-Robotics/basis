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
import { isCRFParserAvailable } from '../../src/services/crf-ingredient-parser.js';

// Import parsing goes through the CRF service; without it the ingredient
// names never get cleaned up and these assertions test nothing.
const crfUp = await isCRFParserAvailable();
if (!crfUp) {
  console.warn('[import-aliases.test] CRF service unreachable — import tests skipped');
}

let ctx: RouteTestContext;
let user: TestUser;
let householdId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Alias Learning');
  user = await ctx.createUser(householdId, 'admin');
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

const post = (path: string, body: unknown) =>
  user.fetch(path, { method: 'POST', body: JSON.stringify(body) });

async function importRecipe(text: string) {
  const started = await json(
    await post('/api/v1/recipes/import/start', {
      sourceType: 'text',
      sourceData: text,
      rawText: text,
    })
  );
  const sessionId = started.data.sessionId as string;
  const fetched = await json(await user.fetch(`/api/v1/recipes/import/${sessionId}`));
  return { sessionId, session: fetched.data.session };
}

function recipeText(title: string, ingredients: string[]) {
  return [
    title,
    '',
    'Ingredients',
    ...ingredients,
    '',
    'Instructions',
    '1. Cook it.',
    '2. Serve it.',
    '',
  ].join('\n');
}

describe.skipIf(!crfUp)('learned ingredient aliases', () => {
  it('applies an alias the user taught it on a previous import', async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ householdId, name: 'Caper Berry', internalId: 'HM-ALIAS1' })
      .returning();

    const first = await importRecipe(recipeText('Puttanesca', ['2 tbsp capers', '1 tsp chili flakes']));
    const capers = first.session.parsedRecipe.ingredients.find((i: { name: string }) =>
      /caper/i.test(i.name)
    );
    expect(capers, 'CRF should have parsed a capers line').toBeTruthy();

    // The user picks the item by hand — "capers" is nothing like "Caper Berry",
    // so nothing else would have connected them.
    await post(`/api/v1/recipes/import/${first.sessionId}/match`, {
      updates: [
        {
          parsedName: capers.name,
          matchedItemId: item.id,
          matchedItemName: item.name,
          confirmed: true,
        },
      ],
    });
    await post(`/api/v1/recipes/import/${first.sessionId}/confirm`, {});

    // A second recipe naming the same ingredient should now link on its own.
    // Before, the alias was written normalized ("caper") but looked up raw
    // ("capers"), so it never matched and the user re-taught it every time.
    const second = await importRecipe(recipeText('Caper Sauce', ['3 tbsp capers', '1 cup cream']));
    const rematched = second.session.ingredientMatches.find((m: { parsedName: string }) =>
      /caper/i.test(m.parsedName)
    );

    expect(rematched.matchedItemId).toBe(item.id);
    expect(rematched.matchStatus).toBe('matched');
  });

  it('does not learn an alias from a suggestion the user never accepted', async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ householdId, name: 'Kosher Salt', internalId: 'HM-ALIAS2' })
      .returning();

    const session = await importRecipe(recipeText('Simple Bread', ['2 tsp salt', '3 cups bread flour']));
    const matches = session.session.ingredientMatches;
    const salt = matches.find((m: { parsedName: string }) => /salt/i.test(m.parsedName));
    expect(salt.matchedItemId, 'salt should auto-match Kosher Salt via synonyms').toBe(item.id);
    expect(salt.matchStatus).toBe('matched');

    // The review UI posts every row back on save, including the ones the user
    // scrolled past. That is not consent.
    await post(`/api/v1/recipes/import/${session.sessionId}/match`, {
      updates: matches.map((m: { parsedName: string; matchedItemId?: string; matchedItemName?: string }) => ({
        parsedName: m.parsedName,
        matchedItemId: m.matchedItemId,
        matchedItemName: m.matchedItemName,
      })),
    });
    await post(`/api/v1/recipes/import/${session.sessionId}/confirm`, {});

    const learned = await db.query.ingredientAliases.findMany({
      where: eq(ingredientAliases.canonicalItemId, item.id),
    });
    expect(learned.map((a) => a.aliasName)).toEqual([]);
  });

  it('learns an alias when the user does accept a suggestion', async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ householdId, name: 'Maldon Flakes', internalId: 'HM-ALIAS3' })
      .returning();

    const session = await importRecipe(recipeText('Focaccia', ['1 tbsp flaky sea salt', '4 cups flour']));
    const flaky = session.session.ingredientMatches.find((m: { parsedName: string }) =>
      /salt/i.test(m.parsedName)
    );

    await post(`/api/v1/recipes/import/${session.sessionId}/match`, {
      updates: [
        {
          parsedName: flaky.parsedName,
          matchedItemId: item.id,
          matchedItemName: item.name,
          confirmed: true,
        },
      ],
    });
    await post(`/api/v1/recipes/import/${session.sessionId}/confirm`, {});

    const learned = await db.query.ingredientAliases.findMany({
      where: eq(ingredientAliases.canonicalItemId, item.id),
    });
    expect(learned.length).toBe(1);
  });
});

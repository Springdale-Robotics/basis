import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupRouteTest,
  json,
  type RouteTestContext,
  type TestUser,
} from '../helpers/route-harness.js';
import { isCRFParserAvailable } from '../../src/services/crf-ingredient-parser.js';

const crfUp = await isCRFParserAvailable();
if (!crfUp) {
  console.warn('[import-parsing.test] CRF service unreachable — parsing tests skipped');
}

let ctx: RouteTestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold('Import Parsing');
  user = await ctx.createUser(householdId, 'admin');
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

const post = (path: string, body: unknown) =>
  user.fetch(path, { method: 'POST', body: JSON.stringify(body) });

async function startAndFetch(body: unknown) {
  const started = await json(await post('/api/v1/recipes/import/start', body));
  expect(started.data?.sessionId, JSON.stringify(started)).toBeTruthy();
  const fetched = await json(await user.fetch(`/api/v1/recipes/import/${started.data.sessionId}`));
  return fetched.data.session;
}

/**
 * The bulk URL flow builds one of these per URL: it calls /import/parse-url,
 * which returns ingredients as raw strings by design (CRF runs later), and
 * wraps the result in a .recipe envelope so it can reuse the text import path.
 */
function recipeEnvelope(ingredients: Array<{ name: string; quantity?: number; unit?: string }>) {
  return JSON.stringify({
    version: '1.0',
    type: 'recipe',
    recipe: {
      title: 'Classic Beef Chili',
      instructions: ['Brown the beef.', 'Simmer for 45 minutes.'],
      ingredients,
    },
  });
}

describe.skipIf(!crfUp)('.recipe envelope import', () => {
  it('parses ingredients that arrive as bare strings', async () => {
    const payload = recipeEnvelope([
      { name: '2 tablespoons extra-virgin olive oil' },
      { name: '2 pounds ground beef' },
      { name: '1 (28 ounce) can crushed tomatoes' },
    ]);

    const session = await startAndFetch({
      sourceType: 'text',
      sourceData: payload,
      rawText: payload,
    });

    const ingredients = session.parsedRecipe.ingredients;
    // Before, these went straight into the catalog as items literally named
    // "2 tablespoons extra-virgin olive oil", with every quantity lost.
    expect(ingredients.map((i: { name: string }) => i.name)).toEqual([
      'extra-virgin olive oil',
      'ground beef',
      'crushed tomatoes',
    ]);
    expect(ingredients[0]).toMatchObject({ quantity: 2, unit: 'tablespoon' });
    expect(ingredients[1]).toMatchObject({ quantity: 2, unit: 'pound' });
  });

  it('does not claim perfect confidence for a payload it had to re-parse', async () => {
    const payload = recipeEnvelope([{ name: '2 pounds ground beef' }]);
    const session = await startAndFetch({
      sourceType: 'text',
      sourceData: payload,
      rawText: payload,
    });

    // It reported parseMethod 'json-ld' at 1.0 — "Looks complete" in the UI —
    // for the one path that produced unusable ingredients.
    expect(Number(session.parseConfidence)).toBeLessThan(1);
    expect(session.parseMethod).toBe('crf');
  });

  it('trusts a genuine export that already carries structure', async () => {
    const payload = recipeEnvelope([
      { name: 'olive oil', quantity: 2, unit: 'tbsp' },
      { name: 'ground beef', quantity: 2, unit: 'lb' },
    ]);
    const session = await startAndFetch({
      sourceType: 'text',
      sourceData: payload,
      rawText: payload,
    });

    expect(session.parseMethod).toBe('json-ld');
    expect(Number(session.parseConfidence)).toBe(1);
    expect(session.parsedRecipe.ingredients[0]).toMatchObject({
      name: 'olive oil',
      quantity: 2,
      unit: 'tbsp',
    });
  });
});

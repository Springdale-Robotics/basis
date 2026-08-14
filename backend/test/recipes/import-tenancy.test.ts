import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  setupRouteTest,
  json,
  type RouteTestContext,
  type TestUser,
} from '../helpers/route-harness.js';
import { db } from '../../src/config/database.js';
import { inventoryItems, recipeIngredients, recipeImportSessions } from '../../src/db/schema/index.js';
import { isCRFParserAvailable } from '../../src/services/crf-ingredient-parser.js';

const crfUp = await isCRFParserAvailable();
if (!crfUp) console.warn('[import-tenancy.test] CRF unreachable — some tests skipped');

let ctx: RouteTestContext;
let user: TestUser;
let householdId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Import Tenancy');
  user = await ctx.createUser(householdId, 'admin');
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

const post = (path: string, body: unknown) =>
  user.fetch(path, { method: 'POST', body: JSON.stringify(body) });

const RECIPE = 'Saffron Rice\n\nIngredients\n1 pinch saffron\n2 cups rice\n\nInstructions\n1. Steep.\n2. Cook.\n';

async function startSession() {
  const started = await json(
    await post('/api/v1/recipes/import/start', {
      sourceType: 'text',
      sourceData: RECIPE,
      rawText: RECIPE,
    })
  );
  const sessionId = started.data.sessionId as string;
  const fetched = await json(await user.fetch(`/api/v1/recipes/import/${sessionId}`));
  return { sessionId, session: fetched.data.session };
}

describe.skipIf(!crfUp)('import tenancy', () => {
  it('refuses to link an ingredient to another household\'s inventory item', async () => {
    const otherHousehold = await ctx.createHousehold('Not Ours');
    const [foreignItem] = await db
      .insert(inventoryItems)
      .values({ householdId: otherHousehold, name: 'Foreign Saffron', internalId: 'HM-TEN1' })
      .returning();

    const { sessionId, session } = await startSession();
    const target = session.parsedRecipe.ingredients[0].name;

    // Nothing validated this id before it reached
    // recipe_ingredients.inventory_item_id, and the RLS policy there keys off
    // the recipe's household rather than the item's — so it went straight in.
    const res = await post(`/api/v1/recipes/import/${sessionId}/match`, {
      updates: [{ parsedName: target, matchedItemId: foreignItem.id, matchedItemName: 'Foreign Saffron' }],
    });
    expect(res.status).toBe(400);

    const confirmed = await json(await post(`/api/v1/recipes/import/${sessionId}/confirm`, {}));
    const rows = await db.query.recipeIngredients.findMany({
      where: eq(recipeIngredients.recipeId, confirmed.data.recipeId),
    });
    expect(rows.map((r) => r.inventoryItemId)).not.toContain(foreignItem.id);
  });

  it('will not read another household\'s import session', async () => {
    const { sessionId } = await startSession();
    const otherHousehold = await ctx.createHousehold('Elsewhere');
    const stranger = await ctx.createUser(otherHousehold, 'admin');

    const res = await stranger.fetch(`/api/v1/recipes/import/${sessionId}`);
    expect(res.status).toBe(404);
  });

  it('will not confirm another household\'s import session', async () => {
    const { sessionId } = await startSession();
    const otherHousehold = await ctx.createHousehold('Elsewhere Too');
    const stranger = await ctx.createUser(otherHousehold, 'admin');

    const res = await stranger.fetch(`/api/v1/recipes/import/${sessionId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

describe('a source that cannot be read', () => {
  it('records why, instead of stranding the session in "parsing"', async () => {
    const res = await post('/api/v1/recipes/import/start', {
      sourceType: 'url',
      sourceData: 'https://not-a-real-host.invalid/recipe',
    });

    // It used to throw: the request 500'd with "Internal server error", the
    // parser's actual message was swallowed, and the row sat in 'parsing'
    // forever — invisible to the user and not retryable.
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.message).not.toMatch(/internal server error/i);

    const sessions = await db.query.recipeImportSessions.findMany({
      where: eq(recipeImportSessions.householdId, householdId),
    });
    const failed = sessions.filter((s) => s.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[failed.length - 1].parseWarnings?.[0]).toBeTruthy();
    expect(sessions.some((s) => s.status === 'parsing')).toBe(false);
  }, 30000);
});

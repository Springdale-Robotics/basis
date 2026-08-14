import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupRouteTest, json, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';
import { isCRFParserAvailable } from '../../src/services/crf-ingredient-parser.js';

const crfUp = await isCRFParserAvailable();
if (!crfUp) console.warn('[import-batch.test] CRF unreachable — batch tests skipped');

let ctx: RouteTestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold('Batch Import');
  user = await ctx.createUser(householdId, 'admin');
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

const post = (path: string, body: unknown) =>
  user.fetch(path, { method: 'POST', body: JSON.stringify(body) });

const recipeText = (title: string) =>
  `${title}\n\nIngredients\n1 cup water\n2 tbsp olive oil\n\nInstructions\n1. Boil.\n2. Serve.\n`;

async function startSession(title: string) {
  const started = await json(
    await post('/api/v1/recipes/import/start', {
      sourceType: 'text',
      sourceData: recipeText(title),
      rawText: recipeText(title),
    })
  );
  return started.data.sessionId as string;
}

describe.skipIf(!crfUp)('POST /import/confirm-batch', () => {
  it('saves every good recipe even when one in the batch is unusable', async () => {
    const first = await startSession('Batch Recipe One');
    const cancelled = await startSession('Batch Recipe Two');
    const third = await startSession('Batch Recipe Three');

    // Something the user cancelled in another tab, or a session that expired.
    await user.fetch(`/api/v1/recipes/import/${cancelled}`, { method: 'DELETE' });

    const res = await post('/api/v1/recipes/import/confirm-batch', {
      sessions: [{ sessionId: first }, { sessionId: cancelled }, { sessionId: third }],
    });
    const { data } = await json(res);

    // It used to throw on the first bad session, having already committed the
    // ones before it: one recipe silently saved, one skipped, and a flat error
    // that said nothing about either.
    expect(res.status).toBe(200);
    expect(data.results).toHaveLength(3);
    expect(data.results[0]).toMatchObject({ sessionId: first, status: 'confirmed' });
    expect(data.results[1]).toMatchObject({ sessionId: cancelled, status: 'failed' });
    expect(data.results[1].error).toBeTruthy();
    expect(data.results[2]).toMatchObject({ sessionId: third, status: 'confirmed' });

    const list = await json(await user.fetch('/api/v1/recipes?limit=100'));
    const titles = list.data.recipes.map((r: { title: string }) => r.title);
    expect(titles).toContain('Batch Recipe One');
    expect(titles).toContain('Batch Recipe Three');
  });
});

describe.skipIf(!crfUp)('POST /import/start-batch', () => {
  it('reports per-entry outcomes rather than failing the whole run', async () => {
    const res = await post('/api/v1/recipes/import/start-batch', {
      entries: [
        { sourceType: 'text', sourceData: recipeText('Good One'), rawText: recipeText('Good One') },
        { sourceType: 'url', sourceData: 'https://not-a-real-host.invalid/recipe' },
        { sourceType: 'text', sourceData: recipeText('Good Two'), rawText: recipeText('Good Two') },
      ],
    });
    const { data } = await json(res);

    expect(res.status).toBe(200);
    expect(data.results).toHaveLength(3);
    expect(data.results[0].sessionId).toBeTruthy();
    expect(data.results[1].status).toBe('failed');
    expect(data.results[2].sessionId).toBeTruthy();
  }, 60000);

  it('caps how many entries one request may carry', async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      sourceType: 'text' as const,
      sourceData: recipeText(`Recipe ${i}`),
    }));
    const res = await post('/api/v1/recipes/import/start-batch', { entries });
    expect(res.status).toBe(400);
  });
});

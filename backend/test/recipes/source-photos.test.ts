import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFile, writeFile, mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setupRouteTest,
  json,
  type RouteTestContext,
  type TestUser,
} from '../helpers/route-harness.js';
import { db } from '../../src/config/database.js';
import { imageParseSessions, recipes, recipeImportSessions } from '../../src/db/schema/index.js';
import { confirmImportSession } from '../../src/modules/recipes/recipe-import.service.js';

/**
 * Keeping the photograph a recipe was read from.
 *
 * A photographed card is read for its text and then forgotten: the import
 * creates the recipe through the ordinary text path, so nothing connected the
 * two. The image survived only because image-parse retention deliberately
 * never sweeps a scan in `review` — and for a handwritten card that file is
 * the only copy in the account.
 *
 * The recipe now takes its own copy, which is what lets retention eventually
 * collect harvested scans without destroying the photographs.
 */

let ctx: RouteTestContext;
let user: TestUser;
let householdId: string;

let neighbour: TestUser;
let neighbourHouseholdId: string;

let dir: string;

const FRONT = Buffer.from('front-of-the-card-bytes');
const BACK = Buffer.from('back-of-the-card-bytes');

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Photos');
  user = await ctx.createUser(householdId, 'admin');

  neighbourHouseholdId = await ctx.createHousehold('Next Door');
  neighbour = await ctx.createUser(neighbourHouseholdId, 'admin');

  dir = await mkdtemp(join(tmpdir(), 'source-photos-'));
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

/** A scan sitting in `review`, exactly as a photographed card ends up. */
async function seedScan(owner: string, bytes: Buffer, name: string): Promise<string> {
  const path = join(dir, `${name}-${Math.random().toString(36).slice(2)}.jpg`);
  await writeFile(path, bytes);

  const [row] = await db
    .insert(imageParseSessions)
    .values({
      householdId: owner,
      userId: owner === householdId ? user.id : neighbour.id,
      status: 'review',
      originalImagePath: path,
      imageMimeType: 'image/jpeg',
    })
    .returning({ id: imageParseSessions.id });

  return row.id;
}

const RECIPE_TEXT = ['Card Recipe', 'Ingredients', '2 eggs', 'Instructions', 'Beat them.'].join('\n');

/** Import the text the way the photo flow does, naming its scans. */
async function importFromScans(as: TestUser, imageSessionIds: string[]) {
  const started = await as.fetch('/api/v1/recipes/import/start', {
    method: 'POST',
    body: JSON.stringify({
      sourceType: 'text',
      sourceData: RECIPE_TEXT,
      rawText: RECIPE_TEXT,
      imageSessionIds,
    }),
  });
  const { data } = await json(started);

  const confirmed = await as.fetch(`/api/v1/recipes/import/${data.sessionId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return { started, confirmed, sessionId: data.sessionId };
}

describe('a recipe keeps the photographs it was read from', () => {
  it('copies both sides of a card, in the order they were captured', async () => {
    const front = await seedScan(householdId, FRONT, 'front');
    const back = await seedScan(householdId, BACK, 'back');

    const { confirmed } = await importFromScans(user, [front, back]);
    expect(confirmed.status).toBe(200);
    const { data } = await json(confirmed);

    const recipe = await db.query.recipes.findFirst({ where: eq(recipes.id, data.recipeId) });
    expect(recipe?.photoPaths).toHaveLength(2);

    // The bytes really are there, and the back has not become the front.
    expect(await readFile(recipe!.photoPaths![0].path)).toEqual(FRONT);
    expect(await readFile(recipe!.photoPaths![1].path)).toEqual(BACK);
  });

  it("leaves the scan's own file where it was", async () => {
    const scanId = await seedScan(householdId, FRONT, 'untouched');
    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, scanId),
    });

    await importFromScans(user, [scanId]);

    // Copied, not moved — this PR deletes nothing.
    await expect(access(scan!.originalImagePath!)).resolves.toBeUndefined();
  });

  it('records that the scan has been harvested', async () => {
    const scanId = await seedScan(householdId, FRONT, 'harvested');
    const { confirmed } = await importFromScans(user, [scanId]);
    const { data } = await json(confirmed);

    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, scanId),
    });
    // This is what will eventually let retention collect it safely.
    expect(scan?.consumedByRecipeId).toBe(data.recipeId);
    // Its status is untouched, because several operations require 'review'.
    expect(scan?.status).toBe('review');
  });

  it('points the recipe at its photograph so it renders', async () => {
    const scanId = await seedScan(householdId, FRONT, 'renders');
    const { confirmed } = await importFromScans(user, [scanId]);
    const { data } = await json(confirmed);

    const recipe = await db.query.recipes.findFirst({ where: eq(recipes.id, data.recipeId) });
    expect(recipe?.imageUrl).toBe(`/api/v1/recipes/${data.recipeId}/photo/0`);

    const served = await user.fetch(`/api/v1/recipes/${data.recipeId}/photo/0`);
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer())).toEqual(FRONT);
  });
});

describe('when the photographs cannot be kept', () => {
  it('still saves the recipe', async () => {
    // The scan's file has vanished — a recipe that parsed correctly must not
    // be lost because of it.
    const [row] = await db
      .insert(imageParseSessions)
      .values({
        householdId,
        userId: user.id,
        status: 'review',
        originalImagePath: join(dir, 'gone-missing.jpg'),
        imageMimeType: 'image/jpeg',
      })
      .returning({ id: imageParseSessions.id });

    const { confirmed } = await importFromScans(user, [row.id]);
    expect(confirmed.status).toBe(200);

    const { data } = await json(confirmed);
    const recipe = await db.query.recipes.findFirst({ where: eq(recipes.id, data.recipeId) });
    expect(recipe).toBeTruthy();
    expect(recipe?.photoPaths ?? null).toBeNull();

    // And it is not claimed as harvested, since nothing was kept.
    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, row.id),
    });
    expect(scan?.consumedByRecipeId ?? null).toBeNull();
  });
});

describe('tenancy', () => {
  it('ignores a scan belonging to another household', async () => {
    // Ids supplied by the caller, crossing a module boundary — the same shape
    // as the defaultAreaId leak. Falsify by removing the household filter in
    // /import/start: this must then fail.
    const theirs = await seedScan(neighbourHouseholdId, BACK, 'neighbour');

    const { confirmed } = await importFromScans(user, [theirs]);
    const { data } = await json(confirmed);

    const recipe = await db.query.recipes.findFirst({ where: eq(recipes.id, data.recipeId) });
    expect(recipe?.photoPaths ?? null).toBeNull();

    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, theirs),
    });
    expect(scan?.consumedByRecipeId ?? null).toBeNull();
  });

  it('ignores a foreign scan even with no RLS to fall back on', async () => {
    /**
     * The route test above cannot prove this. Requests run as `basis_rls`
     * with app.household_id set, so a neighbour's scan is invisible at the
     * database regardless of what the query says — removing the application
     * filter leaves every route test still passing (verified).
     *
     * This calls the service directly, the way a worker does: as the owner
     * role, where RLS is not there to cover a missing filter. That is also
     * the context in which it would really matter.
     */
    const theirs = await seedScan(neighbourHouseholdId, BACK, 'worker-path');

    const [importSession] = await db
      .insert(recipeImportSessions)
      .values({
        householdId,
        userId: user.id,
        sourceType: 'text',
        sourceData: RECIPE_TEXT,
        status: 'pending_review',
        parsedRecipe: {
          title: 'Worker Path',
          ingredients: [{ name: '2 eggs' }],
          instructions: ['Beat them.'],
        },
        imageSessionIds: [theirs],
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning({ id: recipeImportSessions.id });

    const recipeId = await confirmImportSession(importSession.id, householdId, user.id);

    const recipe = await db.query.recipes.findFirst({ where: eq(recipes.id, recipeId) });
    expect(recipe?.photoPaths ?? null).toBeNull();

    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, theirs),
    });
    expect(scan?.consumedByRecipeId ?? null).toBeNull();
  });

  it("will not serve another household's recipe photo", async () => {
    const scanId = await seedScan(householdId, FRONT, 'private');
    const { confirmed } = await importFromScans(user, [scanId]);
    const { data } = await json(confirmed);

    const served = await neighbour.fetch(`/api/v1/recipes/${data.recipeId}/photo/0`);
    expect(served.status).toBe(404);
  });

  it('refuses an index that is not a photo', async () => {
    const scanId = await seedScan(householdId, FRONT, 'bounds');
    const { confirmed } = await importFromScans(user, [scanId]);
    const { data } = await json(confirmed);

    for (const index of ['1', '-1', 'x']) {
      const served = await user.fetch(`/api/v1/recipes/${data.recipeId}/photo/${index}`);
      expect(served.status).toBe(404);
    }
  });
});

describe('the batch path keeps photographs too', () => {
  it('gives each recipe in a batch the scan it was read from', async () => {
    const first = await seedScan(householdId, FRONT, 'batch-a');
    const second = await seedScan(householdId, BACK, 'batch-b');

    const started = await user.fetch('/api/v1/recipes/import/start-batch', {
      method: 'POST',
      body: JSON.stringify({
        entries: [
          { sourceType: 'text', sourceData: RECIPE_TEXT, rawText: RECIPE_TEXT, imageSessionIds: [first] },
          { sourceType: 'text', sourceData: RECIPE_TEXT, rawText: RECIPE_TEXT, imageSessionIds: [second] },
        ],
      }),
    });
    const { data } = await json(started);
    expect(data.sessionIds).toHaveLength(2);

    // Each entry keeps its own scan — not the first one twice.
    const [a, b] = await Promise.all(
      data.sessionIds.map((id: string) =>
        db.query.recipeImportSessions.findFirst({ where: eq(recipeImportSessions.id, id) })
      )
    );
    expect(a?.imageSessionIds).toEqual([first]);
    expect(b?.imageSessionIds).toEqual([second]);
  });

  it('drops a foreign scan from a batch entry', async () => {
    const theirs = await seedScan(neighbourHouseholdId, BACK, 'batch-neighbour');
    const mine = await seedScan(householdId, FRONT, 'batch-mine');

    const started = await user.fetch('/api/v1/recipes/import/start-batch', {
      method: 'POST',
      body: JSON.stringify({
        entries: [
          {
            sourceType: 'text',
            sourceData: RECIPE_TEXT,
            rawText: RECIPE_TEXT,
            imageSessionIds: [mine, theirs],
          },
        ],
      }),
    });
    const { data } = await json(started);

    const session = await db.query.recipeImportSessions.findFirst({
      where: eq(recipeImportSessions.id, data.sessionIds[0]),
    });
    expect(session?.imageSessionIds).toEqual([mine]);
  });
});

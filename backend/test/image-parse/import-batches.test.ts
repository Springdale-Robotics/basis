import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  setupRouteTest,
  json,
  type RouteTestContext,
  type TestUser,
} from '../helpers/route-harness.js';
import { db } from '../../src/config/database.js';
import { imageParseSessions, recipeImportBatches } from '../../src/db/schema/index.js';

/**
 * A photographing session you can walk away from.
 *
 * Parsing has always run in a worker, so closing the browser never stopped it
 * — but nothing recorded that a group of scans belonged together, so there was
 * nothing to come back to. Progress is counted from the scans rather than
 * stored on the batch, because two records of the same thing drift.
 */

let ctx: RouteTestContext;
let user: TestUser;
let householdId: string;

let neighbour: TestUser;
let neighbourHouseholdId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Batches');
  user = await ctx.createUser(householdId, 'admin');

  neighbourHouseholdId = await ctx.createHousehold('Next Door');
  neighbour = await ctx.createUser(neighbourHouseholdId, 'admin');
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

const createBatch = async (as: TestUser, name?: string) => {
  const res = await as.fetch('/api/v1/image-parse/batches', {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {}),
  });
  const { data } = await json(res);
  return data.batch;
};

/** A scan in a given state, filed under a batch. */
async function seedScan(
  batchId: string | null,
  status: 'uploading' | 'processing' | 'review' | 'failed',
  owner = householdId,
  ownerUser = user
) {
  const [row] = await db
    .insert(imageParseSessions)
    .values({ householdId: owner, userId: ownerUser.id, status, batchId })
    .returning({ id: imageParseSessions.id });
  return row.id;
}

describe('creating and finding a batch', () => {
  it('starts open, and can be named', async () => {
    const batch = await createBatch(user, 'Grandma binder');
    expect(batch.name).toBe('Grandma binder');
    expect(batch.status).toBe('open');
  });

  it('is findable again after the client has gone', async () => {
    const batch = await createBatch(user, 'Left open');

    // Nothing is held in the page — this is a fresh request, as it would be
    // from a phone the next morning.
    const res = await user.fetch('/api/v1/image-parse/batches');
    const { data } = await json(res);

    expect(data.batches.map((b: { id: string }) => b.id)).toContain(batch.id);
  });

  it('counts progress from the scans themselves', async () => {
    const batch = await createBatch(user, 'Counting');
    await seedScan(batch.id, 'review');
    await seedScan(batch.id, 'review');
    await seedScan(batch.id, 'processing');
    await seedScan(batch.id, 'failed');

    const res = await user.fetch('/api/v1/image-parse/batches');
    const { data } = await json(res);
    const found = data.batches.find((b: { id: string }) => b.id === batch.id);

    expect(found).toMatchObject({ total: 4, ready: 2, working: 1, failed: 1 });
  });

  it('reports an empty batch as empty rather than omitting it', async () => {
    // A binder photographed but not yet uploaded still has to be findable.
    const batch = await createBatch(user, 'Nothing yet');

    const res = await user.fetch('/api/v1/image-parse/batches');
    const { data } = await json(res);
    const found = data.batches.find((b: { id: string }) => b.id === batch.id);

    expect(found).toMatchObject({ total: 0, ready: 0 });
  });

  it('lists its scans in the order they were captured', async () => {
    const batch = await createBatch(user, 'Ordered');
    const first = await seedScan(batch.id, 'review');
    const second = await seedScan(batch.id, 'review');

    const res = await user.fetch(`/api/v1/image-parse/batches/${batch.id}`);
    const { data } = await json(res);

    expect(data.scans.map((s: { id: string }) => s.id)).toEqual([first, second]);
  });
});

describe('closing a batch', () => {
  it('takes it out of the open list without deleting anything', async () => {
    const batch = await createBatch(user, 'Finished');
    const scanId = await seedScan(batch.id, 'review');

    await user.fetch(`/api/v1/image-parse/batches/${batch.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed' }),
    });

    const open = await json(await user.fetch('/api/v1/image-parse/batches'));
    expect(open.data.batches.map((b: { id: string }) => b.id)).not.toContain(batch.id);

    const closed = await json(await user.fetch('/api/v1/image-parse/batches?status=closed'));
    expect(closed.data.batches.map((b: { id: string }) => b.id)).toContain(batch.id);

    // The photographs are not collateral.
    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, scanId),
    });
    expect(scan).toBeTruthy();
  });
});

describe('tenancy', () => {
  it("does not list another household's batches", async () => {
    const theirs = await createBatch(neighbour, 'Not yours');

    const res = await user.fetch('/api/v1/image-parse/batches');
    const { data } = await json(res);

    expect(data.batches.map((b: { id: string }) => b.id)).not.toContain(theirs.id);
  });

  it("will not open another household's batch", async () => {
    const theirs = await createBatch(neighbour, 'Private');
    const res = await user.fetch(`/api/v1/image-parse/batches/${theirs.id}`);
    expect(res.status).toBe(404);
  });

  it("will not close another household's batch", async () => {
    const theirs = await createBatch(neighbour, 'Untouchable');

    const res = await user.fetch(`/api/v1/image-parse/batches/${theirs.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed' }),
    });
    expect(res.status).toBe(404);

    const still = await db.query.recipeImportBatches.findFirst({
      where: eq(recipeImportBatches.id, theirs.id),
    });
    expect(still?.status).toBe('open');
  });

  it('files an uploaded scan under its batch, with its name', async () => {
    /**
     * Pins that a batch id and a name survive an upload — but note what this
     * test cannot do.
     *
     * Over real HTTP the fields must be written into the form BEFORE the file.
     * `request.file()` resolves at the file part, and fields parsed after it
     * are not there yet when they are read: a browser uploading a 172KB
     * photograph filed it under no batch at all, and the symptom was a
     * photographing session that stayed empty while every upload reported
     * success. Reordering the client fixed it, observed directly.
     *
     * In here the whole body is already in memory, so the race resolves
     * favourably and moving the file first still passes — verified. The
     * ordering is therefore guaranteed by construction in the client, not by
     * this test, which only proves the fields are honoured when they do
     * arrive.
     */
    const batch = await createBatch(user, 'Ordering');

    // A real (if tiny) JPEG — the route inspects what it is given.
    const { loadSharp } = await import('../../src/lib/sharp.js');
    const sharp = await loadSharp();
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 180, b: 190 } },
    })
      .jpeg()
      .toBuffer();

    const form = new FormData();
    form.append('targetType', 'recipe');
    form.append('batchId', batch.id);
    form.append('label', 'Page one');
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'p.jpg');

    const res = await user.fetch('/api/v1/image-parse/upload', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const { data } = await json(res);

    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, data.sessionId),
    });
    expect(scan?.batchId).toBe(batch.id);
    expect(scan?.label).toBe('Page one');
  });

  it('can rename a page afterwards', async () => {
    const batch = await createBatch(user, 'Renaming');
    const scanId = await seedScan(batch.id, 'review');

    const res = await user.fetch(`/api/v1/image-parse/${scanId}/label`, {
      method: 'PATCH',
      body: JSON.stringify({ label: 'Spoon Bread, back' }),
    });
    expect(res.status).toBe(200);

    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, scanId),
    });
    expect(scan?.label).toBe('Spoon Bread, back');
  });

  it("will not rename another household's page", async () => {
    const scanId = await seedScan(null, 'review', neighbourHouseholdId, neighbour);

    const res = await user.fetch(`/api/v1/image-parse/${scanId}/label`, {
      method: 'PATCH',
      body: JSON.stringify({ label: 'mine now' }),
    });
    expect(res.status).toBe(404);

    const scan = await db.query.imageParseSessions.findFirst({
      where: eq(imageParseSessions.id, scanId),
    });
    expect(scan?.label ?? null).toBeNull();
  });

  it('refuses to file a scan under a batch that is not the household\'s', async () => {
    const theirs = await createBatch(neighbour, 'Foreign batch');

    const form = new FormData();
    form.append('file', new Blob([Buffer.from('nope')], { type: 'image/jpeg' }), 'x.jpg');
    form.append('batchId', theirs.id);

    const res = await user.fetch('/api/v1/image-parse/upload', { method: 'POST', body: form });
    // Specifically refused, not merely "not 2xx" — a vaguer assertion passed
    // for a while against a 500 that had nothing to do with ownership.
    expect(res.status).toBe(400);
  });
});

describe('composing a batch into recipes', () => {
  /** A scan that has been read, with text and a name. */
  async function seedRead(
    batchId: string,
    label: string | null,
    rawText: string | null,
    status: 'review' | 'failed' | 'cancelled' = 'review'
  ) {
    const [row] = await db
      .insert(imageParseSessions)
      .values({ householdId, userId: user.id, status, batchId, label, rawText })
      .returning({ id: imageParseSessions.id });
    return row.id;
  }

  it('joins pages sharing a name into one recipe, in the order taken', async () => {
    // Naming two pages alike is the only way anybody could know the back of a
    // card continues the front — nothing downstream can work it out.
    const batch = await createBatch(user, 'Card');
    await seedRead(batch.id, 'Spoon Bread', 'Spoon Bread\n2 eggs');
    await seedRead(batch.id, 'Spoon Bread', 'Beat eggs in a bowl.');

    const { data } = await json(await user.fetch(`/api/v1/image-parse/batches/${batch.id}/compose`));

    expect(data.recipes).toHaveLength(1);
    expect(data.recipes[0]).toMatchObject({ label: 'Spoon Bread', pageCount: 2 });
    expect(data.recipes[0].text).toBe('Spoon Bread\n2 eggs\n\nBeat eggs in a bowl.');
  });

  it('keeps differently named pages apart', async () => {
    const batch = await createBatch(user, 'Two recipes');
    await seedRead(batch.id, 'Pancakes', 'Pancakes\n2 cups flour');
    await seedRead(batch.id, 'Soup', 'Soup\n1 onion');

    const { data } = await json(await user.fetch(`/api/v1/image-parse/batches/${batch.id}/compose`));
    expect(data.recipes.map((r: { label: string }) => r.label)).toEqual(['Pancakes', 'Soup']);
  });

  it('gives an unnamed page a recipe of its own', async () => {
    // Nothing said it belonged with anything else.
    const batch = await createBatch(user, 'Unnamed');
    await seedRead(batch.id, null, 'First page');
    await seedRead(batch.id, null, 'Second page');

    const { data } = await json(await user.fetch(`/api/v1/image-parse/batches/${batch.id}/compose`));
    expect(data.recipes).toHaveLength(2);
  });

  it('leaves out pages that were replaced or could not be read', async () => {
    const batch = await createBatch(user, 'Leftovers');
    await seedRead(batch.id, 'Good', 'A readable page');
    await seedRead(batch.id, 'Cropped away', 'the uncropped original', 'cancelled');
    await seedRead(batch.id, 'Unreadable', null, 'review');
    await seedRead(batch.id, 'Broken', null, 'failed');

    const { data } = await json(await user.fetch(`/api/v1/image-parse/batches/${batch.id}/compose`));

    expect(data.recipes.map((r: { label: string }) => r.label)).toEqual(['Good']);
    // Said plainly rather than silently dropped — two pages went nowhere.
    expect(data.unread).toBe(2);
  });

  it("will not compose another household's batch", async () => {
    const theirs = await createBatch(neighbour, 'Private');
    const res = await user.fetch(`/api/v1/image-parse/batches/${theirs.id}/compose`);
    expect(res.status).toBe(404);
  });
});

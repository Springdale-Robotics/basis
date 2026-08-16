import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupRouteTest, type RouteTestContext } from '../helpers/route-harness.js';
import { db } from '../../src/config/database.js';
import { imageParseSessions } from '../../src/db/schema/index.js';
import { cleanupAbandonedImageScans } from '../../src/modules/image-parse/image-parse.service.js';

/**
 * What gets swept, and — much more importantly — what does not.
 *
 * A photographed recipe card ends up in `review` and stays there: the import
 * harvests the text and creates the recipe through the ordinary text path, so
 * the image session is never confirmed. The photograph is then the only copy,
 * because nothing puts it on the recipe. For a handwritten card that image may
 * be the most valuable thing in the account.
 *
 * The predecessor deleted on `expires_at < now` — creation plus a day,
 * regardless of status. It was exported and never called, which is the only
 * reason it never destroyed anyone's recipe cards. The assertions that matter
 * here are therefore the ones about what survived: a test that only checked
 * deletions happened would pass a version that deleted everything.
 */

let ctx: RouteTestContext;
let householdId: string;
let userId: string;
let dir: string;

const LONG_AGO = new Date('2020-01-01T00:00:00Z');

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Retention');
  const user = await ctx.createUser(householdId, 'admin');
  userId = user.id;
  dir = await mkdtemp(join(tmpdir(), 'scan-retention-'));
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

type Status = 'uploading' | 'processing' | 'review' | 'confirmed' | 'cancelled' | 'failed';

/** A session of the given status, last touched long ago, with a file on disk. */
async function seed(status: Status): Promise<{ id: string; path: string }> {
  const path = join(dir, `${status}-${Math.random().toString(36).slice(2)}.jpg`);
  await writeFile(path, 'not really a jpeg');

  const [row] = await db
    .insert(imageParseSessions)
    .values({
      householdId,
      userId,
      status,
      originalImagePath: path,
      imageMimeType: 'image/jpeg',
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    })
    .returning({ id: imageParseSessions.id });

  return { id: row.id, path };
}

const stillThere = async (path: string) =>
  access(path).then(
    () => true,
    () => false
  );

const rowExists = async (id: string) =>
  db.query.imageParseSessions
    .findFirst({ where: eq(imageParseSessions.id, id) })
    .then((row) => !!row);

beforeEach(async () => {
  await db.delete(imageParseSessions).where(eq(imageParseSessions.householdId, householdId));
});

describe('cleanupAbandonedImageScans: what it keeps', () => {
  it('never touches a scan awaiting or past review, however old', async () => {
    const review = await seed('review');
    const confirmed = await seed('confirmed');

    await cleanupAbandonedImageScans();

    // The photograph is the only copy — for a handwritten card, losing it is
    // the worst thing this code could do.
    expect(await rowExists(review.id)).toBe(true);
    expect(await rowExists(confirmed.id)).toBe(true);
    expect(await stillThere(review.path)).toBe(true);
    expect(await stillThere(confirmed.path)).toBe(true);
  });

  it('leaves a recent failure alone, in case it is about to be retried', async () => {
    const path = join(dir, 'recent-failure.jpg');
    await writeFile(path, 'not really a jpeg');
    const [row] = await db
      .insert(imageParseSessions)
      .values({
        householdId,
        userId,
        status: 'failed',
        originalImagePath: path,
        imageMimeType: 'image/jpeg',
      })
      .returning({ id: imageParseSessions.id });

    await cleanupAbandonedImageScans();

    expect(await rowExists(row.id)).toBe(true);
    expect(await stillThere(path)).toBe(true);
  });
});

describe('cleanupAbandonedImageScans: what it sweeps', () => {
  it('removes long-dead scans and their files', async () => {
    const failed = await seed('failed');
    const cancelled = await seed('cancelled');
    // A week-old upload or parse is not in progress; a process died.
    const uploading = await seed('uploading');
    const processing = await seed('processing');

    const removed = await cleanupAbandonedImageScans();

    expect(removed).toBe(4);
    for (const scan of [failed, cancelled, uploading, processing]) {
      expect(await rowExists(scan.id)).toBe(false);
      expect(await stillThere(scan.path)).toBe(false);
    }
  });

  it('sweeps the dead without disturbing the living in the same run', async () => {
    const review = await seed('review');
    const failed = await seed('failed');

    expect(await cleanupAbandonedImageScans()).toBe(1);

    expect(await rowExists(failed.id)).toBe(false);
    expect(await rowExists(review.id)).toBe(true);
    expect(await stillThere(review.path)).toBe(true);
  });

  it('copes with a file that has already gone', async () => {
    const [row] = await db
      .insert(imageParseSessions)
      .values({
        householdId,
        userId,
        status: 'failed',
        originalImagePath: join(dir, 'never-existed.jpg'),
        createdAt: LONG_AGO,
        updatedAt: LONG_AGO,
      })
      .returning({ id: imageParseSessions.id });

    await expect(cleanupAbandonedImageScans()).resolves.toBe(1);
    expect(await rowExists(row.id)).toBe(false);
  });

  it('does nothing, cheaply, when there is nothing to do', async () => {
    await seed('review');
    expect(await cleanupAbandonedImageScans()).toBe(0);
  });
});

describe('image parse sessions no longer carry a fake expiry', () => {
  it('creates sessions without one', async () => {
    const { id } = await seed('review');
    const row = await db.query.imageParseSessions.findFirst({
      where: inArray(imageParseSessions.id, [id]),
    });
    // Seeded directly here, but the service no longer supplies a value either:
    // the column is vestigial and nothing reads it.
    expect(row?.expiresAt ?? null).toBeNull();
  });
});

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import { receiptScans } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

let ctx: RouteTestContext;
let user: TestUser;
let imagePath: string;

// A 1x1 JPEG is enough — we assert on transport, not pixels.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  user = await ctx.createUser(householdId);

  const dir = join(tmpdir(), 'basis-receipt-image-test');
  await mkdir(dir, { recursive: true });
  imagePath = join(dir, 'receipt.jpg');
  await writeFile(imagePath, TINY_JPEG);
});

afterAll(async () => {
  await ctx.close();
});

async function seedScan(path: string | null): Promise<string> {
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId: user.householdId,
      scannedBy: user.id,
      status: 'review',
      imagePath: path,
      imageMimeType: 'image/jpeg',
    })
    .returning({ id: receiptScans.id });
  return scan.id;
}

describe('GET /api/v1/receipts/scans/:id/image', () => {
  it('serves the stored image', async () => {
    const scanId = await seedScan(imagePath);
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBe(TINY_JPEG.length);
  });

  it('404s once the image has been pruned', async () => {
    const scanId = await seedScan(null);
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/image`);
    expect(res.status).toBe(404);
  });

  it('404s for another household', async () => {
    const otherId = await ctx.createHousehold();
    const otherUser = await ctx.createUser(otherId);
    const scanId = await seedScan(imagePath);

    const res = await otherUser.fetch(`/api/v1/receipts/scans/${scanId}/image`);
    expect(res.status).toBe(404);
  });
});

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  inventoryAreas,
  inventoryItems,
  receiptScans,
  receiptScanLines,
} from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

let ctx: RouteTestContext;
let user: TestUser;
let areaId: string;
let itemId: string;

/** Insert a scan already in review, bypassing OCR. */
async function seedScan(merchant: string | null = 'Costco'): Promise<{ scanId: string; lineId: string }> {
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId: user.householdId,
      scannedBy: user.id,
      merchant,
      status: 'review',
      rawOcrText: '1234567 KS ORG EVOO',
    })
    .returning({ id: receiptScans.id });

  const [line] = await db
    .insert(receiptScanLines)
    .values({
      scanId: scan.id,
      householdId: user.householdId,
      lineIndex: 0,
      rawText: '1234567 KS ORG EVOO',
      merchantCode: '1234567',
      count: '1.000',
      price: '21.99',
    })
    .returning({ id: receiptScanLines.id });

  return { scanId: scan.id, lineId: line.id };
}

/**
 * Hand-build a multipart/form-data body with an explicit boundary and part
 * order. `route-harness.ts`'s `fetch` wrapper unconditionally injects
 * `content-type: application/json` whenever a body is present (see its
 * `...(init.body ? { 'content-type': 'application/json' } : {})`), which
 * would collide with the boundary-bearing content-type a native `FormData`
 * body needs — and since fetch only auto-computes that header when none is
 * already set, letting the harness win would silently send the wrong
 * content-type. Building the body by hand lets the test set 'content-type'
 * itself (same lowercase key as the harness, so it cleanly overwrites the
 * default rather than folding into a duplicate header), and — just as
 * importantly — lets the test control exact part order, which is the whole
 * point of the field-ordering regression test below.
 */
function buildMultipart(
  parts: Array<
    | { type: 'file'; name: string; filename: string; contentType: string; data: Buffer }
    | { type: 'field'; name: string; value: string }
  >
): { body: Buffer; contentType: string } {
  const boundary = `testBoundary${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.type === 'file') {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`
        )
      );
      chunks.push(part.data);
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`)
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  user = await ctx.createUser(householdId);

  const [area] = await db
    .insert(inventoryAreas)
    .values({ householdId, name: 'Pantry' })
    .returning({ id: inventoryAreas.id });
  areaId = area.id;

  const [item] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  itemId = item.id;
});

afterAll(async () => {
  await ctx.close();
});

describe('POST /api/v1/receipts/scans', () => {
  it('persists a scan row for the uploading household and user', async () => {
    const { body, contentType } = buildMultipart([
      {
        type: 'file',
        name: 'file',
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
        data: Buffer.from('fake-receipt-bytes'),
      },
    ]);

    const res = await user.fetch('/api/v1/receipts/scans', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(res.status).toBe(200);

    const resBody = await res.json();
    const scan = await db.query.receiptScans.findFirst({
      where: eq(receiptScans.id, resBody.data.id),
    });
    expect(scan?.householdId).toBe(user.householdId);
    expect(scan?.scannedBy).toBe(user.id);
  });

  it('applies defaultAreaId even when the file part precedes it (natural FormData order)', async () => {
    // @fastify/multipart only populates `fields` with what has been parsed so
    // far; a client that appends the file before its other fields — which is
    // exactly what happens when you build a FormData and call
    // `form.append('file', blob)` before `form.append('defaultAreaId', id)` —
    // must still have that field honored. This is the regression test for
    // the "read fields before consuming the stream" bug.
    //
    // The file must be large enough to make busboy apply backpressure on its
    // internal parser (its per-part buffer is a few KB): with a tiny file the
    // whole request arrives in one chunk and busboy parses straight through
    // to the trailing field before the handler even reads `data.fields`, so
    // the bug can't be observed. 1MB reliably stalls the parser until the
    // file stream is drained. Verified against the pre-fix code (fields read
    // before `toBuffer()`): with this same 1MB payload it failed with
    // `defaultAreaId` persisted as null; with a small payload the pre-fix
    // code passed too, which is why this uses 1MB rather than a few bytes.
    const { body, contentType } = buildMultipart([
      {
        type: 'file',
        name: 'file',
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
        data: Buffer.alloc(1024 * 1024, 7),
      },
      { type: 'field', name: 'defaultAreaId', value: areaId },
    ]);

    const res = await user.fetch('/api/v1/receipts/scans', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(res.status).toBe(200);

    const resBody = await res.json();
    const scan = await db.query.receiptScans.findFirst({
      where: eq(receiptScans.id, resBody.data.id),
    });
    expect(scan?.defaultAreaId).toBe(areaId);
  });

  it('404s on a defaultAreaId from another household', async () => {
    const otherHouseholdId = await ctx.createHousehold();
    const [foreignArea] = await db
      .insert(inventoryAreas)
      .values({ householdId: otherHouseholdId, name: 'Someone else pantry' })
      .returning({ id: inventoryAreas.id });

    const { body, contentType } = buildMultipart([
      {
        type: 'file',
        name: 'file',
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
        data: Buffer.from('fake-receipt-bytes'),
      },
      { type: 'field', name: 'defaultAreaId', value: foreignArea.id },
    ]);

    const res = await user.fetch('/api/v1/receipts/scans', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(res.status).toBe(404);
  });

  it('rejects an oversized upload with a clean client error, not a 500', async () => {
    const oversized = Buffer.alloc(16 * 1024 * 1024, 1); // over the 15MB default
    const { body, contentType } = buildMultipart([
      {
        type: 'file',
        name: 'file',
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
        data: oversized,
      },
    ]);

    const res = await user.fetch('/api/v1/receipts/scans', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(res.status).toBe(400);

    const resBody = await res.json();
    expect(resBody.error.message).toMatch(/size|large|MB/i);
  });
});

describe('GET /api/v1/receipts/scans/:id', () => {
  it('returns the scan with its lines and suggestions', async () => {
    const { scanId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.scan.merchant).toBe('Costco');
    expect(body.data.scan.lines).toHaveLength(1);
    expect(Array.isArray(body.data.scan.lines[0].suggestions)).toBe(true);
  });

  it('404s for an unknown id', async () => {
    const res = await user.fetch(`/api/v1/receipts/scans/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/receipts/scans/:id/status', () => {
  it('returns just status and stage', async () => {
    const { scanId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/status`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.status).toBe('review');
    expect(body.data.lines).toBeUndefined();
  });
});

describe('PATCH /api/v1/receipts/scans/:id', () => {
  it('updates the merchant', async () => {
    const { scanId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchant: 'Safeway' }),
    });
    expect(res.status).toBe(200);

    const scan = await db.query.receiptScans.findFirst({
      where: eq(receiptScans.id, scanId),
    });
    expect(scan?.merchant).toBe('Safeway');
  });

  it('refuses to edit a confirmed scan', async () => {
    const { scanId } = await seedScan();
    await db.update(receiptScans).set({ status: 'confirmed' }).where(eq(receiptScans.id, scanId));

    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchant: 'Safeway' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/v1/receipts/scans/:id/lines/:lineId', () => {
  it('links a line to an item with a conversion', async () => {
    const { scanId, lineId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId, unitsPerCount: 2000 }),
    });
    expect(res.status).toBe(200);

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, lineId),
    });
    expect(line?.resolution).toBe('link');
    expect(line?.itemId).toBe(itemId);
    expect(line?.unitsPerCount).toBe('2000.000');
  });

  it('rejects a link with no conversion', async () => {
    const { scanId, lineId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an item from another household', async () => {
    const otherHouseholdId = await ctx.createHousehold();
    const [foreign] = await db
      .insert(inventoryItems)
      .values({ householdId: otherHouseholdId, name: 'Someone else oil', defaultUnit: 'ml' })
      .returning({ id: inventoryItems.id });

    const { scanId, lineId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId: foreign.id, unitsPerCount: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('clears item and conversion when set to ignore', async () => {
    const { scanId, lineId } = await seedScan();
    await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId, unitsPerCount: 2000 }),
    });
    await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'ignore' }),
    });

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, lineId),
    });
    expect(line?.resolution).toBe('ignore');
    expect(line?.itemId).toBeNull();
    expect(line?.unitsPerCount).toBeNull();
  });
});

describe('POST /api/v1/receipts/scans/:id/lines/:lineId/create-item', () => {
  it('creates the item and links the line in one call', async () => {
    const { scanId, lineId } = await seedScan();
    const res = await user.fetch(
      `/api/v1/receipts/scans/${scanId}/lines/${lineId}/create-item`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Kirkland Olive Oil',
          defaultUnit: 'ml',
          unitsPerCount: 2000,
          defaultAreaId: areaId,
        }),
      }
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.item.name).toBe('Kirkland Olive Oil');

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, lineId),
    });
    expect(line?.resolution).toBe('link');
    expect(line?.itemId).toBe(body.data.item.id);
    expect(line?.unitsPerCount).toBe('2000.000');
  });
});

describe('DELETE /api/v1/receipts/scans/:id', () => {
  it('cancels the scan and cascades its lines', async () => {
    const { scanId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(receiptScanLines)
      .where(eq(receiptScanLines.scanId, scanId));
    expect(rows).toHaveLength(0);
  });
});

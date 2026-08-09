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

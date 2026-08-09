import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  inventoryAreas,
  inventoryItems,
  inventoryStock,
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
} from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

let ctx: RouteTestContext;
let user: TestUser;
let areaId: string;
let itemId: string;

interface SeedLine {
  rawText: string;
  merchantCode?: string | null;
  count?: string;
  price?: string | null;
  resolution?: 'unresolved' | 'link' | 'ignore';
  itemId?: string | null;
  unitsPerCount?: string | null;
  targetAreaId?: string | null;
}

async function seedScan(
  lines: SeedLine[],
  opts: { merchant?: string | null; defaultAreaId?: string | null } = {}
): Promise<string> {
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId: user.householdId,
      scannedBy: user.id,
      merchant: opts.merchant === undefined ? 'Costco' : opts.merchant,
      defaultAreaId: opts.defaultAreaId === undefined ? areaId : opts.defaultAreaId,
      purchasedAt: new Date('2026-08-01T00:00:00Z'),
      status: 'review',
    })
    .returning({ id: receiptScans.id });

  await db.insert(receiptScanLines).values(
    lines.map((line, index) => ({
      scanId: scan.id,
      householdId: user.householdId,
      lineIndex: index,
      rawText: line.rawText,
      merchantCode: line.merchantCode ?? null,
      count: line.count ?? '1.000',
      price: line.price ?? null,
      resolution: line.resolution ?? 'link',
      itemId: line.itemId === undefined ? itemId : line.itemId,
      unitsPerCount: line.unitsPerCount === undefined ? '2000.000' : line.unitsPerCount,
      targetAreaId: line.targetAreaId ?? null,
    }))
  );

  return scan.id;
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

async function confirm(scanId: string): Promise<Response> {
  return user.fetch(`/api/v1/receipts/scans/${scanId}/confirm`, { method: 'POST' });
}

describe('POST /api/v1/receipts/scans/:id/confirm', () => {
  it('writes stock as count x unitsPerCount in the item default unit', async () => {
    // A dedicated item, not the shared fixture `itemId` — other tests in this
    // file also write stock for `itemId`, so filtering on it alone and taking
    // the last row would silently depend on this test running first. Every
    // strong assertion below (quantity, unit, source, area, price, addedAt)
    // rides on this row being unambiguously the one this test wrote.
    const [testItem] = await db
      .insert(inventoryItems)
      .values({ householdId: user.householdId, name: 'Stock Write Test Item', defaultUnit: 'ml' })
      .returning({ id: inventoryItems.id });

    const scanId = await seedScan([
      {
        rawText: '1234567 KS ORG EVOO',
        merchantCode: '1234567',
        count: '3.000',
        price: '65.97',
        itemId: testItem.id,
      },
    ]);

    const res = await confirm(scanId);
    expect(res.status).toBe(200);

    const stock = await db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.itemId, testItem.id));
    expect(stock).toHaveLength(1);
    const row = stock[0];
    expect(row.quantity).toBe('6000.000');
    expect(row.unit).toBe('ml');
    expect(row.source).toBe('purchase');
    expect(row.areaId).toBe(areaId);
    // 65.97 spread across 6000 ml
    expect(Number(row.pricePerUnit)).toBeCloseTo(0.011, 3);
    // Dated to the receipt's purchase date (seedScan sets it to 2026-08-01),
    // not to whenever confirm happened to run.
    expect(row.addedAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('saves a learned link keyed on the item code', async () => {
    // Distinct merchant code from the previous test — reusing '1234567' here
    // would hit the link that test already saved and bump useCount to 2
    // instead of creating a fresh one at 1.
    const scanId = await seedScan([
      { rawText: '7654321 KS ORG EVOO', merchantCode: '7654321' },
    ]);
    await confirm(scanId);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.lineKey, '7654321'),
    });
    expect(link?.merchant).toBe('costco');
    expect(link?.keyKind).toBe('code');
    expect(link?.itemId).toBe(itemId);
    expect(link?.unitsPerCount).toBe('2000.000');
    expect(link?.useCount).toBe(1);
  });

  it('updates rather than duplicates a link on the second scan', async () => {
    const first = await seedScan([{ rawText: 'ORG SPNCH', merchantCode: '9999' }]);
    await confirm(first);
    const second = await seedScan([
      { rawText: 'ORG SPNCH', merchantCode: '9999', unitsPerCount: '150.000' },
    ]);
    await confirm(second);

    const links = await db
      .select()
      .from(receiptLineLinks)
      .where(eq(receiptLineLinks.lineKey, '9999'));
    expect(links).toHaveLength(1);
    expect(links[0].unitsPerCount).toBe('150.000');
    expect(links[0].useCount).toBe(2);
  });

  it('refuses when any line is unresolved, naming the line', async () => {
    const scanId = await seedScan([
      { rawText: 'KNOWN', merchantCode: '1' },
      { rawText: 'MYSTERY', merchantCode: '2', resolution: 'unresolved', itemId: null, unitsPerCount: null },
    ]);

    const res = await confirm(scanId);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/MYSTERY|unresolved/i);

    // Nothing partially applied.
    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan?.status).toBe('review');
  });

  it('refuses when the merchant is blank', async () => {
    const scanId = await seedScan([{ rawText: 'KS ORG EVOO' }], { merchant: null });
    const res = await confirm(scanId);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/merchant/i);
  });

  it('refuses when a line resolves to no storage area', async () => {
    const [orphanItem] = await db
      .insert(inventoryItems)
      .values({ householdId: user.householdId, name: 'Homeless Item', defaultUnit: 'g' })
      .returning({ id: inventoryItems.id });

    const scanId = await seedScan([{ rawText: 'NO HOME', itemId: orphanItem.id }], {
      defaultAreaId: null,
    });

    const res = await confirm(scanId);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/area/i);
  });

  it('ignores ignored lines entirely — no stock, no link', async () => {
    const scanId = await seedScan([
      { rawText: 'BAG FEE', merchantCode: '55', resolution: 'ignore', itemId: null, unitsPerCount: null },
      { rawText: 'KS ORG EVOO', merchantCode: '56' },
    ]);

    const res = await confirm(scanId);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.stockCreated).toBe(1);
    expect(body.data.ignoredCount).toBe(1);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.lineKey, '55'),
    });
    expect(link).toBeUndefined();
  });

  it('prefers the line target area over the scan default', async () => {
    const [fridge] = await db
      .insert(inventoryAreas)
      .values({ householdId: user.householdId, name: 'Fridge' })
      .returning({ id: inventoryAreas.id });

    const scanId = await seedScan([{ rawText: 'KS ORG EVOO', targetAreaId: fridge.id }]);
    await confirm(scanId);

    const stock = await db.select().from(inventoryStock).where(eq(inventoryStock.areaId, fridge.id));
    expect(stock).toHaveLength(1);
  });

  it('409s on a second confirm, and does not double-write stock', async () => {
    const scanId = await seedScan([{ rawText: 'KS ORG EVOO' }]);
    expect((await confirm(scanId)).status).toBe(200);

    const afterFirst = await db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.itemId, itemId));

    expect((await confirm(scanId)).status).toBe(409);

    const afterSecond = await db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.itemId, itemId));
    expect(afterSecond).toHaveLength(afterFirst.length);
  });

  it('refuses the whole receipt when one of several lines is unplaceable — no partial write', async () => {
    const [freshArea] = await db
      .insert(inventoryAreas)
      .values({ householdId: user.householdId, name: 'Multi-line Refusal Area' })
      .returning({ id: inventoryAreas.id });

    const [freshItem] = await db
      .insert(inventoryItems)
      .values({ householdId: user.householdId, name: 'Multi-line Refusal Item', defaultUnit: 'ml' })
      .returning({ id: inventoryItems.id });

    const [orphanItem] = await db
      .insert(inventoryItems)
      .values({ householdId: user.householdId, name: 'Multi-line Orphan Item', defaultUnit: 'g' })
      .returning({ id: inventoryItems.id });

    const scanId = await seedScan(
      [
        { rawText: 'VALID LINE', itemId: freshItem.id, targetAreaId: freshArea.id },
        { rawText: 'UNPLACEABLE LINE', itemId: orphanItem.id },
      ],
      { defaultAreaId: null }
    );

    const res = await confirm(scanId);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/UNPLACEABLE LINE/);

    // Nothing partially applied — not even the line that resolved cleanly.
    const stock = await db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.itemId, freshItem.id));
    expect(stock).toHaveLength(0);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan?.status).toBe('review');
  });

  it('refuses when a resolved area belongs to another household', async () => {
    const otherHouseholdId = await ctx.createHousehold();
    const [foreignArea] = await db
      .insert(inventoryAreas)
      .values({ householdId: otherHouseholdId, name: 'Someone Else\'s Pantry' })
      .returning({ id: inventoryAreas.id });

    const scanId = await seedScan([{ rawText: 'KS ORG EVOO', targetAreaId: foreignArea.id }]);

    const res = await confirm(scanId);
    expect(res.status).toBe(400);

    // Nothing written, in this household or the other one.
    const stock = await db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.areaId, foreignArea.id));
    expect(stock).toHaveLength(0);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan?.status).toBe('review');
  });
});

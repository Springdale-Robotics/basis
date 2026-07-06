import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  households,
  inventoryAreas,
  inventoryItems,
  inventoryStock,
  notifications,
} from '../../src/db/schema/index.js';
import { alreadyNotified } from '../../src/jobs/inventory.worker.js';
import { getItemConfidence } from '../../src/services/inventory-confidence.service.js';

/**
 * July 2026 review, inventory HIGHs: the daily worker had no duplicate
 * suppression (an expired tranche notified forever), and the confidence
 * service summed mixed-unit tranches raw (500 g + 1 kg = "501 g"), which
 * fed wrong deltas to the v2 shopping generator.
 */

let hhId: string;

beforeAll(async () => {
  hhId = randomUUID();
  await db.insert(households).values({ id: hhId, name: `Worker Dedupe ${hhId.slice(0, 8)}` });
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, hhId));
});

describe('alreadyNotified', () => {
  it('matches an existing notification by type and data fields', async () => {
    const stockId = randomUUID();
    await db.insert(notifications).values({
      householdId: hhId,
      type: 'expiring_soon',
      title: 'Expiring Soon',
      body: 'Milk expires in 2 days',
      data: { stockId, urgency: 'urgent' },
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(await alreadyNotified(hhId, 'expiring_soon', { stockId, urgency: 'urgent' }, since)).toBe(true);
    // Different urgency level → not a duplicate
    expect(await alreadyNotified(hhId, 'expiring_soon', { stockId, urgency: 'expired' }, since)).toBe(false);
    // Different tranche → not a duplicate
    expect(
      await alreadyNotified(hhId, 'expiring_soon', { stockId: randomUUID(), urgency: 'urgent' }, since),
    ).toBe(false);
  });

  it('ignores notifications older than the window', async () => {
    const itemId = randomUUID();
    const [row] = await db
      .insert(notifications)
      .values({
        householdId: hhId,
        type: 'low_stock',
        title: 'Low Stock Alert',
        body: 'Flour is running low',
        data: { itemId },
      })
      .returning({ id: notifications.id });
    // Age the row past the 7-day lookback
    await db
      .update(notifications)
      .set({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(notifications.id, row.id));

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(await alreadyNotified(hhId, 'low_stock', { itemId }, since)).toBe(false);
  });
});

describe('confidence totalQuantity uses unit conversion', () => {
  it('500 g + 1 kg totals 1500 g, not 501', async () => {
    const [area] = await db
      .insert(inventoryAreas)
      .values({ householdId: hhId, name: 'Pantry', locationType: 'pantry' })
      .returning({ id: inventoryAreas.id });
    const [item] = await db
      .insert(inventoryItems)
      .values({ householdId: hhId, name: 'Mixed Unit Flour', defaultUnit: 'g' })
      .returning({ id: inventoryItems.id });

    await db.insert(inventoryStock).values([
      { itemId: item.id, areaId: area.id, quantity: '500', unit: 'g', confidence: 100, source: 'manual' },
      { itemId: item.id, areaId: area.id, quantity: '1', unit: 'kg', confidence: 100, source: 'manual' },
    ]);

    const result = await getItemConfidence(item.id, hhId);
    expect(result).not.toBeNull();
    expect(result!.totalQuantity).toBeCloseTo(1500, 3);
    expect(result!.unit).toBe('g');
  });
});

import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  households,
  inventoryAreas,
  inventoryItems,
  inventoryStock,
} from '../../src/db/schema/index.js';
import { depleteTranches, reconcileItem } from '../../src/services/inventory-confidence.service.js';

/**
 * July 2026 review, inventory HIGH: depleteTranches was an unlocked
 * read-modify-write — two concurrent depletes planned against the same
 * tranche reads and lost updates (or resurrected stock). It now locks the
 * item's stock rows in a transaction, same pattern as recipe cook-finish.
 */

let hhId: string;
let areaId: string;

async function makeItemWithStock(quantity: string): Promise<string> {
  const [item] = await db
    .insert(inventoryItems)
    .values({ householdId: hhId, name: `Deplete ${randomUUID().slice(0, 8)}`, defaultUnit: 'g' })
    .returning({ id: inventoryItems.id });
  await db.insert(inventoryStock).values({
    itemId: item.id,
    areaId,
    quantity,
    unit: 'g',
    confidence: 100,
    source: 'manual',
  });
  return item.id;
}

async function totalStock(itemId: string): Promise<number> {
  const rows = await db
    .select({ quantity: inventoryStock.quantity })
    .from(inventoryStock)
    .where(eq(inventoryStock.itemId, itemId));
  return rows.reduce((s, r) => s + parseFloat(r.quantity), 0);
}

beforeAll(async () => {
  hhId = randomUUID();
  await db.insert(households).values({ id: hhId, name: `Depletion ${hhId.slice(0, 8)}` });
  const [area] = await db
    .insert(inventoryAreas)
    .values({ householdId: hhId, name: 'Pantry', locationType: 'pantry' })
    .returning({ id: inventoryAreas.id });
  areaId = area.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, hhId));
});

describe('locked depletion', () => {
  it('two concurrent depletes never over-deduct or resurrect stock', async () => {
    const itemId = await makeItemWithStock('500');

    const [a, b] = await Promise.all([
      depleteTranches(itemId, hhId, 300, 'g'),
      depleteTranches(itemId, hhId, 300, 'g'),
    ]);

    // 500 − 300 − 200 = 0; combined depleted = 500, combined shortfall = 100.
    expect(await totalStock(itemId)).toBe(0);
    expect(a.totalDepleted + b.totalDepleted).toBeCloseTo(500, 3);
    expect((a.shortfall ?? 0) + (b.shortfall ?? 0)).toBeCloseTo(100, 3);
  });

  it('reconcile is atomic and serializes against depletes', async () => {
    const itemId = await makeItemWithStock('500');

    await Promise.all([
      reconcileItem(itemId, hhId, 200, 'g', areaId, 'test-user'),
      depleteTranches(itemId, hhId, 100, 'g'),
    ]);

    // Whatever the interleaving, the item ends in a consistent state:
    // reconcile-then-deplete → 100; deplete-then-reconcile → 200.
    const total = await totalStock(itemId);
    expect([100, 200]).toContain(total);
  });
});

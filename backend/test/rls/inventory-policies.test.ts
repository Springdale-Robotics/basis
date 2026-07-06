import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../src/config/database.js';
import {
  households,
  inventoryAreas,
  inventoryItems,
  inventoryStock,
} from '../../src/db/schema/index.js';

/**
 * RLS stage 1 — prove the database-level backstop enforces tenancy under
 * `SET ROLE basis_rls` + the app.household_id GUC, INDEPENDENT of the
 * application's `where householdId` checks. These queries run as basis_rls
 * (RLS applies); the fixtures are created as the owner (RLS bypassed).
 *
 * Each assertion block runs inside a transaction using SET LOCAL, so the role
 * and GUC auto-reset on commit — the pooled connection is never left as
 * basis_rls. See docs/product-review-2026-07/RLS-PLAN.md.
 */

const hhA = randomUUID();
const hhB = randomUUID();
let aItemId: string;
let bItemId: string;
let aAreaId: string;

/** Run fn with basis_rls role + household context, transaction-locally. */
function asHousehold<T>(householdId: string, fn: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE basis_rls`;
    await tx.unsafe(`SET LOCAL app.household_id = '${householdId}'`);
    return fn(tx as unknown as typeof sql);
  }) as Promise<T>;
}

beforeAll(async () => {
  // Fixtures created as the owner (bypasses RLS).
  await db.insert(households).values([
    { id: hhA, name: `RLS A ${hhA.slice(0, 8)}` },
    { id: hhB, name: `RLS B ${hhB.slice(0, 8)}` },
  ]);
  const [aArea] = await db
    .insert(inventoryAreas)
    .values({ householdId: hhA, name: 'A Pantry', locationType: 'pantry' })
    .returning({ id: inventoryAreas.id });
  aAreaId = aArea.id;
  const [aItem] = await db
    .insert(inventoryItems)
    .values({ householdId: hhA, name: 'A Flour', defaultUnit: 'g' })
    .returning({ id: inventoryItems.id });
  aItemId = aItem.id;
  const [bItem] = await db
    .insert(inventoryItems)
    .values({ householdId: hhB, name: 'B Secret', defaultUnit: 'g' })
    .returning({ id: inventoryItems.id });
  bItemId = bItem.id;
  await db.insert(inventoryStock).values({ itemId: aItemId, areaId: aAreaId, quantity: '10', unit: 'g' });
});

afterAll(async () => {
  // Deletes run as the owner (bypass RLS), cascading everything.
  await db.delete(households).where(eq(households.id, hhA));
  await db.delete(households).where(eq(households.id, hhB));
});

describe('RLS: inventory policies enforce tenancy at the DB layer', () => {
  it('a household context sees only its own items', async () => {
    const aRows = await asHousehold(hhA, (tx) => tx`SELECT id FROM inventory_items`);
    const aIds = aRows.map((r) => r.id);
    expect(aIds).toContain(aItemId);
    expect(aIds).not.toContain(bItemId);

    const bRows = await asHousehold(hhB, (tx) => tx`SELECT id FROM inventory_items`);
    const bIds = bRows.map((r) => r.id);
    expect(bIds).toContain(bItemId);
    expect(bIds).not.toContain(aItemId);
  });

  it('the join policy hides another household stock (table has no household_id)', async () => {
    const bSeesAStock = await asHousehold(hhB, (tx) =>
      tx`SELECT count(*)::int AS n FROM inventory_stock WHERE item_id = ${aItemId}`,
    );
    expect(bSeesAStock[0].n).toBe(0);

    const aSeesAStock = await asHousehold(hhA, (tx) =>
      tx`SELECT count(*)::int AS n FROM inventory_stock WHERE item_id = ${aItemId}`,
    );
    expect(aSeesAStock[0].n).toBe(1);
  });

  it('WITH CHECK blocks injecting stock into another household item', async () => {
    await expect(
      asHousehold(hhA, (tx) =>
        tx`INSERT INTO inventory_stock (item_id, area_id, quantity, unit)
           VALUES (${bItemId}, ${aAreaId}, '99', 'g')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('WITH CHECK blocks creating an item in another household', async () => {
    await expect(
      asHousehold(hhA, (tx) =>
        tx`INSERT INTO inventory_items (household_id, name, default_unit)
           VALUES (${hhB}, 'Injected', 'g')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('with no household context set, RLS reveals nothing (fail-closed)', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE basis_rls`;
      // deliberately do NOT set app.household_id
      return tx`SELECT count(*)::int AS n FROM inventory_items`;
    });
    expect((rows as unknown as Array<{ n: number }>)[0].n).toBe(0);
  });
});

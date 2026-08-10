import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../src/config/database.js';
import {
  households,
  users,
  inventoryItems,
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
} from '../../src/db/schema/index.js';

/**
 * RLS backstop for the receipts tables. These queries run as basis_rls (RLS
 * applies); fixtures are created as the owner (RLS bypassed). A leak here
 * exposes another household's purchase history.
 */

const hhA = randomUUID();
const hhB = randomUUID();
const userB = randomUUID();
let bScanId: string;
let bLineId: string;
let bLinkId: string;
let bItemId: string;

/** Run fn with basis_rls role + household context, transaction-locally. */
function asHousehold<T>(householdId: string, fn: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE basis_rls`;
    await tx.unsafe(`SET LOCAL app.household_id = '${householdId}'`);
    return fn(tx as unknown as typeof sql);
  }) as Promise<T>;
}

beforeAll(async () => {
  await db.insert(households).values([
    { id: hhA, name: `RLS Receipts A ${hhA.slice(0, 8)}` },
    { id: hhB, name: `RLS Receipts B ${hhB.slice(0, 8)}` },
  ]);
  await db.insert(users).values({
    id: userB,
    householdId: hhB,
    email: `${userB}@test.local`,
    passwordHash: 'x',
    displayName: 'B Scanner',
    role: 'admin',
  });

  const [bItem] = await db
    .insert(inventoryItems)
    .values({ householdId: hhB, name: 'B Secret Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  bItemId = bItem.id;

  const [bScan] = await db
    .insert(receiptScans)
    .values({ householdId: hhB, scannedBy: userB, merchant: 'Costco', status: 'review' })
    .returning({ id: receiptScans.id });
  bScanId = bScan.id;

  const [bLine] = await db
    .insert(receiptScanLines)
    .values({
      scanId: bScanId,
      householdId: hhB,
      lineIndex: 0,
      rawText: 'B SECRET PURCHASE',
      count: '1.000',
    })
    .returning({ id: receiptScanLines.id });
  bLineId = bLine.id;

  const [bLink] = await db
    .insert(receiptLineLinks)
    .values({
      householdId: hhB,
      merchant: 'costco',
      lineKey: 'b-secret-code',
      keyKind: 'code',
      itemId: bItemId,
      unitsPerCount: '2000.000',
    })
    .returning({ id: receiptLineLinks.id });
  bLinkId = bLink.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, hhA));
  await db.delete(households).where(eq(households.id, hhB));
});

describe('receipts RLS policies', () => {
  it("hides another household's scans", async () => {
    const rows = await asHousehold(hhA, (tx) =>
      tx`SELECT id FROM receipt_scans WHERE id = ${bScanId}`
    );
    expect(rows).toHaveLength(0);
  });

  it("shows a household its own scans", async () => {
    const rows = await asHousehold(hhB, (tx) =>
      tx`SELECT id FROM receipt_scans WHERE id = ${bScanId}`
    );
    expect(rows).toHaveLength(1);
  });

  it("hides another household's scan lines", async () => {
    const rows = await asHousehold(hhA, (tx) =>
      tx`SELECT id FROM receipt_scan_lines WHERE id = ${bLineId}`
    );
    expect(rows).toHaveLength(0);
  });

  it("hides another household's learned links", async () => {
    const rows = await asHousehold(hhA, (tx) =>
      tx`SELECT id FROM receipt_line_links WHERE id = ${bLinkId}`
    );
    expect(rows).toHaveLength(0);
  });

  it('refuses an update that would reach across households', async () => {
    await asHousehold(hhA, (tx) =>
      tx`UPDATE receipt_scans SET merchant = 'Hacked' WHERE id = ${bScanId}`
    );
    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, bScanId) });
    expect(scan?.merchant).toBe('Costco');
  });

  it('refuses an insert stamped with another household id', async () => {
    await expect(
      asHousehold(hhA, (tx) =>
        tx`INSERT INTO receipt_line_links
             (household_id, merchant, line_key, key_kind, item_id, units_per_count)
           VALUES (${hhB}, 'costco', 'injected', 'code', ${bItemId}, 1)`
      )
    ).rejects.toThrow();
  });
});

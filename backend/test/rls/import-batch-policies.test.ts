import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../src/config/database.js';
import { households, users, recipeImportBatches } from '../../src/db/schema/index.js';

/**
 * RLS backstop for the import-batch table.
 *
 * These queries run as basis_rls, where the policy applies; the fixtures are
 * created as the owner, where it does not. Unlike a route-level tenancy test —
 * which cannot tell the two layers apart (issue #69) — this one is only about
 * the policy, so it fails if the policy is missing.
 */

const hhA = randomUUID();
const hhB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
let bBatchId: string;

/** Run fn as basis_rls with a household context, transaction-locally. */
function asHousehold<T>(householdId: string, fn: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE basis_rls`;
    await tx.unsafe(`SET LOCAL app.household_id = '${householdId}'`);
    return fn(tx as unknown as typeof sql);
  }) as Promise<T>;
}

beforeAll(async () => {
  await db.insert(households).values([
    { id: hhA, name: `RLS Batches A ${hhA.slice(0, 8)}` },
    { id: hhB, name: `RLS Batches B ${hhB.slice(0, 8)}` },
  ]);
  await db.insert(users).values([
    {
      id: userA,
      householdId: hhA,
      email: `${userA}@test.local`,
      passwordHash: 'x',
      displayName: 'A Photographer',
      role: 'admin',
    },
    {
      id: userB,
      householdId: hhB,
      email: `${userB}@test.local`,
      passwordHash: 'x',
      displayName: 'B Photographer',
      role: 'admin',
    },
  ]);

  const [batch] = await db
    .insert(recipeImportBatches)
    .values({ householdId: hhB, createdBy: userB, name: "B's binder" })
    .returning({ id: recipeImportBatches.id });
  bBatchId = batch.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, hhA));
  await db.delete(households).where(eq(households.id, hhB));
});

describe('recipe_import_batches RLS', () => {
  it("hides another household's batches", async () => {
    const rows = await asHousehold(hhA, (tx) => tx`SELECT id FROM recipe_import_batches`);
    expect(rows.map((r: { id: string }) => r.id)).not.toContain(bBatchId);
  });

  it('shows a household its own', async () => {
    const rows = await asHousehold(hhB, (tx) => tx`SELECT id FROM recipe_import_batches`);
    expect(rows.map((r: { id: string }) => r.id)).toContain(bBatchId);
  });

  it("will not update another household's batch", async () => {
    await asHousehold(
      hhA,
      (tx) => tx`UPDATE recipe_import_batches SET status = 'closed' WHERE id = ${bBatchId}`
    );

    const still = await db.query.recipeImportBatches.findFirst({
      where: eq(recipeImportBatches.id, bBatchId),
    });
    expect(still?.status).toBe('open');
  });

  it("will not delete another household's batch", async () => {
    await asHousehold(hhA, (tx) => tx`DELETE FROM recipe_import_batches WHERE id = ${bBatchId}`);

    const still = await db.query.recipeImportBatches.findFirst({
      where: eq(recipeImportBatches.id, bBatchId),
    });
    expect(still).toBeTruthy();
  });

  it('refuses to write a row into another household', async () => {
    await expect(
      asHousehold(
        hhA,
        (tx) => tx`
          INSERT INTO recipe_import_batches (household_id, created_by, name)
          VALUES (${hhB}, ${userB}, 'smuggled')
        `
      )
    ).rejects.toThrow();
  });
});

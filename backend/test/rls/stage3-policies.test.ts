import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../src/config/database.js';
import { households, lists, listItems, tasks, users } from '../../src/db/schema/index.js';

/**
 * RLS stage 3 — spot-check that the rolled-out policies enforce at the DB layer
 * on representative tables beyond inventory: `tasks` (direct household_id) and
 * `list_items` (join policy through `lists`). Same approach as stage 1: run as
 * basis_rls with a household context and confirm isolation + WITH CHECK, so
 * we're proving RLS itself, not the app's own filters.
 */

const hhA = randomUUID();
const hhB = randomUUID();
let aUser: string;
let bUser: string;
let aTask: string;
let bTask: string;
let aList: string;
let bList: string;
let aListItem: string;

function asHousehold<T>(householdId: string, fn: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE basis_rls`;
    await tx.unsafe(`SET LOCAL app.household_id = '${householdId}'`);
    return fn(tx as unknown as typeof sql);
  }) as Promise<T>;
}

beforeAll(async () => {
  await db.insert(households).values([
    { id: hhA, name: `S3 A ${hhA.slice(0, 8)}` },
    { id: hhB, name: `S3 B ${hhB.slice(0, 8)}` },
  ]);
  const [ua] = await db.insert(users).values({ householdId: hhA, email: `s3a-${hhA.slice(0, 8)}@t.local`, passwordHash: 'x', displayName: 'A', role: 'admin' }).returning({ id: users.id });
  const [ub] = await db.insert(users).values({ householdId: hhB, email: `s3b-${hhB.slice(0, 8)}@t.local`, passwordHash: 'x', displayName: 'B', role: 'admin' }).returning({ id: users.id });
  aUser = ua.id; bUser = ub.id;
  const [ta] = await db.insert(tasks).values({ householdId: hhA, createdBy: aUser, title: 'A task' }).returning({ id: tasks.id });
  const [tb] = await db.insert(tasks).values({ householdId: hhB, createdBy: bUser, title: 'B task' }).returning({ id: tasks.id });
  aTask = ta.id; bTask = tb.id;
  const [la] = await db.insert(lists).values({ householdId: hhA, name: 'A list', createdBy: aUser }).returning({ id: lists.id });
  const [lb] = await db.insert(lists).values({ householdId: hhB, name: 'B list', createdBy: bUser }).returning({ id: lists.id });
  aList = la.id; bList = lb.id;
  const [li] = await db.insert(listItems).values({ listId: aList, content: 'A item', createdBy: aUser }).returning({ id: listItems.id });
  aListItem = li.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, hhA));
  await db.delete(households).where(eq(households.id, hhB));
});

describe('RLS stage 3: direct + join policies enforce', () => {
  it('tasks (direct): a household sees only its own', async () => {
    const aIds = (await asHousehold(hhA, (tx) => tx`SELECT id FROM tasks`)).map((r) => r.id);
    expect(aIds).toContain(aTask);
    expect(aIds).not.toContain(bTask);
  });

  it('tasks (direct): WITH CHECK blocks creating a task in another household', async () => {
    await expect(
      asHousehold(hhA, (tx) =>
        tx`INSERT INTO tasks (household_id, created_by, title) VALUES (${hhB}, ${aUser}, 'x')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('list_items (join): another household item is invisible', async () => {
    const aSees = await asHousehold(hhA, (tx) => tx`SELECT count(*)::int AS n FROM list_items WHERE id = ${aListItem}`);
    expect(aSees[0].n).toBe(1);
    const bSees = await asHousehold(hhB, (tx) => tx`SELECT count(*)::int AS n FROM list_items WHERE id = ${aListItem}`);
    expect(bSees[0].n).toBe(0);
  });

  it('list_items (join): WITH CHECK blocks adding an item to another household list', async () => {
    await expect(
      asHousehold(hhB, (tx) =>
        tx`INSERT INTO list_items (list_id, content, created_by) VALUES (${aList}, 'sneak', ${bUser})`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

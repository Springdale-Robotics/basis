import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  groups,
  households,
  lists,
  permissions,
  recipes,
  tasks,
  users,
} from '../../src/db/schema/index.js';

/**
 * Auth review HIGH: removing a member did `db.delete(users)`, and the
 * authored-content FKs cascaded — so it silently destroyed every recipe, list,
 * task, group they created, and every permission grant they authored
 * (including household-wide defaults). Migration 0009 switched those FKs to
 * ON DELETE SET NULL: the content must survive with a null author.
 */

let hhId: string;
let leaverId: string;
let keeperId: string;
let recipeId: string;
let listId: string;
let taskId: string;
let groupId: string;
let permId: string;

beforeAll(async () => {
  hhId = randomUUID();
  await db.insert(households).values({ id: hhId, name: `Removal ${hhId.slice(0, 8)}` });
  const [leaver] = await db
    .insert(users)
    .values({ householdId: hhId, email: `leaver-${hhId.slice(0, 8)}@t.local`, passwordHash: 'x', displayName: 'Leaver', role: 'member' })
    .returning({ id: users.id });
  const [keeper] = await db
    .insert(users)
    .values({ householdId: hhId, email: `keeper-${hhId.slice(0, 8)}@t.local`, passwordHash: 'x', displayName: 'Keeper', role: 'admin' })
    .returning({ id: users.id });
  leaverId = leaver.id;
  keeperId = keeper.id;

  // Content the LEAVER authored — shared with the household.
  recipeId = (await db.insert(recipes).values({ householdId: hhId, title: 'Family Chili', createdBy: leaverId }).returning({ id: recipes.id }))[0].id;
  listId = (await db.insert(lists).values({ householdId: hhId, name: 'Groceries', createdBy: leaverId }).returning({ id: lists.id }))[0].id;
  taskId = (await db.insert(tasks).values({ householdId: hhId, title: 'Take out trash', createdBy: leaverId }).returning({ id: tasks.id }))[0].id;
  groupId = (await db.insert(groups).values({ householdId: hhId, name: 'Parents', createdBy: leaverId }).returning({ id: groups.id }))[0].id;
  // A household-wide permission grant authored by the leaver.
  permId = (await db.insert(permissions).values({ resourceType: 'list', resourceId: listId, granteeType: 'household', granteeId: hhId, permissionLevel: 'view', createdBy: leaverId }).returning({ id: permissions.id }))[0].id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, hhId));
});

describe('removing a member preserves their authored content', () => {
  it('deleting the user nulls the author but keeps the content', async () => {
    // Simulate what households.routes member removal does.
    await db.delete(users).where(eq(users.id, leaverId));

    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(recipe).toBeDefined();
    expect(recipe.createdBy).toBeNull();

    const [list] = await db.select().from(lists).where(eq(lists.id, listId));
    expect(list).toBeDefined();
    expect(list.createdBy).toBeNull();

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task).toBeDefined();
    expect(task.createdBy).toBeNull();

    const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
    expect(group).toBeDefined();
    expect(group.createdBy).toBeNull();

    // The household-wide permission grant survives — other members keep access.
    const [perm] = await db.select().from(permissions).where(eq(permissions.id, permId));
    expect(perm).toBeDefined();
    expect(perm.createdBy).toBeNull();
    expect(perm.permissionLevel).toBe('view');
  });

  it('the remaining admin is untouched', async () => {
    const [keeper] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, keeperId), eq(users.householdId, hhId)));
    expect(keeper).toBeDefined();
  });
});

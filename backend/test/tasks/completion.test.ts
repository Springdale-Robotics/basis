import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { rewardHistory, rewards, tasks } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * July 2026 review, tasks CRITICAL/HIGH: POST /:id/complete never checked
 * task.status, so every replay re-awarded points (kid farms rewards, bulk
 * complete fires N parallel replays), and the reward read-modify-write raced
 * into duplicate rows. Completion now runs in a transaction with the task row
 * locked, no-ops on replay, and upserts rewards with SQL-level increments.
 */

let ctx: RouteTestContext;
let user: TestUser;
let hhId: string;

async function makeTask(overrides: Partial<typeof tasks.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(tasks)
    .values({
      householdId: hhId,
      createdBy: user.id,
      title: 'Test task',
      rewardPoints: 10,
      ...overrides,
    })
    .returning({ id: tasks.id });
  return row.id;
}

async function userPoints(): Promise<{ points: number; lifetimePoints: number; rows: number }> {
  const rows = await db
    .select()
    .from(rewards)
    .where(and(eq(rewards.householdId, hhId), eq(rewards.userId, user.id)));
  return {
    points: rows.reduce((s, r) => s + r.points, 0),
    lifetimePoints: rows.reduce((s, r) => s + r.lifetimePoints, 0),
    rows: rows.length,
  };
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  hhId = await ctx.createHousehold('Tasks Completion');
  user = await ctx.createUser(hhId, 'admin');
});

afterAll(async () => {
  await ctx.close();
});

describe('task completion idempotency and atomic rewards', () => {
  it('completing a one-shot task twice awards points only once', async () => {
    const taskId = await makeTask();
    const before = await userPoints();

    const first = await user.fetch(`/api/v1/tasks/${taskId}/complete`, { method: 'POST' });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as any;
    expect(firstBody.data.task.status).toBe('completed');

    const second = await user.fetch(`/api/v1/tasks/${taskId}/complete`, { method: 'POST' });
    expect(second.status).toBe(200);

    const after = await userPoints();
    expect(after.points - before.points).toBe(10);
    expect(after.lifetimePoints - before.lifetimePoints).toBe(10);

    const history = await db
      .select()
      .from(rewardHistory)
      .where(eq(rewardHistory.taskId, taskId));
    expect(history).toHaveLength(1);
  });

  it('N parallel completes of the same task award points exactly once', async () => {
    const taskId = await makeTask({ title: 'Race task' });
    const before = await userPoints();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        user.fetch(`/api/v1/tasks/${taskId}/complete`, { method: 'POST' })
      )
    );
    for (const res of results) expect(res.status).toBe(200);

    const after = await userPoints();
    expect(after.points - before.points).toBe(10);

    const history = await db
      .select()
      .from(rewardHistory)
      .where(eq(rewardHistory.taskId, taskId));
    expect(history).toHaveLength(1);
  });

  it('a chore re-completed the same day is a no-op', async () => {
    const choreId = await makeTask({
      title: 'Daily chore',
      kind: 'chore',
      recurrenceMode: 'reset_on_complete',
      cadenceDays: 2,
    });
    const before = await userPoints();

    const first = await user.fetch(`/api/v1/tasks/${choreId}/complete`, { method: 'POST' });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as any;
    // Chores stay pending with the due date advanced
    expect(firstBody.data.task.status).toBe('pending');
    expect(firstBody.data.task.dueDate).not.toBeNull();

    const second = await user.fetch(`/api/v1/tasks/${choreId}/complete`, { method: 'POST' });
    expect(second.status).toBe(200);

    const after = await userPoints();
    expect(after.points - before.points).toBe(10);
  });

  it('a chore completed yesterday can be completed again today', async () => {
    const choreId = await makeTask({
      title: 'Yesterday chore',
      kind: 'chore',
      recurrenceMode: 'reset_on_complete',
      cadenceDays: 1,
      lastCompletedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    const before = await userPoints();

    const res = await user.fetch(`/api/v1/tasks/${choreId}/complete`, { method: 'POST' });
    expect(res.status).toBe(200);

    const after = await userPoints();
    expect(after.points - before.points).toBe(10);
  });

  it('concurrent completions of different tasks never create duplicate reward rows', async () => {
    const ids = await Promise.all(
      Array.from({ length: 4 }, (_, i) => makeTask({ title: `Parallel ${i}` }))
    );
    const before = await userPoints();

    await Promise.all(
      ids.map((id) => user.fetch(`/api/v1/tasks/${id}/complete`, { method: 'POST' }))
    );

    const after = await userPoints();
    expect(after.rows).toBe(1);
    expect(after.points - before.points).toBe(40);
  });
});

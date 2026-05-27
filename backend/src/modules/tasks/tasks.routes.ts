import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import rrulePkg from 'rrule';
const { RRule } = rrulePkg as unknown as { RRule: typeof import('rrule').RRule };
import { db } from '../../config/database.js';
import {
  tasks,
  rewards,
  rewardHistory,
  groupMembers,
  groups,
} from '../../db/schema/index.js';
import { eq, and, or, inArray, sql, asc, desc } from 'drizzle-orm';
import {
  authMiddleware,
  requireAdmin,
} from '../../middleware/auth.middleware.js';
import {
  requireTaskAccess,
  requireTasksAccess,
} from '../../middleware/permission.middleware.js';
import { setResourceDefaults } from '../../services/permission.service.js';
import { Errors } from '../../lib/errors.js';
import {
  emitTaskEvent,
  emitTaskCompleted,
  emitTaskDeleted,
  emitRewardEvent,
} from '../../websocket/events.js';

const taskKindSchema = z.enum(['task', 'chore']);
const recurrenceModeSchema = z.enum(['schedule', 'reset_on_complete']);

// RRULE validation. Keeps the iCal-ish prefix check from the legacy validator
// but accepts the broader rule string that the `rrule` package emits.
const recurrenceRuleSchema = z
  .string()
  .refine((val) => val.startsWith('FREQ='), {
    message: 'recurrenceRule must be an iCal RRULE (e.g. FREQ=WEEKLY;BYDAY=MO)',
  });

const baseTaskSchema = z.object({
  kind: taskKindSchema.default('task'),
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  assigneeUserId: z.string().uuid().optional().nullable(),
  assigneeGroupId: z.string().uuid().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  cadenceDays: z.number().int().positive().optional().nullable(),
  recurrenceMode: recurrenceModeSchema.optional().nullable(),
  recurrenceRule: recurrenceRuleSchema.optional().nullable(),
  pinned: z.boolean().default(false),
  rewardPoints: z.number().int().min(0).default(0),
});

const createTaskSchema = baseTaskSchema.superRefine((data, ctx) => {
  if (data.assigneeUserId && data.assigneeGroupId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A task can be assigned to a user OR a group, not both.',
      path: ['assigneeGroupId'],
    });
  }
  if (data.recurrenceMode === 'schedule' && !data.recurrenceRule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'recurrenceRule is required when recurrenceMode is "schedule".',
      path: ['recurrenceRule'],
    });
  }
  if (data.recurrenceMode === 'reset_on_complete' && !data.cadenceDays) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'cadenceDays is required when recurrenceMode is "reset_on_complete".',
      path: ['cadenceDays'],
    });
  }
});

const updateTaskSchema = baseTaskSchema
  .partial()
  .extend({ status: z.enum(['pending', 'completed']).optional() });

const reorderSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1),
});

const listQuerySchema = z.object({
  kind: taskKindSchema.optional(),
  status: z.enum(['pending', 'completed']).optional(),
  mine: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
});

// Compute the next dueDate after a chore completion.
function computeNextDueDate(input: {
  recurrenceMode: 'schedule' | 'reset_on_complete';
  recurrenceRule?: string | null;
  cadenceDays?: number | null;
  completedAt: Date;
}): Date | null {
  if (input.recurrenceMode === 'reset_on_complete') {
    if (!input.cadenceDays) return null;
    const next = new Date(input.completedAt);
    next.setDate(next.getDate() + input.cadenceDays);
    return next;
  }
  // schedule mode — use rrule to find the next occurrence after completion.
  if (!input.recurrenceRule) return null;
  try {
    const rule = RRule.fromString(`RRULE:${input.recurrenceRule}`);
    return rule.after(input.completedAt, false);
  } catch {
    return null;
  }
}

async function getUserGroupIds(
  userId: string,
  householdId: string,
): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groups.householdId, householdId),
      ),
    );
  return rows.map((r) => r.groupId);
}

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  // ===== TASKS =====

  // List tasks. Optional filters: kind, status, mine.
  app.get(
    '/',
    { preHandler: [authMiddleware, requireTasksAccess('view')] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const userId = request.user!.id;
      const householdId = request.user!.householdId;

      const conditions = [eq(tasks.householdId, householdId)];

      if (query.kind) conditions.push(eq(tasks.kind, query.kind));
      if (query.status) conditions.push(eq(tasks.status, query.status));

      if (query.mine) {
        const myGroups = await getUserGroupIds(userId, householdId);
        const mineCondition = myGroups.length
          ? or(
              eq(tasks.assigneeUserId, userId),
              inArray(tasks.assigneeGroupId, myGroups),
            )
          : eq(tasks.assigneeUserId, userId);
        if (mineCondition) conditions.push(mineCondition);
      }

      // Order: pinned first, then sortOrder, then due date (nulls last), then
      // newest first as a stable tiebreaker.
      const rows = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(
          desc(tasks.pinned),
          asc(tasks.sortOrder),
          sql`${tasks.dueDate} ASC NULLS LAST`,
          desc(tasks.createdAt),
        )
        .limit(query.limit ?? 200);

      return { success: true, data: { tasks: rows } };
    },
  );

  // Create task.
  app.post(
    '/',
    { preHandler: [authMiddleware, requireTasksAccess('edit')] },
    async (request) => {
      const input = createTaskSchema.parse(request.body);
      const userId = request.user!.id;
      const householdId = request.user!.householdId;

      // Place new items at the end of their kind's list.
      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX(${tasks.sortOrder}), 0)` })
        .from(tasks)
        .where(
          and(eq(tasks.householdId, householdId), eq(tasks.kind, input.kind)),
        );

      const [task] = await db
        .insert(tasks)
        .values({
          householdId,
          createdBy: userId,
          kind: input.kind,
          title: input.title,
          description: input.description ?? null,
          assigneeUserId: input.assigneeUserId ?? null,
          assigneeGroupId: input.assigneeGroupId ?? null,
          dueDate: input.dueDate ?? null,
          cadenceDays: input.cadenceDays ?? null,
          recurrenceMode: input.recurrenceMode ?? null,
          recurrenceRule: input.recurrenceRule ?? null,
          pinned: input.pinned,
          rewardPoints: input.rewardPoints,
          sortOrder: maxOrder + 1,
        })
        .returning();

      await setResourceDefaults('task', task.id, userId, householdId);
      emitTaskEvent(householdId, { taskId: task.id, action: 'created', task });

      return { success: true, data: { task } };
    },
  );

  // Get task by ID.
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireTaskAccess('view')] },
    async (request) => {
      const task = await db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, request.params.id),
          eq(tasks.householdId, request.user!.householdId),
        ),
      });
      if (!task) throw Errors.notFound('Task');
      return { success: true, data: { task } };
    },
  );

  // Update task.
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireTaskAccess('edit')] },
    async (request) => {
      const input = updateTaskSchema.parse(request.body);
      const householdId = request.user!.householdId;

      if (input.assigneeUserId && input.assigneeGroupId) {
        throw Errors.validation(
          'A task can be assigned to a user OR a group, not both.',
        );
      }

      const [updated] = await db
        .update(tasks)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(eq(tasks.id, request.params.id), eq(tasks.householdId, householdId)),
        )
        .returning();

      if (!updated) throw Errors.notFound('Task');

      emitTaskEvent(householdId, {
        taskId: updated.id,
        action: 'updated',
        task: updated,
      });
      return { success: true, data: { task: updated } };
    },
  );

  // Delete task.
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireTaskAccess('admin')] },
    async (request) => {
      const householdId = request.user!.householdId;
      const result = await db
        .delete(tasks)
        .where(
          and(eq(tasks.id, request.params.id), eq(tasks.householdId, householdId)),
        )
        .returning({ id: tasks.id });

      if (result.length === 0) throw Errors.notFound('Task');
      emitTaskDeleted(householdId, request.params.id);
      return { success: true, data: { message: 'Task deleted' } };
    },
  );

  // Complete task. For chores, this records completion and recomputes the
  // next due date instead of marking the task done.
  app.post<{ Params: { id: string } }>(
    '/:id/complete',
    { preHandler: [authMiddleware, requireTaskAccess('view')] },
    async (request) => {
      const householdId = request.user!.householdId;
      const userId = request.user!.id;
      const now = new Date();

      const task = await db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, request.params.id),
          eq(tasks.householdId, householdId),
        ),
      });
      if (!task) throw Errors.notFound('Task');

      let nextDueDate: Date | null = task.dueDate;
      let nextStatus: 'pending' | 'completed' = 'completed';

      if (task.kind === 'chore') {
        // Chores stay pending; the next due date moves forward.
        nextStatus = 'pending';
        if (task.recurrenceMode) {
          nextDueDate = computeNextDueDate({
            recurrenceMode: task.recurrenceMode,
            recurrenceRule: task.recurrenceRule,
            cadenceDays: task.cadenceDays,
            completedAt: now,
          });
        } else {
          // Non-recurring chore — just record the completion and clear the due date.
          nextDueDate = null;
        }
      } else if (task.recurrenceMode) {
        // Recurring one-off task — keep it alive and bump due date.
        nextStatus = 'pending';
        nextDueDate = computeNextDueDate({
          recurrenceMode: task.recurrenceMode,
          recurrenceRule: task.recurrenceRule,
          cadenceDays: task.cadenceDays,
          completedAt: now,
        });
      }

      const [updated] = await db
        .update(tasks)
        .set({
          status: nextStatus,
          lastCompletedAt: now,
          lastCompletedBy: userId,
          dueDate: nextDueDate,
          updatedAt: now,
        })
        .where(eq(tasks.id, task.id))
        .returning();

      // Award points to whoever actually completed it.
      if (task.rewardPoints > 0) {
        let userReward = await db.query.rewards.findFirst({
          where: and(
            eq(rewards.householdId, householdId),
            eq(rewards.userId, userId),
          ),
        });
        if (!userReward) {
          [userReward] = await db
            .insert(rewards)
            .values({ householdId, userId, points: 0, lifetimePoints: 0 })
            .returning();
        }
        const newPoints = userReward.points + task.rewardPoints;
        const newLifetime = userReward.lifetimePoints + task.rewardPoints;
        await db
          .update(rewards)
          .set({
            points: newPoints,
            lifetimePoints: newLifetime,
            updatedAt: now,
          })
          .where(eq(rewards.id, userReward.id));
        await db.insert(rewardHistory).values({
          rewardId: userReward.id,
          taskId: task.id,
          pointsChange: task.rewardPoints,
          reason: `Completed: ${task.title}`,
        });
        emitRewardEvent(householdId, userId, {
          points: newPoints,
          lifetimePoints: newLifetime,
          reason: `Completed: ${task.title}`,
        });
      }

      emitTaskCompleted(householdId, {
        taskId: task.id,
        action: 'completed',
        task: updated,
      });
      return { success: true, data: { task: updated } };
    },
  );

  // Claim a group-assigned task (or any unassigned task) for yourself.
  app.post<{ Params: { id: string } }>(
    '/:id/claim',
    { preHandler: [authMiddleware, requireTaskAccess('view')] },
    async (request) => {
      const householdId = request.user!.householdId;
      const userId = request.user!.id;

      const task = await db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, request.params.id),
          eq(tasks.householdId, householdId),
        ),
      });
      if (!task) throw Errors.notFound('Task');

      if (task.assigneeUserId && task.assigneeUserId !== userId) {
        throw Errors.conflict('Task is already assigned to another user.');
      }

      // If posted to a group, caller must belong to that group.
      if (task.assigneeGroupId) {
        const myGroups = await getUserGroupIds(userId, householdId);
        if (!myGroups.includes(task.assigneeGroupId)) {
          throw Errors.forbidden('You are not a member of that group.');
        }
      }

      const [updated] = await db
        .update(tasks)
        .set({
          assigneeUserId: userId,
          assigneeGroupId: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id))
        .returning();

      emitTaskEvent(householdId, {
        taskId: updated.id,
        action: 'assigned',
        task: updated,
      });
      return { success: true, data: { task: updated } };
    },
  );

  // Reorder tasks. The client sends a list of IDs in the desired order; we
  // overwrite sortOrder by position. All IDs must belong to the household.
  app.post(
    '/reorder',
    { preHandler: [authMiddleware, requireTasksAccess('edit')] },
    async (request) => {
      const { taskIds } = reorderSchema.parse(request.body);
      const householdId = request.user!.householdId;

      const owned = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(eq(tasks.householdId, householdId), inArray(tasks.id, taskIds)),
        );
      if (owned.length !== taskIds.length) {
        throw Errors.forbidden('Some tasks are not in your household.');
      }

      await db.transaction(async (tx) => {
        for (let i = 0; i < taskIds.length; i++) {
          await tx
            .update(tasks)
            .set({ sortOrder: i, updatedAt: new Date() })
            .where(eq(tasks.id, taskIds[i]));
        }
      });

      emitTaskEvent(householdId, {
        taskId: taskIds[0],
        action: 'updated',
      });
      return { success: true, data: { message: 'Reordered' } };
    },
  );

  // ===== REWARDS =====

  app.get('/rewards', { preHandler: [authMiddleware] }, async (request) => {
    const rewardsList = await db.query.rewards.findMany({
      where: eq(rewards.householdId, request.user!.householdId),
    });
    return { success: true, data: { rewards: rewardsList } };
  });

  app.get<{ Params: { userId: string } }>(
    '/rewards/:userId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const reward = await db.query.rewards.findFirst({
        where: and(
          eq(rewards.householdId, request.user!.householdId),
          eq(rewards.userId, request.params.userId),
        ),
      });
      return {
        success: true,
        data: {
          reward: reward ?? {
            userId: request.params.userId,
            points: 0,
            lifetimePoints: 0,
          },
        },
      };
    },
  );

  app.get<{ Params: { userId: string } }>(
    '/rewards/:userId/history',
    { preHandler: [authMiddleware] },
    async (request) => {
      const reward = await db.query.rewards.findFirst({
        where: and(
          eq(rewards.householdId, request.user!.householdId),
          eq(rewards.userId, request.params.userId),
        ),
      });
      if (!reward) return { success: true, data: { history: [] } };

      const history = await db
        .select()
        .from(rewardHistory)
        .where(eq(rewardHistory.rewardId, reward.id))
        .orderBy(desc(rewardHistory.createdAt));
      return { success: true, data: { history } };
    },
  );

  app.post<{ Params: { userId: string } }>(
    '/rewards/:userId/adjust',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const { points, reason } = z
        .object({
          points: z.number().int(),
          reason: z.string().min(1).max(255),
        })
        .parse(request.body);

      const householdId = request.user!.householdId;
      let reward = await db.query.rewards.findFirst({
        where: and(
          eq(rewards.householdId, householdId),
          eq(rewards.userId, request.params.userId),
        ),
      });
      if (!reward) {
        [reward] = await db
          .insert(rewards)
          .values({
            householdId,
            userId: request.params.userId,
            points: 0,
            lifetimePoints: 0,
          })
          .returning();
      }

      const newPoints = Math.max(0, reward.points + points);
      const newLifetime =
        points > 0 ? reward.lifetimePoints + points : reward.lifetimePoints;

      await db
        .update(rewards)
        .set({
          points: newPoints,
          lifetimePoints: newLifetime,
          updatedAt: new Date(),
        })
        .where(eq(rewards.id, reward.id));

      await db.insert(rewardHistory).values({
        rewardId: reward.id,
        pointsChange: points,
        reason,
      });

      emitRewardEvent(householdId, request.params.userId, {
        points: newPoints,
        lifetimePoints: newLifetime,
        reason,
      });

      return {
        success: true,
        data: { points: newPoints, lifetimePoints: newLifetime },
      };
    },
  );

}

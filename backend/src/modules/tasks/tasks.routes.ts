import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { tasks, rewards, rewardHistory, achievements, userAchievements } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireMember, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { taskStatusSchema, iCalRRuleSchema } from '../../lib/validators.js';

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  dueDate: z.coerce.date().optional(),
  recurrenceRule: iCalRRuleSchema,
  assignedTo: z.string().uuid().optional(),
  isChore: z.boolean().default(false),
  rewardPoints: z.number().int().min(0).default(0),
});

const updateTaskSchema = createTaskSchema.partial().extend({
  status: taskStatusSchema.optional(),
});

const createAchievementSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  icon: z.string().max(50).optional(),
  points: z.number().int().min(0).default(0),
  criteriaType: z.enum(['manual', 'automatic', 'milestone']).default('manual'),
  criteria: z.record(z.unknown()).optional(),
});

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  // List tasks
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { status, assignedTo, isChore } = request.query as any;

      const conditions = [eq(tasks.householdId, request.user!.householdId)];

      const taskList = await db.query.tasks.findMany({
        where: and(...conditions),
        orderBy: (t, { asc }) => [asc(t.dueDate)],
      });

      let filtered = taskList;
      if (status) {
        filtered = filtered.filter((t) => t.status === status);
      }
      if (assignedTo) {
        filtered = filtered.filter((t) => t.assignedTo === assignedTo);
      }
      if (isChore !== undefined) {
        filtered = filtered.filter((t) => t.isChore === (isChore === 'true'));
      }

      return { success: true, data: { tasks: filtered } };
    }
  );

  // Create task
  app.post(
    '/',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createTaskSchema.parse(request.body);

      const [task] = await db
        .insert(tasks)
        .values({
          householdId: request.user!.householdId,
          createdBy: request.user!.id,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          recurrenceRule: input.recurrenceRule,
          assignedTo: input.assignedTo,
          isChore: input.isChore,
          rewardPoints: input.rewardPoints,
        })
        .returning();

      return { success: true, data: { task } };
    }
  );

  // Get task by ID
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const task = await db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, request.params.id),
          eq(tasks.householdId, request.user!.householdId)
        ),
      });

      if (!task) throw Errors.notFound('Task');

      return { success: true, data: { task } };
    }
  );

  // Update task
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = updateTaskSchema.parse(request.body);

      const [updated] = await db
        .update(tasks)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, request.params.id),
            eq(tasks.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Task');

      return { success: true, data: { task: updated } };
    }
  );

  // Delete task
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(tasks)
        .where(
          and(
            eq(tasks.id, request.params.id),
            eq(tasks.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Task deleted' } };
    }
  );

  // Complete task
  app.post<{ Params: { id: string } }>(
    '/:id/complete',
    { preHandler: [authMiddleware] },
    async (request) => {
      const task = await db.query.tasks.findFirst({
        where: and(
          eq(tasks.id, request.params.id),
          eq(tasks.householdId, request.user!.householdId)
        ),
      });

      if (!task) throw Errors.notFound('Task');

      // Update task status
      const [updated] = await db
        .update(tasks)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(tasks.id, request.params.id))
        .returning();

      // Award points if it's a chore with points
      if (task.isChore && task.rewardPoints > 0 && task.assignedTo) {
        let userReward = await db.query.rewards.findFirst({
          where: and(
            eq(rewards.householdId, request.user!.householdId),
            eq(rewards.userId, task.assignedTo)
          ),
        });

        if (!userReward) {
          [userReward] = await db
            .insert(rewards)
            .values({
              householdId: request.user!.householdId,
              userId: task.assignedTo,
              points: 0,
              lifetimePoints: 0,
            })
            .returning();
        }

        // Add points
        await db
          .update(rewards)
          .set({
            points: userReward.points + task.rewardPoints,
            lifetimePoints: userReward.lifetimePoints + task.rewardPoints,
            updatedAt: new Date(),
          })
          .where(eq(rewards.id, userReward.id));

        // Record history
        await db.insert(rewardHistory).values({
          rewardId: userReward.id,
          taskId: task.id,
          pointsChange: task.rewardPoints,
          reason: `Completed chore: ${task.title}`,
        });
      }

      return { success: true, data: { task: updated } };
    }
  );

  // Assign task
  app.post<{ Params: { id: string } }>(
    '/:id/assign',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(request.body);

      const [updated] = await db
        .update(tasks)
        .set({ assignedTo: userId, updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, request.params.id),
            eq(tasks.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Task');

      return { success: true, data: { task: updated } };
    }
  );

  // Get chore schedule
  app.get(
    '/chores',
    { preHandler: [authMiddleware] },
    async (request) => {
      const chores = await db.query.tasks.findMany({
        where: and(
          eq(tasks.householdId, request.user!.householdId),
          eq(tasks.isChore, true)
        ),
        orderBy: (t, { asc }) => [asc(t.dueDate)],
      });

      return { success: true, data: { chores } };
    }
  );

  // ===== REWARDS =====

  app.get(
    '/rewards',
    { preHandler: [authMiddleware] },
    async (request) => {
      const rewardsList = await db.query.rewards.findMany({
        where: eq(rewards.householdId, request.user!.householdId),
      });

      return { success: true, data: { rewards: rewardsList } };
    }
  );

  app.get<{ Params: { userId: string } }>(
    '/rewards/:userId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const reward = await db.query.rewards.findFirst({
        where: and(
          eq(rewards.householdId, request.user!.householdId),
          eq(rewards.userId, request.params.userId)
        ),
      });

      return { success: true, data: { reward: reward || { points: 0, lifetimePoints: 0 } } };
    }
  );

  app.get<{ Params: { userId: string } }>(
    '/rewards/:userId/history',
    { preHandler: [authMiddleware] },
    async (request) => {
      const reward = await db.query.rewards.findFirst({
        where: and(
          eq(rewards.householdId, request.user!.householdId),
          eq(rewards.userId, request.params.userId)
        ),
      });

      if (!reward) {
        return { success: true, data: { history: [] } };
      }

      const history = await db.query.rewardHistory.findMany({
        where: eq(rewardHistory.rewardId, reward.id),
        orderBy: (h, { desc }) => [desc(h.createdAt)],
      });

      return { success: true, data: { history } };
    }
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

      let reward = await db.query.rewards.findFirst({
        where: and(
          eq(rewards.householdId, request.user!.householdId),
          eq(rewards.userId, request.params.userId)
        ),
      });

      if (!reward) {
        [reward] = await db
          .insert(rewards)
          .values({
            householdId: request.user!.householdId,
            userId: request.params.userId,
            points: 0,
            lifetimePoints: 0,
          })
          .returning();
      }

      const newPoints = Math.max(0, reward.points + points);
      const newLifetime = points > 0 ? reward.lifetimePoints + points : reward.lifetimePoints;

      await db
        .update(rewards)
        .set({ points: newPoints, lifetimePoints: newLifetime, updatedAt: new Date() })
        .where(eq(rewards.id, reward.id));

      await db.insert(rewardHistory).values({
        rewardId: reward.id,
        pointsChange: points,
        reason,
      });

      return { success: true, data: { points: newPoints, lifetimePoints: newLifetime } };
    }
  );

  // ===== ACHIEVEMENTS =====

  app.get(
    '/achievements',
    { preHandler: [authMiddleware] },
    async (request) => {
      const achievementList = await db.query.achievements.findMany({
        where: eq(achievements.householdId, request.user!.householdId),
      });

      return { success: true, data: { achievements: achievementList } };
    }
  );

  app.post(
    '/achievements',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = createAchievementSchema.parse(request.body);

      const [achievement] = await db
        .insert(achievements)
        .values({
          householdId: request.user!.householdId,
          createdBy: request.user!.id,
          name: input.name,
          description: input.description,
          icon: input.icon,
          points: input.points,
          criteriaType: input.criteriaType,
          criteria: input.criteria,
        })
        .returning();

      return { success: true, data: { achievement } };
    }
  );

  app.get<{ Params: { userId: string } }>(
    '/users/:userId/achievements',
    { preHandler: [authMiddleware] },
    async (request) => {
      const earned = await db.query.userAchievements.findMany({
        where: eq(userAchievements.userId, request.params.userId),
        with: { achievement: true },
      });

      return { success: true, data: { achievements: earned } };
    }
  );

  app.post<{ Params: { userId: string } }>(
    '/users/:userId/achievements',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const { achievementId, notes } = z
        .object({
          achievementId: z.string().uuid(),
          notes: z.string().optional(),
        })
        .parse(request.body);

      const [awarded] = await db
        .insert(userAchievements)
        .values({
          userId: request.params.userId,
          achievementId,
          awardedBy: request.user!.id,
          notes,
        })
        .returning();

      // Award points if achievement has any
      const achievement = await db.query.achievements.findFirst({
        where: eq(achievements.id, achievementId),
      });

      if (achievement && achievement.points > 0) {
        let reward = await db.query.rewards.findFirst({
          where: and(
            eq(rewards.householdId, request.user!.householdId),
            eq(rewards.userId, request.params.userId)
          ),
        });

        if (!reward) {
          [reward] = await db
            .insert(rewards)
            .values({
              householdId: request.user!.householdId,
              userId: request.params.userId,
              points: 0,
              lifetimePoints: 0,
            })
            .returning();
        }

        await db
          .update(rewards)
          .set({
            points: reward.points + achievement.points,
            lifetimePoints: reward.lifetimePoints + achievement.points,
            updatedAt: new Date(),
          })
          .where(eq(rewards.id, reward.id));

        await db.insert(rewardHistory).values({
          rewardId: reward.id,
          pointsChange: achievement.points,
          reason: `Achievement: ${achievement.name}`,
        });
      }

      return { success: true, data: { awarded } };
    }
  );
}

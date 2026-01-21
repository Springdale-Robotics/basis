import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { users, userSettings } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { changePassword } from '../auth/auth.service.js';
import argon2 from 'argon2';

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

const updateSettingsSchema = z.object({
  theme: z.string().optional(),
  hiddenPages: z.array(z.string()).optional(),
  notificationPreferences: z.record(z.unknown()).optional(),
  calendarDefaultView: z.string().optional(),
  accentColor: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  // Get user by ID
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.id, request.params.id),
          eq(users.householdId, request.user!.householdId)
        ),
        columns: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          avatarUrl: true,
          createdAt: true,
        },
      });

      if (!user) {
        throw Errors.notFound('User');
      }

      return { success: true, data: { user } };
    }
  );

  // Update user profile
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Can only update own profile unless admin
      if (request.params.id !== request.user!.id && request.user!.role !== 'admin') {
        throw Errors.forbidden();
      }

      const input = updateUserSchema.parse(request.body);

      const [updated] = await db
        .update(users)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(users.id, request.params.id),
            eq(users.householdId, request.user!.householdId)
          )
        )
        .returning({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          avatarUrl: users.avatarUrl,
        });

      if (!updated) {
        throw Errors.notFound('User');
      }

      return { success: true, data: { user: updated } };
    }
  );

  // Change password
  app.patch<{ Params: { id: string } }>(
    '/:id/password',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Can only change own password
      if (request.params.id !== request.user!.id) {
        throw Errors.forbidden();
      }

      const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);
      await changePassword(request.user!.id, currentPassword, newPassword);

      return { success: true, data: { message: 'Password updated' } };
    }
  );

  // Get user settings
  app.get<{ Params: { id: string } }>(
    '/:id/settings',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Can only view own settings unless admin
      if (request.params.id !== request.user!.id && request.user!.role !== 'admin') {
        throw Errors.forbidden();
      }

      let settings = await db.query.userSettings.findFirst({
        where: eq(userSettings.userId, request.params.id),
      });

      // Create default settings if not exist
      if (!settings) {
        [settings] = await db
          .insert(userSettings)
          .values({
            userId: request.params.id,
            theme: 'system',
            hiddenPages: [],
            calendarDefaultView: 'month',
          })
          .returning();
      }

      return { success: true, data: { settings } };
    }
  );

  // Update user settings
  app.patch<{ Params: { id: string } }>(
    '/:id/settings',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Can only update own settings
      if (request.params.id !== request.user!.id) {
        throw Errors.forbidden();
      }

      const input = updateSettingsSchema.parse(request.body);

      // Upsert settings
      const existing = await db.query.userSettings.findFirst({
        where: eq(userSettings.userId, request.params.id),
      });

      let settings;
      if (existing) {
        [settings] = await db
          .update(userSettings)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(userSettings.userId, request.params.id))
          .returning();
      } else {
        [settings] = await db
          .insert(userSettings)
          .values({
            userId: request.params.id,
            ...input,
          })
          .returning();
      }

      return { success: true, data: { settings } };
    }
  );
}

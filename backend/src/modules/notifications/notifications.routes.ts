import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { notifications, userSettings } from '../../db/schema/index.js';
import { eq, and, isNull, or } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  // Get notifications for current user
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { unreadOnly = 'false' } = request.query as any;

      const conditions = [
        eq(notifications.householdId, request.user!.householdId),
        or(
          eq(notifications.userId, request.user!.id),
          isNull(notifications.userId)
        ),
      ];

      if (unreadOnly === 'true') {
        conditions.push(isNull(notifications.readAt));
      }

      const notificationList = await db.query.notifications.findMany({
        where: and(...conditions),
        orderBy: (n, { desc }) => [desc(n.createdAt)],
        limit: 50,
      });

      return { success: true, data: { notifications: notificationList } };
    }
  );

  // Mark notification as read
  app.patch<{ Params: { id: string } }>(
    '/:id/read',
    { preHandler: [authMiddleware] },
    async (request) => {
      const [updated] = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, request.params.id),
            eq(notifications.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Notification');

      return { success: true, data: { notification: updated } };
    }
  );

  // Mark all as read
  app.post(
    '/read-all',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.householdId, request.user!.householdId),
            or(
              eq(notifications.userId, request.user!.id),
              isNull(notifications.userId)
            ),
            isNull(notifications.readAt)
          )
        );

      return { success: true, data: { message: 'All notifications marked as read' } };
    }
  );

  // Delete notification
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.id, request.params.id),
            eq(notifications.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Notification deleted' } };
    }
  );

  // Get unread notification count
  app.get(
    '/unread-count',
    { preHandler: [authMiddleware] },
    async (request) => {
      const result = await db.query.notifications.findMany({
        where: and(
          eq(notifications.householdId, request.user!.householdId),
          or(
            eq(notifications.userId, request.user!.id),
            isNull(notifications.userId)
          ),
          isNull(notifications.readAt)
        ),
        columns: { id: true },
      });

      return { success: true, data: { count: result.length } };
    }
  );

  // Get notification preferences
  app.get(
    '/settings',
    { preHandler: [authMiddleware] },
    async (request) => {
      const settings = await db.query.userSettings.findFirst({
        where: eq(userSettings.userId, request.user!.id),
        columns: { notificationPreferences: true },
      });

      const preferences = settings?.notificationPreferences || {
        lowStock: true,
        expiringSoon: true,
        taskDue: true,
        syncErrors: true,
        pushEnabled: false,
        emailEnabled: false,
      };

      return { success: true, data: { preferences } };
    }
  );

  // Update notification preferences
  app.patch(
    '/settings',
    { preHandler: [authMiddleware] },
    async (request) => {
      const preferences = z
        .object({
          lowStock: z.boolean().optional(),
          expiringSoon: z.boolean().optional(),
          taskDue: z.boolean().optional(),
          syncErrors: z.boolean().optional(),
          pushEnabled: z.boolean().optional(),
          emailEnabled: z.boolean().optional(),
          quietHoursStart: z.string().optional(),
          quietHoursEnd: z.string().optional(),
        })
        .parse(request.body);

      // Get existing settings
      const existing = await db.query.userSettings.findFirst({
        where: eq(userSettings.userId, request.user!.id),
      });

      const currentPrefs = (existing?.notificationPreferences as any) || {};
      const newPrefs = { ...currentPrefs, ...preferences };

      if (existing) {
        await db
          .update(userSettings)
          .set({ notificationPreferences: newPrefs, updatedAt: new Date() })
          .where(eq(userSettings.userId, request.user!.id));
      } else {
        await db.insert(userSettings).values({
          userId: request.user!.id,
          notificationPreferences: newPrefs,
        });
      }

      return { success: true, data: { preferences: newPrefs } };
    }
  );

  // Execute notification action
  app.post<{ Params: { id: string } }>(
    '/:id/action',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { actionId } = z.object({ actionId: z.string() }).parse(request.body);

      const notification = await db.query.notifications.findFirst({
        where: eq(notifications.id, request.params.id),
      });

      if (!notification) throw Errors.notFound('Notification');

      const data = notification.data as any;
      const actions = data?.actions || [];
      const action = actions.find((a: any) => a.id === actionId);

      if (!action) throw Errors.notFound('Action');

      // Mark notification as read
      await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(eq(notifications.id, request.params.id));

      // Return the action endpoint for the client to call
      return {
        success: true,
        data: {
          message: 'Action executed',
          endpoint: action.endpoint,
        },
      };
    }
  );
}

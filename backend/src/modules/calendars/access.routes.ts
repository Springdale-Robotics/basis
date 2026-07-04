import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { calendars } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import {
  listAccessRules,
  upsertAccessRule,
  deleteAccessRule,
} from './access.service.js';

const upsertAccessBody = z.object({
  principalType: z.enum(['user', 'group', 'role']),
  principalId: z.string().min(1),
  permissionLevel: z.enum(['view_busy', 'view', 'edit']),
});

async function requireHouseholdCalendar(calendarId: string, householdId: string) {
  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, calendarId), eq(calendars.householdId, householdId)),
  });
  if (!calendar) {
    throw Errors.notFound('Calendar');
  }
  return calendar;
}

/**
 * Intra-household calendar access rules (per-user / per-group / per-role).
 * The service layer already enforces these on reads via getEffectivePermission;
 * these routes expose rule management to the frontend.
 */
export async function calendarAccessRoutes(app: FastifyInstance): Promise<void> {
  // List access rules for a calendar
  app.get<{ Params: { id: string } }>(
    '/:id/access',
    { preHandler: [authMiddleware] },
    async (request) => {
      await requireHouseholdCalendar(request.params.id, request.user!.householdId);
      const rules = await listAccessRules(request.params.id);
      return { success: true, data: { rules } };
    }
  );

  // Create or update an access rule
  app.put<{ Params: { id: string } }>(
    '/:id/access',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await requireHouseholdCalendar(request.params.id, request.user!.householdId);
      const body = upsertAccessBody.parse(request.body);
      const rule = await upsertAccessRule(
        request.params.id,
        body.principalType,
        body.principalId,
        body.permissionLevel
      );
      return { success: true, data: { rule } };
    }
  );

  // Delete an access rule
  app.delete<{ Params: { id: string; ruleId: string } }>(
    '/:id/access/:ruleId',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await requireHouseholdCalendar(request.params.id, request.user!.householdId);
      const deleted = await deleteAccessRule(request.params.id, request.params.ruleId);
      if (!deleted) {
        throw Errors.notFound('Access rule');
      }
      return { success: true, data: { message: 'Access rule deleted' } };
    }
  );
}

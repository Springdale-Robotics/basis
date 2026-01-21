import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import {
  calendars,
  sharedResources,
  connectedHouseholds,
} from '../../db/schema/index.js';
import { eq, and, or, inArray } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { emitHouseholdEvent } from '../../websocket/events.js';
import { logger } from '../../lib/logger.js';

// Permission levels for calendar sharing (RFC 5545 aligned)
const permissionLevelSchema = z.enum(['view_busy', 'view', 'edit']);
type PermissionLevel = z.infer<typeof permissionLevelSchema>;

const shareCalendarSchema = z.object({
  householdId: z.string().uuid(),
  permissionLevel: permissionLevelSchema,
});

const updateShareSchema = z.object({
  permissionLevel: permissionLevelSchema,
});

export async function calendarSharingRoutes(app: FastifyInstance): Promise<void> {
  // Share calendar with a connected household
  app.post<{ Params: { id: string } }>(
    '/:id/share',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = shareCalendarSchema.parse(request.body);
      const { id: calendarId } = request.params;

      // Verify calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      // Verify the target household is connected to ours
      const connection = await db.query.connectedHouseholds.findFirst({
        where: and(
          eq(connectedHouseholds.localHouseholdId, request.user!.householdId),
          eq(connectedHouseholds.remoteHouseholdId, input.householdId),
          eq(connectedHouseholds.status, 'active')
        ),
      });

      if (!connection) {
        throw Errors.forbidden('Cannot share with unconnected household');
      }

      // Check if already shared
      const existingShare = await db.query.sharedResources.findFirst({
        where: and(
          eq(sharedResources.householdId, request.user!.householdId),
          eq(sharedResources.resourceType, 'calendar'),
          eq(sharedResources.resourceId, calendarId),
          eq(sharedResources.sharedWithHouseholdId, input.householdId)
        ),
      });

      if (existingShare) {
        throw Errors.conflict('Calendar already shared with this household');
      }

      // Create the share
      const [share] = await db
        .insert(sharedResources)
        .values({
          householdId: request.user!.householdId,
          resourceType: 'calendar',
          resourceId: calendarId,
          sharedWithHouseholdId: input.householdId,
          permissionLevel: input.permissionLevel,
          createdBy: request.user!.id,
        })
        .returning();

      // Emit events
      emitHouseholdEvent(request.user!.householdId, 'calendar:shared', {
        calendarId,
        calendarName: calendar.name,
        sharedWithHouseholdId: input.householdId,
        sharedWithHouseholdName: connection.remoteHouseholdName,
        permissionLevel: input.permissionLevel,
      });

      emitHouseholdEvent(input.householdId, 'calendar:shared_with_you', {
        calendarId,
        calendarName: calendar.name,
        fromHouseholdId: request.user!.householdId,
        permissionLevel: input.permissionLevel,
      });

      logger.info(
        { calendarId, sharedWith: input.householdId },
        'Calendar shared'
      );

      return {
        success: true,
        data: {
          share: {
            id: share.id,
            calendarId,
            householdId: input.householdId,
            householdName: connection.remoteHouseholdName,
            permissionLevel: input.permissionLevel,
          },
        },
      };
    }
  );

  // Get all shares for a calendar
  app.get<{ Params: { id: string } }>(
    '/:id/shares',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { id: calendarId } = request.params;

      // Verify calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      // Get all shares for this calendar
      const shares = await db.query.sharedResources.findMany({
        where: and(
          eq(sharedResources.householdId, request.user!.householdId),
          eq(sharedResources.resourceType, 'calendar'),
          eq(sharedResources.resourceId, calendarId)
        ),
      });

      // Get household names for the shares
      const householdIds = shares.map((s) => s.sharedWithHouseholdId);
      const connections = householdIds.length > 0
        ? await db.query.connectedHouseholds.findMany({
            where: and(
              eq(connectedHouseholds.localHouseholdId, request.user!.householdId),
              inArray(connectedHouseholds.remoteHouseholdId, householdIds)
            ),
          })
        : [];

      const householdNameMap = new Map(
        connections.map((c) => [c.remoteHouseholdId, c.remoteHouseholdName])
      );

      const enrichedShares = shares.map((share) => ({
        id: share.id,
        householdId: share.sharedWithHouseholdId,
        householdName: householdNameMap.get(share.sharedWithHouseholdId) || 'Unknown',
        permissionLevel: share.permissionLevel,
        createdAt: share.createdAt,
      }));

      return {
        success: true,
        data: { shares: enrichedShares },
      };
    }
  );

  // Update share permission level
  app.patch<{ Params: { id: string; shareId: string } }>(
    '/:id/shares/:shareId',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = updateShareSchema.parse(request.body);
      const { id: calendarId, shareId } = request.params;

      // Verify calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      // Update the share
      const [updated] = await db
        .update(sharedResources)
        .set({ permissionLevel: input.permissionLevel })
        .where(
          and(
            eq(sharedResources.id, shareId),
            eq(sharedResources.householdId, request.user!.householdId),
            eq(sharedResources.resourceId, calendarId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Share');
      }

      return {
        success: true,
        data: {
          share: {
            id: updated.id,
            permissionLevel: updated.permissionLevel,
          },
        },
      };
    }
  );

  // Remove share
  app.delete<{ Params: { id: string; shareId: string } }>(
    '/:id/shares/:shareId',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { id: calendarId, shareId } = request.params;

      // Verify calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      // Get the share first for the event
      const share = await db.query.sharedResources.findFirst({
        where: and(
          eq(sharedResources.id, shareId),
          eq(sharedResources.householdId, request.user!.householdId),
          eq(sharedResources.resourceId, calendarId)
        ),
      });

      if (!share) {
        throw Errors.notFound('Share');
      }

      // Delete the share
      await db
        .delete(sharedResources)
        .where(eq(sharedResources.id, shareId));

      // Emit event to both households
      emitHouseholdEvent(request.user!.householdId, 'calendar:unshared', {
        calendarId,
        calendarName: calendar.name,
        householdId: share.sharedWithHouseholdId,
      });

      emitHouseholdEvent(share.sharedWithHouseholdId, 'calendar:unshared', {
        calendarId,
        calendarName: calendar.name,
        fromHouseholdId: request.user!.householdId,
      });

      return {
        success: true,
        data: { message: 'Share removed' },
      };
    }
  );

  // Get calendars shared with me
  app.get(
    '/shared-with-me',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Get all calendars shared with this household
      const shares = await db.query.sharedResources.findMany({
        where: and(
          eq(sharedResources.sharedWithHouseholdId, request.user!.householdId),
          eq(sharedResources.resourceType, 'calendar')
        ),
      });

      if (shares.length === 0) {
        return { success: true, data: { calendars: [] } };
      }

      // Get the actual calendars
      const calendarIds = shares.map((s) => s.resourceId);
      const sharedCalendars = await db.query.calendars.findMany({
        where: inArray(calendars.id, calendarIds),
      });

      // Get source household names from connections
      const sourceHouseholdIds = shares.map((s) => s.householdId);
      const connections = await db.query.connectedHouseholds.findMany({
        where: and(
          eq(connectedHouseholds.localHouseholdId, request.user!.householdId),
          inArray(connectedHouseholds.remoteHouseholdId, sourceHouseholdIds)
        ),
      });

      const householdNameMap = new Map(
        connections.map((c) => [c.remoteHouseholdId, c.remoteHouseholdName])
      );

      const shareMap = new Map(
        shares.map((s) => [s.resourceId, s])
      );

      const enrichedCalendars = sharedCalendars.map((cal) => {
        const share = shareMap.get(cal.id);
        return {
          ...cal,
          isShared: true,
          sharedBy: {
            householdId: share?.householdId,
            householdName: householdNameMap.get(share?.householdId || '') || 'Unknown',
          },
          permissionLevel: share?.permissionLevel || 'view',
        };
      });

      return {
        success: true,
        data: { calendars: enrichedCalendars },
      };
    }
  );

  // Get connected households for sharing
  app.get(
    '/sharing/households',
    { preHandler: [authMiddleware] },
    async (request) => {
      const connections = await db.query.connectedHouseholds.findMany({
        where: and(
          eq(connectedHouseholds.localHouseholdId, request.user!.householdId),
          eq(connectedHouseholds.status, 'active')
        ),
      });

      const connectedHouseholdsData = connections.map((c) => ({
        id: c.remoteHouseholdId,
        name: c.remoteHouseholdName,
      }));

      return {
        success: true,
        data: { households: connectedHouseholdsData },
      };
    }
  );
}

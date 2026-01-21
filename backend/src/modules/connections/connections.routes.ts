import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import {
  connectedHouseholds,
  connectionInvites,
  sharedResources,
  syncQueue,
  households,
} from '../../db/schema/index.js';
import { eq, and, or, desc } from 'drizzle-orm';
import { authMiddleware, requireAdmin, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { randomBytes } from 'crypto';

const createInviteSchema = z.object({
  nickname: z.string().min(1).max(255).optional(),
  permissions: z.array(z.enum(['view_calendar', 'edit_calendar', 'view_recipes', 'share_recipes', 'view_inventory'])).default([]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

const shareResourceSchema = z.object({
  resourceType: z.enum(['calendar', 'event', 'recipe', 'inventory_item', 'list']),
  resourceId: z.string().uuid(),
  targetHouseholdId: z.string().uuid(),
  permissions: z.array(z.enum(['view', 'edit', 'delete'])).default(['view']),
});

const updateConnectionSchema = z.object({
  nickname: z.string().min(1).max(255).optional(),
  permissions: z.array(z.string()).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

export async function connectionsRoutes(app: FastifyInstance): Promise<void> {
  // ===== CONNECTION INVITES =====

  // List pending invites (both sent and received)
  app.get(
    '/invites',
    { preHandler: [authMiddleware] },
    async (request) => {
      const sent = await db.query.connectionInvites.findMany({
        where: and(
          eq(connectionInvites.fromHouseholdId, request.user!.householdId),
          eq(connectionInvites.status, 'pending')
        ),
        orderBy: [desc(connectionInvites.createdAt)],
      });

      const received = await db.query.connectionInvites.findMany({
        where: and(
          eq(connectionInvites.toHouseholdId, request.user!.householdId),
          eq(connectionInvites.status, 'pending')
        ),
        orderBy: [desc(connectionInvites.createdAt)],
      });

      return { success: true, data: { sent, received } };
    }
  );

  // Create connection invite
  app.post(
    '/invites',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = createInviteSchema.parse(request.body);

      // Generate unique invite code
      const inviteCode = randomBytes(16).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + input.expiresInDays);

      const [invite] = await db
        .insert(connectionInvites)
        .values({
          fromHouseholdId: request.user!.householdId,
          inviteCode,
          nickname: input.nickname,
          permissions: input.permissions,
          expiresAt,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { invite, inviteCode } };
    }
  );

  // Accept invite by code
  app.post(
    '/invites/accept',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const { inviteCode, nickname } = z
        .object({
          inviteCode: z.string().min(1),
          nickname: z.string().min(1).max(255).optional(),
        })
        .parse(request.body);

      const invite = await db.query.connectionInvites.findFirst({
        where: and(
          eq(connectionInvites.inviteCode, inviteCode),
          eq(connectionInvites.status, 'pending')
        ),
      });

      if (!invite) throw Errors.notFound('Invite');

      if (invite.expiresAt < new Date()) {
        throw Errors.validation('Invite has expired');
      }

      if (invite.fromHouseholdId === request.user!.householdId) {
        throw Errors.validation('Cannot accept your own invite');
      }

      // Check if already connected
      const existing = await db.query.connectedHouseholds.findFirst({
        where: or(
          and(
            eq(connectedHouseholds.householdId, request.user!.householdId),
            eq(connectedHouseholds.connectedHouseholdId, invite.fromHouseholdId)
          ),
          and(
            eq(connectedHouseholds.householdId, invite.fromHouseholdId),
            eq(connectedHouseholds.connectedHouseholdId, request.user!.householdId)
          )
        ),
      });

      if (existing) {
        throw Errors.duplicate('Connection');
      }

      // Get household names for nicknames
      const fromHousehold = await db.query.households.findFirst({
        where: eq(households.id, invite.fromHouseholdId),
        columns: { name: true },
      });

      const toHousehold = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
        columns: { name: true },
      });

      // Create bidirectional connection
      await db.insert(connectedHouseholds).values([
        {
          householdId: invite.fromHouseholdId,
          connectedHouseholdId: request.user!.householdId,
          nickname: nickname || toHousehold?.name || 'Connected Household',
          permissions: invite.permissions,
          status: 'active',
        },
        {
          householdId: request.user!.householdId,
          connectedHouseholdId: invite.fromHouseholdId,
          nickname: invite.nickname || fromHousehold?.name || 'Connected Household',
          permissions: invite.permissions,
          status: 'active',
        },
      ]);

      // Update invite to set toHouseholdId and mark as accepted
      await db
        .update(connectionInvites)
        .set({
          toHouseholdId: request.user!.householdId,
          status: 'accepted',
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(connectionInvites.id, invite.id));

      return { success: true, data: { message: 'Connection established' } };
    }
  );

  // Decline invite
  app.post<{ Params: { id: string } }>(
    '/invites/:id/decline',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const [updated] = await db
        .update(connectionInvites)
        .set({ status: 'declined', updatedAt: new Date() })
        .where(
          and(
            eq(connectionInvites.id, request.params.id),
            eq(connectionInvites.toHouseholdId, request.user!.householdId),
            eq(connectionInvites.status, 'pending')
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Invite');

      return { success: true, data: { message: 'Invite declined' } };
    }
  );

  // Revoke sent invite
  app.delete<{ Params: { id: string } }>(
    '/invites/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .delete(connectionInvites)
        .where(
          and(
            eq(connectionInvites.id, request.params.id),
            eq(connectionInvites.fromHouseholdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Invite revoked' } };
    }
  );

  // ===== CONNECTED HOUSEHOLDS =====

  // List connected households
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const connections = await db.query.connectedHouseholds.findMany({
        where: eq(connectedHouseholds.householdId, request.user!.householdId),
      });

      // Get household details for each connection
      const enrichedConnections = await Promise.all(
        connections.map(async (conn) => {
          const household = await db.query.households.findFirst({
            where: eq(households.id, conn.connectedHouseholdId),
            columns: { id: true, name: true },
          });
          return { ...conn, household };
        })
      );

      return { success: true, data: { connections: enrichedConnections } };
    }
  );

  // Get connection details
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const connection = await db.query.connectedHouseholds.findFirst({
        where: and(
          eq(connectedHouseholds.id, request.params.id),
          eq(connectedHouseholds.householdId, request.user!.householdId)
        ),
      });

      if (!connection) throw Errors.notFound('Connection');

      const household = await db.query.households.findFirst({
        where: eq(households.id, connection.connectedHouseholdId),
        columns: { id: true, name: true },
      });

      // Get shared resources
      const shared = await db.query.sharedResources.findMany({
        where: and(
          eq(sharedResources.fromHouseholdId, request.user!.householdId),
          eq(sharedResources.toHouseholdId, connection.connectedHouseholdId)
        ),
      });

      const receivedShares = await db.query.sharedResources.findMany({
        where: and(
          eq(sharedResources.fromHouseholdId, connection.connectedHouseholdId),
          eq(sharedResources.toHouseholdId, request.user!.householdId)
        ),
      });

      return {
        success: true,
        data: {
          connection: { ...connection, household },
          sharedWithThem: shared,
          sharedWithUs: receivedShares,
        },
      };
    }
  );

  // Update connection
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = updateConnectionSchema.parse(request.body);

      const [updated] = await db
        .update(connectedHouseholds)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(connectedHouseholds.id, request.params.id),
            eq(connectedHouseholds.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Connection');

      return { success: true, data: { connection: updated } };
    }
  );

  // Remove connection (bidirectional)
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const connection = await db.query.connectedHouseholds.findFirst({
        where: and(
          eq(connectedHouseholds.id, request.params.id),
          eq(connectedHouseholds.householdId, request.user!.householdId)
        ),
      });

      if (!connection) throw Errors.notFound('Connection');

      // Delete both directions
      await db
        .delete(connectedHouseholds)
        .where(
          or(
            and(
              eq(connectedHouseholds.householdId, request.user!.householdId),
              eq(connectedHouseholds.connectedHouseholdId, connection.connectedHouseholdId)
            ),
            and(
              eq(connectedHouseholds.householdId, connection.connectedHouseholdId),
              eq(connectedHouseholds.connectedHouseholdId, request.user!.householdId)
            )
          )
        );

      // Delete all shared resources
      await db
        .delete(sharedResources)
        .where(
          or(
            and(
              eq(sharedResources.fromHouseholdId, request.user!.householdId),
              eq(sharedResources.toHouseholdId, connection.connectedHouseholdId)
            ),
            and(
              eq(sharedResources.fromHouseholdId, connection.connectedHouseholdId),
              eq(sharedResources.toHouseholdId, request.user!.householdId)
            )
          )
        );

      return { success: true, data: { message: 'Connection removed' } };
    }
  );

  // ===== SHARED RESOURCES =====

  // Share a resource
  app.post(
    '/share',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = shareResourceSchema.parse(request.body);

      // Verify connection exists
      const connection = await db.query.connectedHouseholds.findFirst({
        where: and(
          eq(connectedHouseholds.householdId, request.user!.householdId),
          eq(connectedHouseholds.connectedHouseholdId, input.targetHouseholdId),
          eq(connectedHouseholds.status, 'active')
        ),
      });

      if (!connection) {
        throw Errors.forbidden('Not connected to target household');
      }

      // Check if already shared
      const existing = await db.query.sharedResources.findFirst({
        where: and(
          eq(sharedResources.resourceType, input.resourceType),
          eq(sharedResources.resourceId, input.resourceId),
          eq(sharedResources.toHouseholdId, input.targetHouseholdId)
        ),
      });

      if (existing) {
        // Update permissions
        const [updated] = await db
          .update(sharedResources)
          .set({ permissions: input.permissions, updatedAt: new Date() })
          .where(eq(sharedResources.id, existing.id))
          .returning();

        return { success: true, data: { sharedResource: updated } };
      }

      const [shared] = await db
        .insert(sharedResources)
        .values({
          fromHouseholdId: request.user!.householdId,
          toHouseholdId: input.targetHouseholdId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          permissions: input.permissions,
          sharedBy: request.user!.id,
        })
        .returning();

      // Queue sync task
      await db.insert(syncQueue).values({
        fromHouseholdId: request.user!.householdId,
        toHouseholdId: input.targetHouseholdId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        operation: 'share',
      });

      return { success: true, data: { sharedResource: shared } };
    }
  );

  // Unshare a resource
  app.delete<{ Params: { id: string } }>(
    '/share/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(sharedResources)
        .where(
          and(
            eq(sharedResources.id, request.params.id),
            eq(sharedResources.fromHouseholdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Resource unshared' } };
    }
  );

  // List resources shared with us
  app.get(
    '/shared-with-me',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { resourceType } = request.query as any;

      const conditions = [eq(sharedResources.toHouseholdId, request.user!.householdId)];

      const shared = await db.query.sharedResources.findMany({
        where: and(...conditions),
        orderBy: [desc(sharedResources.createdAt)],
      });

      let filtered = shared;
      if (resourceType) {
        filtered = filtered.filter((s) => s.resourceType === resourceType);
      }

      return { success: true, data: { sharedResources: filtered } };
    }
  );

  // List resources we've shared
  app.get(
    '/shared-by-me',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { resourceType } = request.query as any;

      const conditions = [eq(sharedResources.fromHouseholdId, request.user!.householdId)];

      const shared = await db.query.sharedResources.findMany({
        where: and(...conditions),
        orderBy: [desc(sharedResources.createdAt)],
      });

      let filtered = shared;
      if (resourceType) {
        filtered = filtered.filter((s) => s.resourceType === resourceType);
      }

      return { success: true, data: { sharedResources: filtered } };
    }
  );

  // ===== SYNC =====

  // Get sync status
  app.get(
    '/sync/status',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const pending = await db.query.syncQueue.findMany({
        where: and(
          or(
            eq(syncQueue.fromHouseholdId, request.user!.householdId),
            eq(syncQueue.toHouseholdId, request.user!.householdId)
          ),
          eq(syncQueue.status, 'pending')
        ),
      });

      const failed = await db.query.syncQueue.findMany({
        where: and(
          or(
            eq(syncQueue.fromHouseholdId, request.user!.householdId),
            eq(syncQueue.toHouseholdId, request.user!.householdId)
          ),
          eq(syncQueue.status, 'failed')
        ),
      });

      return {
        success: true,
        data: {
          pendingCount: pending.length,
          failedCount: failed.length,
          pending,
          failed,
        },
      };
    }
  );

  // Retry failed sync
  app.post<{ Params: { id: string } }>(
    '/sync/:id/retry',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const [updated] = await db
        .update(syncQueue)
        .set({
          status: 'pending',
          retryCount: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(syncQueue.id, request.params.id),
            or(
              eq(syncQueue.fromHouseholdId, request.user!.householdId),
              eq(syncQueue.toHouseholdId, request.user!.householdId)
            )
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Sync task');

      return { success: true, data: { syncTask: updated } };
    }
  );

  // Force sync all
  app.post(
    '/sync/force',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      // Mark all failed items as pending for retry
      await db
        .update(syncQueue)
        .set({
          status: 'pending',
          retryCount: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            or(
              eq(syncQueue.fromHouseholdId, request.user!.householdId),
              eq(syncQueue.toHouseholdId, request.user!.householdId)
            ),
            eq(syncQueue.status, 'failed')
          )
        );

      return { success: true, data: { message: 'Sync retry queued' } };
    }
  );
}

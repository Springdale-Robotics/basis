import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { groups, groupMembers, users } from '../../db/schema/index.js';
import { eq, and, count } from 'drizzle-orm';
import { authMiddleware, requireMember, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';

const createGroupSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

const updateGroupSchema = createGroupSchema.partial();

const addMemberSchema = z.object({
  userId: z.string().uuid(),
});

export async function groupsRoutes(app: FastifyInstance): Promise<void> {
  // List all groups in the household
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const householdGroups = await db
        .select({
          id: groups.id,
          name: groups.name,
          description: groups.description,
          createdBy: groups.createdBy,
          createdAt: groups.createdAt,
          updatedAt: groups.updatedAt,
        })
        .from(groups)
        .where(eq(groups.householdId, request.user!.householdId));

      // Get member counts for each group
      const groupsWithCounts = await Promise.all(
        householdGroups.map(async (group) => {
          const [countResult] = await db
            .select({ count: count() })
            .from(groupMembers)
            .where(eq(groupMembers.groupId, group.id));

          return {
            ...group,
            memberCount: countResult?.count ?? 0,
          };
        })
      );

      return { success: true, data: { groups: groupsWithCounts } };
    }
  );

  // Create a new group
  app.post(
    '/',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createGroupSchema.parse(request.body);

      const [group] = await db
        .insert(groups)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          description: input.description,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { group: { ...group, memberCount: 0 } } };
    }
  );

  // Get a group with its members
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const group = await db.query.groups.findFirst({
        where: and(
          eq(groups.id, request.params.id),
          eq(groups.householdId, request.user!.householdId)
        ),
      });

      if (!group) {
        throw Errors.notFound('Group');
      }

      // Get members with user details
      const members = await db
        .select({
          id: groupMembers.id,
          userId: groupMembers.userId,
          memberType: groupMembers.memberType,
          addedAt: groupMembers.addedAt,
          user: {
            id: users.id,
            displayName: users.displayName,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(groupMembers)
        .innerJoin(users, eq(groupMembers.userId, users.id))
        .where(eq(groupMembers.groupId, request.params.id));

      return {
        success: true,
        data: {
          group: { ...group, memberCount: members.length },
          members,
        },
      };
    }
  );

  // Update a group
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = updateGroupSchema.parse(request.body);

      const [updated] = await db
        .update(groups)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(groups.id, request.params.id),
            eq(groups.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Group');
      }

      return { success: true, data: { group: updated } };
    }
  );

  // Delete a group
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const deleted = await db
        .delete(groups)
        .where(
          and(
            eq(groups.id, request.params.id),
            eq(groups.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (deleted.length === 0) {
        throw Errors.notFound('Group');
      }

      return { success: true, data: { message: 'Group deleted' } };
    }
  );

  // Add a member to a group
  app.post<{ Params: { id: string } }>(
    '/:id/members',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const { userId } = addMemberSchema.parse(request.body);

      // Verify the group exists and belongs to the household
      const group = await db.query.groups.findFirst({
        where: and(
          eq(groups.id, request.params.id),
          eq(groups.householdId, request.user!.householdId)
        ),
      });

      if (!group) {
        throw Errors.notFound('Group');
      }

      // Verify the user exists and belongs to the same household
      const user = await db.query.users.findFirst({
        where: and(
          eq(users.id, userId),
          eq(users.householdId, request.user!.householdId)
        ),
      });

      if (!user) {
        throw Errors.notFound('User');
      }

      // Check if already a member
      const existingMember = await db.query.groupMembers.findFirst({
        where: and(
          eq(groupMembers.groupId, request.params.id),
          eq(groupMembers.userId, userId)
        ),
      });

      if (existingMember) {
        throw Errors.conflict('User is already a member of this group');
      }

      const [member] = await db
        .insert(groupMembers)
        .values({
          groupId: request.params.id,
          userId,
          memberType: 'user',
        })
        .returning();

      return {
        success: true,
        data: {
          member: {
            ...member,
            user: {
              id: user.id,
              displayName: user.displayName,
              email: user.email,
              avatarUrl: user.avatarUrl,
            },
          },
        },
      };
    }
  );

  // Remove a member from a group
  app.delete<{ Params: { id: string; userId: string } }>(
    '/:id/members/:userId',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      // Verify the group exists and belongs to the household
      const group = await db.query.groups.findFirst({
        where: and(
          eq(groups.id, request.params.id),
          eq(groups.householdId, request.user!.householdId)
        ),
      });

      if (!group) {
        throw Errors.notFound('Group');
      }

      const deleted = await db
        .delete(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, request.params.id),
            eq(groupMembers.userId, request.params.userId)
          )
        )
        .returning();

      if (deleted.length === 0) {
        throw Errors.notFound('Member');
      }

      return { success: true, data: { message: 'Member removed from group' } };
    }
  );
}

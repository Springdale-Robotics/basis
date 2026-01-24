import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { households, users, memberInvites } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireAdmin, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { randomBytes } from 'crypto';
import { userRoleSchema } from '../../lib/validators.js';

const updateHouseholdSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  settings: z.record(z.unknown()).optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().email().optional(),
  role: userRoleSchema.default('member'),
  method: z.enum(['email', 'code']).default('code'),
});

export async function householdsRoutes(app: FastifyInstance): Promise<void> {
  // Get current household
  app.get(
    '/current',
    { preHandler: [authMiddleware] },
    async (request) => {
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
      });

      if (!household) {
        throw Errors.notFound('Household');
      }

      return { success: true, data: { household } };
    }
  );

  // Update household settings
  app.patch(
    '/current',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = updateHouseholdSchema.parse(request.body);

      const [updated] = await db
        .update(households)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(households.id, request.user!.householdId))
        .returning();

      return { success: true, data: { household: updated } };
    }
  );

  // List household members
  app.get(
    '/current/members',
    { preHandler: [authMiddleware] },
    async (request) => {
      const members = await db.query.users.findMany({
        where: eq(users.householdId, request.user!.householdId),
        columns: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          avatarUrl: true,
          createdAt: true,
        },
      });

      return { success: true, data: { members } };
    }
  );

  // Create member invite
  app.post(
    '/current/members/invite',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = inviteMemberSchema.parse(request.body);
      const inviteCode = randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const [invite] = await db
        .insert(memberInvites)
        .values({
          householdId: request.user!.householdId,
          email: input.email?.toLowerCase(),
          inviteCode,
          role: input.role,
          invitedBy: request.user!.id,
          expiresAt,
        })
        .returning();

      return {
        success: true,
        data: {
          invite: {
            id: invite.id,
            inviteCode: invite.inviteCode,
            inviteLink: `/join/${invite.inviteCode}`,
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt,
          },
        },
      };
    }
  );

  // List pending invites
  app.get(
    '/current/members/invites',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const invites = await db.query.memberInvites.findMany({
        where: and(
          eq(memberInvites.householdId, request.user!.householdId),
          eq(memberInvites.status, 'pending')
        ),
      });

      return { success: true, data: { invites } };
    }
  );

  // Revoke invite
  app.delete<{ Params: { id: string } }>(
    '/current/members/invites/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .update(memberInvites)
        .set({ status: 'revoked' })
        .where(
          and(
            eq(memberInvites.id, request.params.id),
            eq(memberInvites.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Invite revoked' } };
    }
  );

  // Update member role
  app.patch<{ Params: { id: string } }>(
    '/current/members/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const { role } = z.object({ role: userRoleSchema }).parse(request.body);

      // Can't change own role
      if (request.params.id === request.user!.id) {
        throw Errors.validation('Cannot change your own role');
      }

      const [updated] = await db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(
          and(
            eq(users.id, request.params.id),
            eq(users.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Member');
      }

      return { success: true, data: { member: updated } };
    }
  );

  // Remove member
  app.delete<{ Params: { id: string } }>(
    '/current/members/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      // Can't remove self
      if (request.params.id === request.user!.id) {
        throw Errors.validation('Cannot remove yourself');
      }

      await db
        .delete(users)
        .where(
          and(
            eq(users.id, request.params.id),
            eq(users.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Member removed' } };
    }
  );
}

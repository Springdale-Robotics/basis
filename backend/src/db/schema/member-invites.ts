import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users, userRoleEnum } from './users.js';

export const memberInviteStatusEnum = pgEnum('member_invite_status', [
  'pending',
  'accepted',
  'expired',
  'revoked',
]);

export const memberInvites = pgTable('member_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }),
  inviteCode: varchar('invite_code', { length: 32 }).notNull().unique(),
  role: userRoleEnum('role').notNull().default('member'),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  status: memberInviteStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type MemberInvite = typeof memberInvites.$inferSelect;
export type NewMemberInvite = typeof memberInvites.$inferInsert;

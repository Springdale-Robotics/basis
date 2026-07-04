import { pgTable, varchar, uuid, timestamp, text } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

/** Same shape as the main app's sessions: id = randomBytes(32).hex. */
export const sessions = pgTable('sessions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;

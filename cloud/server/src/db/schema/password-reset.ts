import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

/**
 * One-time password-reset tokens. Only the sha256 of the emailed token is
 * stored — the plaintext lives only in the recipient's inbox.
 */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Non-session credentials for native protocols (CalDAV, future API access).
 * Each row is one generated password; the plaintext is shown to the user once
 * at creation and never persisted. Verification scans all non-revoked rows for
 * a user (small N, argon2 is the bottleneck).
 */
export const appPasswords = pgTable(
  'app_passwords',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 255 }).notNull(),
    secretHash: text('secret_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default(['caldav']),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [index('app_passwords_user_id_idx').on(t.userId)]
);

export type AppPassword = typeof appPasswords.$inferSelect;
export type NewAppPassword = typeof appPasswords.$inferInsert;

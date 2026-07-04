import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/**
 * Long-lived credentials a box uses for frp Login + heartbeats. NEVER stored
 * plaintext — only the sha256. Claiming issues a new token and revokes all
 * prior ones for the tenant (re-claim = rotation).
 */
export const tunnelTokens = pgTable('tunnel_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type TunnelToken = typeof tunnelTokens.$inferSelect;

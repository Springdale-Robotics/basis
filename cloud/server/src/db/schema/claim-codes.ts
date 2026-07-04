import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/** One-time codes linking a box to a tenant. Only the sha256 is stored. */
export const claimCodes = pgTable('claim_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  codeHash: varchar('code_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type ClaimCode = typeof claimCodes.$inferSelect;

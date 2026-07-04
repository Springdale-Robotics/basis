import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { accounts } from './accounts.js';

/**
 * Denormalized service status — what the frp handler and heartbeat serve.
 * Driven by the Stripe webhook state machine + daily sweep:
 *   unpaid    — subdomain claimed, checkout never completed
 *   active    — paid (or comped), tunnel allowed
 *   past_due  — payment failed, inside grace window (tunnel still allowed)
 *   suspended — grace expired (tunnel rejected)
 *   canceled  — subscription deleted (tokens revoked, subdomain tombstoned)
 */
export const tenantStatusEnum = pgEnum('tenant_status', [
  'unpaid',
  'active',
  'past_due',
  'suspended',
  'canceled',
]);

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    subdomain: varchar('subdomain', { length: 30 }).notNull(),
    status: tenantStatusEnum('status').notNull().default('unpaid'),
    /** Over the Basic monthly cap — NewProxy injects a bandwidth limit. */
    throttled: boolean('throttled').notNull().default(false),
    /** While set on a canceled tenant, only the same account may re-register
     *  this subdomain (anti-phishing: don't hand a family's old URL to a
     *  stranger the day they stop paying). */
    tombstonedUntil: timestamp('tombstoned_until'),
    lastHeartbeatAt: timestamp('last_heartbeat_at'),
    lastConnectedAt: timestamp('last_connected_at'),
    canceledAt: timestamp('canceled_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    // One tenant per account for v1 — dropping this constraint is the whole
    // multi-tenant migration.
    accountUnique: uniqueIndex('tenants_account_id_unique').on(t.accountId),
    // Canceled tenants keep their row (audit + tombstone) but release the
    // name once app-level tombstone checks pass — hence a PARTIAL unique.
    subdomainActiveUnique: uniqueIndex('tenants_subdomain_active_unique')
      .on(t.subdomain)
      .where(sql`status <> 'canceled'`),
  })
);

export type Tenant = typeof tenants.$inferSelect;
export type TenantStatus = Tenant['status'];

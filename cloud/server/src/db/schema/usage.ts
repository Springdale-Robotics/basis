import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  boolean,
  date,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/** Monthly transfer per tenant. month = first-of-month UTC. Counts in+out. */
export const usageLedger = pgTable(
  'usage_ledger',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    month: date('month').notNull(),
    bytesIn: bigint('bytes_in', { mode: 'number' }).notNull().default(0),
    bytesOut: bigint('bytes_out', { mode: 'number' }).notNull().default(0),
    warned80: boolean('warned_80').notNull().default(false),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.month] }),
  })
);

/**
 * Last counters observed from the frps admin API, per proxy name
 * ("<tenantId>.web"). frps counters are in-memory (reset on restart and at
 * midnight), so metering accumulates deltas against this row — persisting it
 * means a control-plane restart doesn't double- or under-count.
 */
export const usagePollState = pgTable('usage_poll_state', {
  proxyName: varchar('proxy_name', { length: 100 }).primaryKey(),
  lastIn: bigint('last_in', { mode: 'number' }).notNull().default(0),
  lastOut: bigint('last_out', { mode: 'number' }).notNull().default(0),
  polledAt: timestamp('polled_at').defaultNow().notNull(),
});

export type UsageLedgerRow = typeof usageLedger.$inferSelect;

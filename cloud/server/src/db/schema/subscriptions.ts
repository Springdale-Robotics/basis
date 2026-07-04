import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  text,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const tierEnum = pgEnum('subscription_tier', ['basic', 'streaming']);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }).unique(),
  tier: tierEnum('tier'),
  /** Raw Stripe status, for debugging; tenants.status is the derived truth. */
  stripeStatus: varchar('stripe_status', { length: 50 }),
  /** Comped beta accounts — no Stripe objects; webhooks must skip these. */
  isComp: boolean('is_comp').notNull().default(false),
  compNote: text('comp_note'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  /** Set on first payment failure; sweep suspends when it passes. */
  graceUntil: timestamp('grace_until'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;

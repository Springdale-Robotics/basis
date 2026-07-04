import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

/** Processed Stripe event ids — webhook idempotency. */
export const stripeEvents = pgTable('stripe_events', {
  id: varchar('id', { length: 255 }).primaryKey(),
  type: varchar('type', { length: 100 }).notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
});

import { pgTable, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Box-level configuration — deliberately NOT household-scoped. An installed
 * model is a property of the machine: two households on one box cannot each
 * have their own copy of a 5GB model. Because it holds no tenant data it needs
 * no RLS policy; it is listed in RLS-PLAN.md as intentionally app-level-only.
 */
export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';

export const notificationTypeEnum = pgEnum('notification_type', [
  'low_stock',
  'expiring_soon',
  'leftover_expiring',
  'task_due',
  'sync_error',
  'backup_complete',
  'connection_request',
  'general',
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body'),
  data: jsonb('data').$type<NotificationData>(),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface NotificationData {
  resourceType?: string;
  resourceId?: string;
  itemId?: string;
  itemName?: string;
  currentQuantity?: number;
  minQuantity?: number;
  unit?: string;
  actions?: NotificationAction[];
  // Leftover-specific data
  leftoverId?: string;
  leftoverName?: string;
  daysUntilExpiry?: number;
  preparedAt?: string;
}

export interface NotificationAction {
  id: string;
  label: string;
  endpoint?: string;
}

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  integer,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';

export const deviceTypeEnum = pgEnum('device_type', ['mobile', 'tablet', 'tv', 'desktop']);

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: deviceTypeEnum('type').notNull(),
  isFixed: boolean('is_fixed').default(false).notNull(),
  allowedPages: jsonb('allowed_pages').$type<string[]>().default([]),
  defaultUserId: uuid('default_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  lastSeen: timestamp('last_seen'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const deviceSettings = pgTable('device_settings', {
  deviceId: uuid('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  screensaverEnabled: boolean('screensaver_enabled').default(false),
  screensaverTimeoutMinutes: integer('screensaver_timeout_minutes'),
  screensaverAlbumId: uuid('screensaver_album_id'),
  showCalendarOnScreensaver: boolean('show_calendar_on_screensaver').default(true),
  hiddenPages: jsonb('hidden_pages').$type<string[]>().default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const deviceRuleTypeEnum = pgEnum('device_rule_type', [
  'time_based',
  'user_based',
  'always',
]);

export const deviceRules = pgTable('device_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' }),
  ruleType: deviceRuleTypeEnum('rule_type').notNull(),
  condition: jsonb('condition').$type<DeviceRuleCondition>(),
  allowedPages: jsonb('allowed_pages').$type<string[]>().default([]),
  deniedPages: jsonb('denied_pages').$type<string[]>().default([]),
  defaultUserId: uuid('default_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  priority: integer('priority').default(0),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export interface DeviceRuleCondition {
  type: 'time_based' | 'user_based';
  days?: string[];
  startTime?: string;
  endTime?: string;
  timezone?: string;
  userIds?: string[];
}

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type DeviceRule = typeof deviceRules.$inferSelect;
export type NewDeviceRule = typeof deviceRules.$inferInsert;

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { households } from './households.js';

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: varchar('theme', { length: 50 }).default('system'),
  hiddenPages: jsonb('hidden_pages').$type<string[]>().default([]),
  notificationPreferences: jsonb('notification_preferences').$type<NotificationPreferences>(),
  calendarDefaultView: varchar('calendar_default_view', { length: 50 }).default('month'),
  themeOverride: jsonb('theme_override').$type<ThemeOverride>(),
  accentColor: varchar('accent_color', { length: 7 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface NotificationPreferences {
  lowStock: boolean;
  expiringSoon: boolean;
  taskDue: boolean;
  syncErrors: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

export interface ThemeOverride {
  mode?: 'light' | 'dark' | 'system';
  primaryColor?: string;
  accentColor?: string;
}

export const ddnsProviderEnum = pgEnum('ddns_provider', [
  'cloudflare',
  'duckdns',
  'noip',
  'dynu',
  'custom',
]);

export const ddnsStatusEnum = pgEnum('ddns_status', ['active', 'error', 'disabled']);

export const ddnsConfig = pgTable('ddns_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  provider: ddnsProviderEnum('provider').notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),
  credentials: text('credentials').notNull(),
  updateIntervalMinutes: integer('update_interval_minutes').default(15).notNull(),
  lastIp: varchar('last_ip', { length: 45 }),
  lastUpdatedAt: timestamp('last_updated_at'),
  status: ddnsStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const extensions = pgTable('extensions', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull(),
  description: text('description'),
  version: varchar('version', { length: 50 }).notNull(),
  entryPoint: text('entry_point').notNull(),
  configSchema: jsonb('config_schema'),
  config: jsonb('config').default({}),
  permissionsRequired: jsonb('permissions_required').$type<string[]>().default([]),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  installedAt: timestamp('installed_at').defaultNow().notNull(),
  installedBy: uuid('installed_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const musicProviderEnum = pgEnum('music_provider', [
  'spotify',
  'youtube_music',
  'apple_music',
]);

export const musicIntegrations = pgTable('music_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  provider: musicProviderEnum('provider').notNull(),
  credentials: text('credentials').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').default(true).notNull(),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const backupRecordStatusEnum = pgEnum('backup_record_status', ['pending', 'in_progress', 'completed', 'failed']);

export const backups = pgTable('backups', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }),
  filePath: text('file_path'),
  sizeBytes: integer('size_bytes'),
  status: backupRecordStatusEnum('status').notNull().default('pending'),
  includesFiles: boolean('includes_files').default(true).notNull(),
  encryptionKeyHash: text('encryption_key_hash'),
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const backupSchedules = pgTable('backup_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  cronExpression: varchar('cron_expression', { length: 100 }).notNull(),
  retentionDays: integer('retention_days').default(30).notNull(),
  includeFiles: boolean('include_files').default(true).notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type UserSetting = typeof userSettings.$inferSelect;
export type NewUserSetting = typeof userSettings.$inferInsert;
export type DdnsConfigRecord = typeof ddnsConfig.$inferSelect;
export type NewDdnsConfig = typeof ddnsConfig.$inferInsert;
export type Extension = typeof extensions.$inferSelect;
export type NewExtension = typeof extensions.$inferInsert;
export type MusicIntegration = typeof musicIntegrations.$inferSelect;
export type NewMusicIntegration = typeof musicIntegrations.$inferInsert;
export type Backup = typeof backups.$inferSelect;
export type NewBackup = typeof backups.$inferInsert;
export type BackupSchedule = typeof backupSchedules.$inferSelect;
export type NewBackupSchedule = typeof backupSchedules.$inferInsert;

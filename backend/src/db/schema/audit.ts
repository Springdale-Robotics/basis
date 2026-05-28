import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }),
  resourceId: uuid('resource_id'),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  requestId: uuid('request_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

export const auditActions = {
  // User management
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_ROLE_CHANGE: 'user.role_change',

  // Authentication
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_FAILED_LOGIN: 'auth.failed_login',
  AUTH_PASSWORD_RESET: 'auth.password_reset',

  // Permission changes
  PERMISSION_GRANT: 'permission.grant',
  PERMISSION_REVOKE: 'permission.revoke',

  // Household settings
  HOUSEHOLD_SETTINGS_UPDATE: 'household.settings_update',

  // Connected households
  CONNECTION_CREATE: 'connection.create',
  CONNECTION_DISCONNECT: 'connection.disconnect',

  // Backup operations
  BACKUP_CREATE: 'backup.create',
  BACKUP_RESTORE: 'backup.restore',

  // Device management
  DEVICE_CREATE: 'device.create',
  DEVICE_UPDATE: 'device.update',
  DEVICE_DELETE: 'device.delete',
} as const;

export type AuditAction = (typeof auditActions)[keyof typeof auditActions];

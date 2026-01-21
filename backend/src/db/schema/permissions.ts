import { pgTable, uuid, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users';

export const resourceTypeEnum = pgEnum('resource_type', [
  'calendar',
  'recipe',
  'task',
  'file',
  'album',
  'list',
  'page',
  'inventory_area',
]);

export const granteeTypeEnum = pgEnum('grantee_type', [
  'user',
  'role',
  'group',
  'household',
  'external',
  'device',
]);

export const permissionLevelEnum = pgEnum('permission_level', [
  'view',
  'view_busy',
  'edit',
  'admin',
]);

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  resourceType: resourceTypeEnum('resource_type').notNull(),
  resourceId: uuid('resource_id').notNull(),
  granteeType: granteeTypeEnum('grantee_type').notNull(),
  granteeId: varchar('grantee_id', { length: 255 }).notNull(),
  permissionLevel: permissionLevelEnum('permission_level').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;

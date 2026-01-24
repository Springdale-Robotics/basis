import { pgTable, uuid, varchar, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { households } from './households';

export const resourceTypeEnum = pgEnum('resource_type', [
  'calendar',
  'recipe',
  'task',
  'file',
  'album',
  'list',
  'page',
  'inventory_area',
  'feature',
]);

// Feature names for feature-level permissions
export const featureEnum = pgEnum('feature', [
  'recipes',
  'inventory',
  'meal_plan',
  'shopping_list',
  'files',
  'calendars',
  'lists',
  'tasks',
  'settings',
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
  'none',
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

// Feature permissions table - controls access to entire features/modules
export const featurePermissions = pgTable('feature_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  feature: featureEnum('feature').notNull(),
  granteeType: granteeTypeEnum('grantee_type').notNull(),
  granteeId: varchar('grantee_id', { length: 255 }).notNull(),
  permissionLevel: permissionLevelEnum('permission_level').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueGrant: unique().on(table.householdId, table.feature, table.granteeType, table.granteeId),
}));

export type FeaturePermission = typeof featurePermissions.$inferSelect;
export type NewFeaturePermission = typeof featurePermissions.$inferInsert;

// Feature type for TypeScript
export type Feature = 'recipes' | 'inventory' | 'meal_plan' | 'shopping_list' | 'files' | 'calendars' | 'lists' | 'tasks' | 'settings';

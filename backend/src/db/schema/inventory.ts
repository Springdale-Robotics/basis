import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  decimal,
  boolean,
  date,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { households } from './households';
import { users } from './users';
import { recipes } from './recipes';

export const inventoryAreas = pgTable('inventory_areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  icon: varchar('icon', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  barcode: varchar('barcode', { length: 255 }),
  internalId: varchar('internal_id', { length: 20 }),
  defaultUnit: varchar('default_unit', { length: 50 }),
  defaultShelfLifeDays: integer('default_shelf_life_days'),
  unitConversions: jsonb('unit_conversions').$type<UnitConversion[]>().default([]),
  category: varchar('category', { length: 100 }),
  keepInStock: boolean('keep_in_stock').default(false).notNull(),
  minStockQuantity: decimal('min_stock_quantity', { precision: 10, scale: 3 }),
  defaultAreaId: uuid('default_area_id').references(() => inventoryAreas.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface UnitConversion {
  fromUnit: string;
  toUnit: string;
  factor: number;
}

export const inventoryStock = pgTable('inventory_stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => inventoryItems.id, { onDelete: 'cascade' }),
  areaId: uuid('area_id')
    .notNull()
    .references(() => inventoryAreas.id, { onDelete: 'cascade' }),
  quantity: decimal('quantity', { precision: 10, scale: 3 }).notNull(),
  unit: varchar('unit', { length: 50 }),
  expiryDate: date('expiry_date'),
  addedAt: timestamp('added_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const shoppingListSourceEnum = pgEnum('shopping_list_source', [
  'manual',
  'meal_plan',
  'low_stock',
]);

export const leftoverSourceEnum = pgEnum('leftover_source', [
  'recipe',
  'restaurant',
  'homemade',
  'other',
]);

export const shoppingList = pgTable('shopping_list', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => inventoryItems.id, { onDelete: 'set null' }),
  customName: varchar('custom_name', { length: 255 }),
  quantity: decimal('quantity', { precision: 10, scale: 3 }),
  unit: varchar('unit', { length: 50 }),
  isChecked: boolean('is_checked').default(false).notNull(),
  addedBy: uuid('added_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  source: shoppingListSourceEnum('source').notNull().default('manual'),
  targetAreaId: uuid('target_area_id').references(() => inventoryAreas.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const leftovers = pgTable('leftovers', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  source: leftoverSourceEnum('source').notNull().default('homemade'),
  sourceRecipeId: uuid('source_recipe_id').references(() => recipes.id, {
    onDelete: 'set null',
  }),
  restaurantName: varchar('restaurant_name', { length: 255 }),
  areaId: uuid('area_id').references(() => inventoryAreas.id, { onDelete: 'set null' }),
  portions: decimal('portions', { precision: 10, scale: 2 }).default('1'),
  quantityNotes: varchar('quantity_notes', { length: 255 }),
  preparedAt: timestamp('prepared_at').defaultNow().notNull(),
  expiryDate: date('expiry_date').notNull(),
  finishedAt: timestamp('finished_at'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const inventoryAreasRelations = relations(inventoryAreas, ({ one, many }) => ({
  household: one(households, {
    fields: [inventoryAreas.householdId],
    references: [households.id],
  }),
  stock: many(inventoryStock),
  items: many(inventoryItems),
}));

export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  household: one(households, {
    fields: [inventoryItems.householdId],
    references: [households.id],
  }),
  defaultArea: one(inventoryAreas, {
    fields: [inventoryItems.defaultAreaId],
    references: [inventoryAreas.id],
  }),
  stock: many(inventoryStock),
  shoppingListEntries: many(shoppingList),
}));

export const inventoryStockRelations = relations(inventoryStock, ({ one }) => ({
  item: one(inventoryItems, {
    fields: [inventoryStock.itemId],
    references: [inventoryItems.id],
  }),
  area: one(inventoryAreas, {
    fields: [inventoryStock.areaId],
    references: [inventoryAreas.id],
  }),
}));

export const shoppingListRelations = relations(shoppingList, ({ one }) => ({
  household: one(households, {
    fields: [shoppingList.householdId],
    references: [households.id],
  }),
  item: one(inventoryItems, {
    fields: [shoppingList.itemId],
    references: [inventoryItems.id],
  }),
  addedByUser: one(users, {
    fields: [shoppingList.addedBy],
    references: [users.id],
  }),
  targetArea: one(inventoryAreas, {
    fields: [shoppingList.targetAreaId],
    references: [inventoryAreas.id],
  }),
}));

export const leftoversRelations = relations(leftovers, ({ one }) => ({
  household: one(households, {
    fields: [leftovers.householdId],
    references: [households.id],
  }),
  sourceRecipe: one(recipes, {
    fields: [leftovers.sourceRecipeId],
    references: [recipes.id],
  }),
  area: one(inventoryAreas, {
    fields: [leftovers.areaId],
    references: [inventoryAreas.id],
  }),
  createdByUser: one(users, {
    fields: [leftovers.createdBy],
    references: [users.id],
  }),
}));

export type InventoryArea = typeof inventoryAreas.$inferSelect;
export type NewInventoryArea = typeof inventoryAreas.$inferInsert;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
export type InventoryStock = typeof inventoryStock.$inferSelect;
export type NewInventoryStock = typeof inventoryStock.$inferInsert;
export type ShoppingListItem = typeof shoppingList.$inferSelect;
export type NewShoppingListItem = typeof shoppingList.$inferInsert;
export type Leftover = typeof leftovers.$inferSelect;
export type NewLeftover = typeof leftovers.$inferInsert;
export type LeftoverSource = 'recipe' | 'restaurant' | 'homemade' | 'other';

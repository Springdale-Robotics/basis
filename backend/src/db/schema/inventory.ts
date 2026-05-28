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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { households } from './households.js';
import { users } from './users.js';
import { recipes, mealPlans } from './recipes.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const stockSourceEnum = pgEnum('stock_source', [
  'purchase',
  'manual',
  'migration',
  'implicit_checklist',
  'cooking_depletion',
]);

export const locationTypeEnum = pgEnum('location_type', [
  'pantry',
  'fridge',
  'freezer',
  'other',
]);

export const shoppingListSourceEnum = pgEnum('shopping_list_source', [
  'manual',
  'meal_plan',
  'low_stock',
  'recipe',
]);

export const leftoverSourceEnum = pgEnum('leftover_source', [
  'recipe',
  'restaurant',
  'homemade',
  'other',
]);

export const aliasTypeEnum = pgEnum('alias_type', [
  'exact',    // "whole milk" is exactly "milk" (directional: whole milk IS-A milk)
  'variant',  // "frozen spinach" is a form variant of "spinach"
  'brand',    // "Tillamook Cheddar" is a brand of "cheddar cheese"
]);

export const receiptScanStatusEnum = pgEnum('receipt_scan_status', [
  'processing',
  'pending_review',
  'confirmed',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Custom Units (household-defined count units)
// ---------------------------------------------------------------------------

export const customUnits = pgTable('custom_units', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  aliases: jsonb('aliases').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueKeyPerHousehold: uniqueIndex('custom_units_household_key_idx')
    .on(table.householdId, table.key),
}));

// ---------------------------------------------------------------------------
// Inventory Areas (storage locations with decay metadata)
// ---------------------------------------------------------------------------

export const inventoryAreas = pgTable('inventory_areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  icon: varchar('icon', { length: 50 }),
  // 1B: Location type and confidence decay
  locationType: locationTypeEnum('location_type').default('other').notNull(),
  confidenceDecayRate: decimal('confidence_decay_rate', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Inventory Items (the catalog / items library)
// ---------------------------------------------------------------------------

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
  // Density in g/cup for weight<->volume conversion
  density: decimal('density', { precision: 8, scale: 4 }),
  // Per-item count unit -> sized in any standard unit, e.g.:
  //   { "bottle": { quantity: 16, unit: "fl oz" }, "bag": { quantity: 5, unit: "lb" } }
  // The conversion engine resolves count units through these sizes; density
  // only enters the picture when the resolved unit still needs to cross
  // weight↔volume.
  quantityUnitSizes: jsonb('quantity_unit_sizes')
    .$type<Record<string, { quantity: number; unit: string }>>()
    .notNull()
    .default({}),
  // True when this item's stock or recipe ingredient units can't be bridged
  // with the metadata currently on the item (density, container sizes). Set
  // during check-off / shopping-list generation / inventory scan; cleared
  // when the user supplies the missing piece on the next list reconcile.
  needsConversion: boolean('needs_conversion').notNull().default(false),
  category: varchar('category', { length: 100 }),
  keepInStock: boolean('keep_in_stock').default(false).notNull(),
  minStockQuantity: decimal('min_stock_quantity', { precision: 10, scale: 3 }),
  defaultAreaId: uuid('default_area_id').references(() => inventoryAreas.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Inventory Stock (tranches with confidence, source, and price)
// ---------------------------------------------------------------------------

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
  // 1A: Tranche fields
  confidence: integer('confidence').default(100).notNull(),
  source: stockSourceEnum('source').default('manual').notNull(),
  pricePerUnit: decimal('price_per_unit', { precision: 10, scale: 4 }),
  priceCurrency: varchar('price_currency', { length: 3 }).default('USD'),
  verifiedAt: timestamp('verified_at'),
  originalQuantity: decimal('original_quantity', { precision: 10, scale: 3 }),
  addedAt: timestamp('added_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Shopping List (enhanced with recipe tracking and confidence notes)
// ---------------------------------------------------------------------------

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
  // All source labels that have contributed to this row. Starts as `[source]`,
  // grows when a merge brings in a different source. Lets the UI surface a
  // "Mixed" badge instead of pretending a meal-plan top-up was manual.
  sources: shoppingListSourceEnum('sources').array().notNull().default(sql`ARRAY[]::shopping_list_source[]`),
  targetAreaId: uuid('target_area_id').references(() => inventoryAreas.id, {
    onDelete: 'set null',
  }),
  // 1C: Recipe/meal plan tracking and confidence-aware display
  recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
  mealPlanId: uuid('meal_plan_id').references(() => mealPlans.id, { onDelete: 'set null' }),
  confidenceNote: varchar('confidence_note', { length: 255 }),
  isDelta: boolean('is_delta').default(false).notNull(),
  originalFullQuantity: decimal('original_full_quantity', { precision: 10, scale: 3 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Ingredient Aliases (directional ontology: alias IS-A canonical item)
// ---------------------------------------------------------------------------

export const ingredientAliases = pgTable('ingredient_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  canonicalItemId: uuid('canonical_item_id')
    .notNull()
    .references(() => inventoryItems.id, { onDelete: 'cascade' }),
  aliasName: varchar('alias_name', { length: 255 }).notNull(),
  aliasType: aliasTypeEnum('alias_type').default('exact').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueAliasPerHousehold: uniqueIndex('ingredient_aliases_household_name_idx')
    .on(table.householdId, table.aliasName),
}));

// ---------------------------------------------------------------------------
// Receipt Scans
// ---------------------------------------------------------------------------

export const receiptScans = pgTable('receipt_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  scannedBy: uuid('scanned_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  imageData: text('image_data'),
  rawOcrText: text('raw_ocr_text'),
  parsedItems: jsonb('parsed_items').$type<ParsedReceiptItem[]>().default([]),
  shoppingListContext: jsonb('shopping_list_context').$type<ShoppingListSnapshot[]>().default([]),
  status: receiptScanStatusEnum('status').default('processing').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
});

export interface ParsedReceiptItem {
  lineText: string;
  matchedItemId?: string;
  matchedItemName?: string;
  quantity?: number;
  unit?: string;
  price?: number;
  confidence: number; // 0-100
}

export interface ShoppingListSnapshot {
  itemId?: string;
  customName?: string;
  quantity?: number;
  unit?: string;
}

// ---------------------------------------------------------------------------
// Leftovers
// ---------------------------------------------------------------------------

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
  expiryDate: date('expiry_date'),
  finishedAt: timestamp('finished_at'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const customUnitsRelations = relations(customUnits, ({ one }) => ({
  household: one(households, {
    fields: [customUnits.householdId],
    references: [households.id],
  }),
}));

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
  aliases: many(ingredientAliases),
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
  recipe: one(recipes, {
    fields: [shoppingList.recipeId],
    references: [recipes.id],
  }),
  mealPlan: one(mealPlans, {
    fields: [shoppingList.mealPlanId],
    references: [mealPlans.id],
  }),
}));

export const ingredientAliasesRelations = relations(ingredientAliases, ({ one }) => ({
  household: one(households, {
    fields: [ingredientAliases.householdId],
    references: [households.id],
  }),
  canonicalItem: one(inventoryItems, {
    fields: [ingredientAliases.canonicalItemId],
    references: [inventoryItems.id],
  }),
}));

export const receiptScansRelations = relations(receiptScans, ({ one }) => ({
  household: one(households, {
    fields: [receiptScans.householdId],
    references: [households.id],
  }),
  scannedByUser: one(users, {
    fields: [receiptScans.scannedBy],
    references: [users.id],
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

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type CustomUnit = typeof customUnits.$inferSelect;
export type NewCustomUnit = typeof customUnits.$inferInsert;
export type InventoryArea = typeof inventoryAreas.$inferSelect;
export type NewInventoryArea = typeof inventoryAreas.$inferInsert;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
export type InventoryStock = typeof inventoryStock.$inferSelect;
export type NewInventoryStock = typeof inventoryStock.$inferInsert;
export type ShoppingListItem = typeof shoppingList.$inferSelect;
export type NewShoppingListItem = typeof shoppingList.$inferInsert;
export type IngredientAlias = typeof ingredientAliases.$inferSelect;
export type NewIngredientAlias = typeof ingredientAliases.$inferInsert;
export type ReceiptScan = typeof receiptScans.$inferSelect;
export type NewReceiptScan = typeof receiptScans.$inferInsert;
export type Leftover = typeof leftovers.$inferSelect;
export type NewLeftover = typeof leftovers.$inferInsert;
export type LeftoverSource = 'recipe' | 'restaurant' | 'homemade' | 'other';
export type StockSource = 'purchase' | 'manual' | 'migration' | 'implicit_checklist' | 'cooking_depletion';
export type LocationType = 'pantry' | 'fridge' | 'freezer' | 'other';
export type AliasType = 'exact' | 'variant' | 'brand';

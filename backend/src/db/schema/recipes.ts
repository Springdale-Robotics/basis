import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  decimal,
  date,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/** A photograph a recipe was read from, kept on disk beside the recipe. */
export interface RecipePhoto {
  path: string;
  mimeType: string;
}
import { households } from './households.js';
import { users } from './users.js';
import { devices } from './devices.js';
// Circular at the module level but only used inside lazy `references(() => …)`
// callbacks, which drizzle-orm evaluates after all schema modules have
// finished loading — the existing inventory.ts ↔ recipes.ts pair already
// uses this pattern (inventory references recipes for leftovers etc.).
import { inventoryItems } from './inventory.js';

export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  instructions: jsonb('instructions').$type<RecipeInstruction[]>().default([]),
  prepTimeMinutes: integer('prep_time_minutes'),
  cookTimeMinutes: integer('cook_time_minutes'),
  servings: integer('servings'),
  imageUrl: text('image_url'),
  imageData: text('image_data'),                              // Base64-encoded image
  /**
   * Photographs this recipe was read from, copied out of the scan so the
   * recipe owns them. Served from disk — `imageData` is base64 in the row and
   * a phone photo does not belong there.
   */
  photoPaths: jsonb('photo_paths').$type<RecipePhoto[]>(),
  imageMimeType: varchar('image_mime_type', { length: 50 }),  // e.g., 'image/webp'
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
  sourceUrl: text('source_url'),
  tags: jsonb('tags').$type<string[]>().default([]),
  timers: jsonb('timers').$type<RecipeTimer[]>().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface RecipeInstruction {
  step: number;
  text: string;
  timerIds?: string[];
}

export interface RecipeTimer {
  id: string;
  name: string;
  durationSeconds: number;
  stepIndex?: number;
  alertSound?: string;
}

export const recipeIngredients = pgTable('recipe_ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, {
    onDelete: 'set null',
  }),
  name: varchar('name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 10, scale: 3 }),
  unit: varchar('unit', { length: 50 }),
  notes: varchar('notes', { length: 255 }),
  groupName: varchar('group_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const mealTypeEnum = pgEnum('meal_type', ['breakfast', 'lunch', 'dinner', 'snack']);

export const mealPlans = pgTable('meal_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  plannedDate: date('planned_date').notNull(),
  mealType: mealTypeEnum('meal_type').notNull(),
  servingsMultiplier: decimal('servings_multiplier', { precision: 10, scale: 6 }).default('1'),
  cookedAt: timestamp('cooked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const mealPlansRelations = relations(mealPlans, ({ one }) => ({
  recipe: one(recipes, {
    fields: [mealPlans.recipeId],
    references: [recipes.id],
  }),
}));

export const activeCookingSessions = pgTable('active_cooking_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  currentStep: integer('current_step').default(0).notNull(),
  activeTimers: jsonb('active_timers').$type<ActiveTimer[]>().default([]),
  servingsMultiplier: decimal('servings_multiplier', { precision: 10, scale: 6 }).default('1'),
});

export interface ActiveTimer {
  timerId: string;
  startedAt: string;
  pausedAt?: string;
  remainingSeconds?: number;
}

export const importSourceTypeEnum = pgEnum('import_source_type', ['url', 'image', 'pdf', 'text']);
export const importStatusEnum = pgEnum('import_status', [
  'parsing',
  'pending_review',
  'confirmed',
  'cancelled',
  // Parsing threw — a URL that wouldn't fetch, a PDF with no text. Without
  // this the row sat in 'parsing' forever: invisible, unretryable, and never
  // swept. The reason is kept in parseWarnings.
  'failed',
]);

export const recipeImportSessions = pgTable('recipe_import_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sourceType: importSourceTypeEnum('source_type').notNull(),
  sourceData: text('source_data').notNull(),
  /** Scans this import was built from, so their photographs can be kept. */
  imageSessionIds: jsonb('image_session_ids').$type<string[]>(),
  parsedRecipe: jsonb('parsed_recipe').$type<ParsedRecipe>(),
  ingredientMatches: jsonb('ingredient_matches').$type<IngredientMatch[]>().default([]),
  status: importStatusEnum('status').notNull().default('parsing'),
  parseMethod: varchar('parse_method', { length: 50 }),
  parseConfidence: decimal('parse_confidence', { precision: 5, scale: 4 }),
  parseWarnings: jsonb('parse_warnings').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

export interface ParsedRecipe {
  title: string;
  description?: string;
  instructions: string[];
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  imageUrl?: string;
  sourceUrl?: string;
  author?: string;
  cuisine?: string;
  ingredients: ParsedIngredient[];
  ingredientGroups?: Array<{ name?: string; ingredients: ParsedIngredient[] }>;
}

export interface IngredientGroup {
  name?: string;
  ingredients: ParsedIngredient[];
}

export interface ParsedIngredient {
  name: string;
  quantity?: number;
  unit?: string;
  notes?: string;
  /**
   * Heading this ingredient sat under ("For the sauce"). Carried on the
   * ingredient rather than looked up from `ingredientGroups`, because the
   * ingredient list gets rebuilt when CRF parses it and a name-keyed lookup
   * silently missed every time.
   */
  groupName?: string;
}

export interface IngredientMatch {
  parsedName: string;
  /**
   * Identity-normalized parsedName, computed server-side so clients can group
   * the same ingredient across recipes without reimplementing normalization.
   * The frontend had its own copy that claimed to mirror this one and didn't
   * (no plural stemming), so bulk review listed "onion" and "onions" as two
   * separate things to link.
   */
  dedupeKey?: string;
  parsedQuantity?: number;
  parsedUnit?: string;
  matchStatus: 'matched' | 'unmatched' | 'manual';
  matchedItemId?: string;
  matchedItemName?: string;
  modifiedUnit?: string;  // User-modified unit during import
  confidence?: number;
  matchReason?: 'exact' | 'synonym' | 'contains' | 'fuzzy' | 'related';
  needsQuantityWeight?: {
    fromUnit: string;
    toUnit: string;
  };
  suggestions?: Array<{
    itemId: string;
    name: string;
    confidence: number;
    matchReason?: 'exact' | 'synonym' | 'contains' | 'fuzzy' | 'related';
    needsQuantityWeight?: {
      fromUnit: string;
      toUnit: string;
    };
  }>;
  // Catalog item data from exported .recipe files
  catalogItem?: {
    name: string;
    category?: string;
    defaultUnit?: string;
    density?: number;
  };
}

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type NewRecipeIngredient = typeof recipeIngredients.$inferInsert;
export type MealPlan = typeof mealPlans.$inferSelect;
export type NewMealPlan = typeof mealPlans.$inferInsert;

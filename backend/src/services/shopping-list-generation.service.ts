/**
 * Shopping list generation service — confidence-aware, consolidation-first logic.
 *
 * Order of operations:
 * 1. Aggregate all ingredients across recipes
 * 2. Consolidate duplicates (sum where ingredient+unit match, convert where possible)
 * 3. Subtract inventory (confidence-tiered: only subtract high-confidence stock as delta)
 * 4. Present final list
 */

import { db } from '../config/database.js';
import {
  mealPlans,
  recipes,
  recipeIngredients,
  inventoryItems,
  shoppingList,
} from '../db/schema/index.js';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { getInventoryConfidenceMap, type ItemConfidenceResult } from './inventory-confidence.service.js';
import { convert, resolveUnit, isNegligible } from '../lib/units.js';
import { getConfidenceBand, DEFAULT_THRESHOLDS, type ConfidenceThresholds } from '../lib/confidence.js';
import type { HouseholdSettings } from '../db/schema/households.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AggregatedIngredient {
  /** Inventory item ID if linked, null if unlinked */
  itemId: string | null;
  /** Display name (from recipe ingredient or inventory item) */
  name: string;
  /** Total aggregated quantity */
  quantity: number;
  /** Canonical unit key */
  unit: string | null;
  /** Which recipes contributed to this item */
  sourceRecipes: Array<{ recipeId: string; recipeTitle: string; quantity: number; unit: string | null }>;
}

export interface ShoppingListPreviewItem extends AggregatedIngredient {
  /** What goes on the shopping list after inventory subtraction */
  shoppingQuantity: number;
  /** Whether the shopping quantity is a delta (true) or full amount (false) */
  isDelta: boolean;
  /** Original full quantity before subtraction */
  originalFullQuantity: number;
  /** Confidence note if applicable */
  confidenceNote: string | null;
  /** Inventory confidence band for this item */
  confidenceBand: 'high' | 'medium' | 'low' | null;
  /** Current inventory quantity (in same unit) */
  inventoryQuantity: number | null;
}

export interface LookAheadSuggestion {
  recipeId: string;
  recipeTitle: string;
  plannedDate: string;
  mealType: string;
  sharedIngredientCount: number;
  totalIngredients: number;
  overlappingIngredients: Array<{ name: string; quantity: number; unit: string | null }>;
}

// ---------------------------------------------------------------------------
// Core generation
// ---------------------------------------------------------------------------

/**
 * Generate a shopping list preview from meal plan entries in a date range.
 * Does NOT persist — returns a preview for the user to review.
 */
export async function generateFromMealPlan(
  householdId: string,
  startDate: string,
  endDate: string,
  options: {
    tier: 'basic' | 'advanced';
    confidenceThresholds?: ConfidenceThresholds;
    servingsMultiplier?: number;
  },
): Promise<ShoppingListPreviewItem[]> {
  const thresholds = options.confidenceThresholds ?? DEFAULT_THRESHOLDS;

  // 1. Fetch all meal plan entries in range with recipe ingredients
  const plans = await db
    .select({
      mealPlan: mealPlans,
      recipe: recipes,
    })
    .from(mealPlans)
    .innerJoin(recipes, eq(mealPlans.recipeId, recipes.id))
    .where(and(
      eq(mealPlans.householdId, householdId),
      gte(mealPlans.plannedDate, startDate),
      lte(mealPlans.plannedDate, endDate),
    ));

  if (plans.length === 0) return [];

  const recipeIds = [...new Set(plans.map(p => p.recipe.id))];

  // Fetch all ingredients for these recipes
  const ingredients = await db
    .select()
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.recipeId, recipeIds));

  // Build a map of recipe ID -> its plan entries (for servings multiplier)
  const plansByRecipe = new Map<string, typeof plans>();
  for (const plan of plans) {
    if (!plansByRecipe.has(plan.recipe.id)) plansByRecipe.set(plan.recipe.id, []);
    plansByRecipe.get(plan.recipe.id)!.push(plan);
  }

  // 2. Aggregate ingredients across recipes
  const aggregated = aggregateIngredients(ingredients, plans, options.servingsMultiplier);

  // 3. If Advanced tier, subtract inventory
  if (options.tier === 'advanced') {
    const confidenceMap = await getInventoryConfidenceMap(householdId, thresholds);
    return applyInventorySubtraction(aggregated, confidenceMap, thresholds, householdId);
  }

  // Basic tier: return full amounts with no inventory context
  return aggregated.map(item => ({
    ...item,
    shoppingQuantity: item.quantity,
    isDelta: false,
    originalFullQuantity: item.quantity,
    confidenceNote: null,
    confidenceBand: null,
    inventoryQuantity: null,
  }));
}

/**
 * Generate a shopping list preview for a single recipe.
 */
export async function generateFromRecipe(
  recipeId: string,
  householdId: string,
  servingsMultiplier: number = 1,
  options: {
    tier: 'basic' | 'advanced';
    confidenceThresholds?: ConfidenceThresholds;
  },
): Promise<ShoppingListPreviewItem[]> {
  const thresholds = options.confidenceThresholds ?? DEFAULT_THRESHOLDS;

  const recipe = await db.query.recipes.findFirst({
    where: eq(recipes.id, recipeId),
  });
  if (!recipe) return [];

  const ingredients = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId));

  const aggregated = aggregateIngredients(
    ingredients,
    [{ mealPlan: null as any, recipe }],
    servingsMultiplier,
  );

  if (options.tier === 'advanced') {
    const confidenceMap = await getInventoryConfidenceMap(householdId, thresholds);
    return applyInventorySubtraction(aggregated, confidenceMap, thresholds, householdId);
  }

  return aggregated.map(item => ({
    ...item,
    shoppingQuantity: item.quantity,
    isDelta: false,
    originalFullQuantity: item.quantity,
    confidenceNote: null,
    confidenceBand: null,
    inventoryQuantity: null,
  }));
}

// ---------------------------------------------------------------------------
// Look-ahead suggestions
// ---------------------------------------------------------------------------

/**
 * Given a set of items already on the shopping list, look ahead at upcoming
 * meal plans and suggest recipes that share ingredients.
 */
export async function getLookAheadSuggestions(
  householdId: string,
  currentItemIds: string[],
  days: number = 7,
): Promise<LookAheadSuggestion[]> {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + days);

  const startStr = today.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  // Get upcoming meal plans not already on the shopping list
  const upcomingPlans = await db
    .select({
      mealPlan: mealPlans,
      recipe: recipes,
    })
    .from(mealPlans)
    .innerJoin(recipes, eq(mealPlans.recipeId, recipes.id))
    .where(and(
      eq(mealPlans.householdId, householdId),
      gte(mealPlans.plannedDate, startStr),
      lte(mealPlans.plannedDate, endStr),
    ));

  if (upcomingPlans.length === 0 || currentItemIds.length === 0) return [];

  const currentItemIdSet = new Set(currentItemIds);
  const suggestions: LookAheadSuggestion[] = [];

  for (const plan of upcomingPlans) {
    const ingredients = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, plan.recipe.id));

    const overlapping = ingredients.filter(
      ing => ing.inventoryItemId && currentItemIdSet.has(ing.inventoryItemId)
    );

    if (overlapping.length > 0) {
      suggestions.push({
        recipeId: plan.recipe.id,
        recipeTitle: plan.recipe.title,
        plannedDate: plan.mealPlan.plannedDate,
        mealType: plan.mealPlan.mealType,
        sharedIngredientCount: overlapping.length,
        totalIngredients: ingredients.length,
        overlappingIngredients: overlapping.map(ing => ({
          name: ing.name,
          quantity: ing.quantity ? parseFloat(ing.quantity) : 0,
          unit: ing.unit,
        })),
      });
    }
  }

  // Sort by most shared ingredients first
  suggestions.sort((a, b) => b.sharedIngredientCount - a.sharedIngredientCount);
  return suggestions;
}

// ---------------------------------------------------------------------------
// Internal: aggregation
// ---------------------------------------------------------------------------

function aggregateIngredients(
  ingredients: Array<{
    id: string;
    recipeId: string;
    inventoryItemId: string | null;
    name: string;
    quantity: string | null;
    unit: string | null;
    notes: string | null;
  }>,
  plans: Array<{ mealPlan: any; recipe: { id: string; title: string; servings: number | null } }>,
  globalMultiplier: number = 1,
): AggregatedIngredient[] {
  // Build recipe title lookup
  const recipeTitles = new Map<string, string>();
  const recipeMultipliers = new Map<string, number>();
  for (const plan of plans) {
    recipeTitles.set(plan.recipe.id, plan.recipe.title);
    // Use per-plan servings multiplier if available, otherwise global
    const planMultiplier = plan.mealPlan?.servingsMultiplier
      ? parseFloat(plan.mealPlan.servingsMultiplier)
      : globalMultiplier;
    // Accumulate multipliers for same recipe planned multiple times
    const existing = recipeMultipliers.get(plan.recipe.id) ?? 0;
    recipeMultipliers.set(plan.recipe.id, existing + planMultiplier);
  }

  // Key: itemId or normalized name (for unlinked ingredients)
  const aggregation = new Map<string, AggregatedIngredient>();

  for (const ing of ingredients) {
    // Skip negligible units
    if (ing.unit && isNegligible(ing.unit)) continue;

    const qty = ing.quantity ? parseFloat(ing.quantity) : 0;
    if (qty <= 0) continue;

    const multiplier = recipeMultipliers.get(ing.recipeId) ?? globalMultiplier;
    const scaledQty = qty * multiplier;
    const unit = ing.unit ? resolveUnit(ing.unit) : null;

    // Use item ID as key if linked, otherwise normalize the name
    const key = ing.inventoryItemId ?? `name:${ing.name.toLowerCase().trim()}`;

    if (aggregation.has(key)) {
      const existing = aggregation.get(key)!;

      // Try to convert to existing unit for consolidation
      if (existing.unit === unit || (!existing.unit && !unit)) {
        existing.quantity += scaledQty;
      } else if (existing.unit && unit) {
        const converted = convert(scaledQty, unit, existing.unit);
        if (converted != null) {
          existing.quantity += converted;
        } else {
          // Can't convert — keep as separate entry by adding unit to key
          const altKey = `${key}:${unit}`;
          if (aggregation.has(altKey)) {
            aggregation.get(altKey)!.quantity += scaledQty;
            aggregation.get(altKey)!.sourceRecipes.push({
              recipeId: ing.recipeId,
              recipeTitle: recipeTitles.get(ing.recipeId) ?? 'Unknown',
              quantity: scaledQty,
              unit,
            });
          } else {
            aggregation.set(altKey, {
              itemId: ing.inventoryItemId,
              name: ing.name,
              quantity: scaledQty,
              unit,
              sourceRecipes: [{
                recipeId: ing.recipeId,
                recipeTitle: recipeTitles.get(ing.recipeId) ?? 'Unknown',
                quantity: scaledQty,
                unit,
              }],
            });
          }
          continue;
        }
      } else {
        // One has unit, other doesn't — can't consolidate
        existing.quantity += scaledQty;
      }

      existing.sourceRecipes.push({
        recipeId: ing.recipeId,
        recipeTitle: recipeTitles.get(ing.recipeId) ?? 'Unknown',
        quantity: scaledQty,
        unit,
      });
    } else {
      aggregation.set(key, {
        itemId: ing.inventoryItemId,
        name: ing.name,
        quantity: scaledQty,
        unit,
        sourceRecipes: [{
          recipeId: ing.recipeId,
          recipeTitle: recipeTitles.get(ing.recipeId) ?? 'Unknown',
          quantity: scaledQty,
          unit,
        }],
      });
    }
  }

  return [...aggregation.values()];
}

// ---------------------------------------------------------------------------
// Internal: inventory subtraction (confidence-tiered)
// ---------------------------------------------------------------------------

async function applyInventorySubtraction(
  aggregated: AggregatedIngredient[],
  confidenceMap: Map<string, ItemConfidenceResult>,
  thresholds: ConfidenceThresholds,
  householdId: string,
): Promise<ShoppingListPreviewItem[]> {
  const results: ShoppingListPreviewItem[] = [];
  // Track items we've already flagged this run so we don't issue redundant
  // UPDATE statements when the same item appears in multiple recipes.
  const flaggedItemIds = new Set<string>();

  for (const item of aggregated) {
    // No inventory item linked — pass through as full amount
    if (!item.itemId) {
      results.push({
        ...item,
        shoppingQuantity: item.quantity,
        isDelta: false,
        originalFullQuantity: item.quantity,
        confidenceNote: null,
        confidenceBand: null,
        inventoryQuantity: null,
      });
      continue;
    }

    const confidence = confidenceMap.get(item.itemId);

    // No inventory data — pass through as full amount
    if (!confidence || confidence.totalQuantity <= 0) {
      results.push({
        ...item,
        shoppingQuantity: item.quantity,
        isDelta: false,
        originalFullQuantity: item.quantity,
        confidenceNote: null,
        confidenceBand: 'low',
        inventoryQuantity: 0,
      });
      continue;
    }

    const band = confidence.band;
    let inventoryQtyInRecipeUnit = confidence.totalQuantity;

    // Convert inventory quantity to recipe unit if needed
    if (item.unit && confidence.unit && resolveUnit(confidence.unit) !== resolveUnit(item.unit || '')) {
      const converted = convert(confidence.totalQuantity, confidence.unit, item.unit || confidence.unit);
      if (converted != null) {
        inventoryQtyInRecipeUnit = converted;
      } else {
        // Can't convert — treat as unknown inventory AND flag the item so the
        // inventory view shows a "Needs density" badge. Bridging count units
        // (e.g. "bottle") to volume/weight needs a quantityUnitWeight; bridging
        // weight↔volume needs density. The update routes clear the flag when
        // either is supplied, so a single flag covers both fixes.
        if (item.itemId && !flaggedItemIds.has(item.itemId)) {
          flaggedItemIds.add(item.itemId);
          await db
            .update(inventoryItems)
            .set({ needsConversion: true, updatedAt: new Date() })
            .where(
              and(
                eq(inventoryItems.id, item.itemId),
                eq(inventoryItems.householdId, householdId),
                eq(inventoryItems.needsConversion, false)
              )
            );
        }
        results.push({
          ...item,
          shoppingQuantity: item.quantity,
          isDelta: false,
          originalFullQuantity: item.quantity,
          confidenceNote: 'Inventory tracked in different unit — check stock',
          confidenceBand: band,
          inventoryQuantity: confidence.totalQuantity,
        });
        continue;
      }
    }

    // Apply confidence-tiered behavior
    if (band === 'high') {
      // High confidence: show delta only
      const delta = Math.max(0, item.quantity - inventoryQtyInRecipeUnit);
      if (delta <= 0) continue; // Fully covered by inventory, skip

      results.push({
        ...item,
        shoppingQuantity: delta,
        isDelta: true,
        originalFullQuantity: item.quantity,
        confidenceNote: null,
        confidenceBand: 'high',
        inventoryQuantity: inventoryQtyInRecipeUnit,
      });
    } else if (band === 'medium') {
      // Medium confidence: show full amount + reconciliation note
      results.push({
        ...item,
        shoppingQuantity: item.quantity,
        isDelta: false,
        originalFullQuantity: item.quantity,
        confidenceNote: 'You may have some — reconcile to update',
        confidenceBand: 'medium',
        inventoryQuantity: inventoryQtyInRecipeUnit,
      });
    } else {
      // Low confidence: show full amount, no assumption
      results.push({
        ...item,
        shoppingQuantity: item.quantity,
        isDelta: false,
        originalFullQuantity: item.quantity,
        confidenceNote: null,
        confidenceBand: 'low',
        inventoryQuantity: inventoryQtyInRecipeUnit,
      });
    }
  }

  return results;
}

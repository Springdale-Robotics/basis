import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import {
  recipes,
  recipeIngredients,
  mealPlans,
  activeCookingSessions,
  inventoryStock,
  inventoryItems,
  shoppingList,
} from '../../db/schema/index.js';
import { eq, and, sql, gte, lte, asc, isNotNull } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { mealTypeSchema } from '../../lib/validators.js';
import {
  createImportSession,
  processImportSession,
  getImportSession,
  updateIngredientMatches,
  confirmImportSession,
  cancelImportSession,
  parseRecipeText,
} from './recipe-import.service.js';
import { matchSingleIngredient } from './ingredient-matching.service.js';
import type { UnitConversion } from '../../db/schema/inventory.js';
import { emitCookingDeduction } from '../../websocket/events.js';

const createRecipeSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  instructions: z.array(z.object({
    step: z.number().int().positive(),
    text: z.string(),
    timerIds: z.array(z.string()).optional(),
  })).default([]),
  prepTimeMinutes: z.number().int().positive().optional(),
  cookTimeMinutes: z.number().int().positive().optional(),
  servings: z.number().int().positive().optional(),
  imageUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  timers: z.array(z.object({
    id: z.string(),
    name: z.string(),
    durationSeconds: z.number().int().positive(),
    stepIndex: z.number().int().optional(),
    alertSound: z.string().optional(),
  })).default([]),
  ingredients: z.array(z.object({
    name: z.string().min(1),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    notes: z.string().optional(),
    inventoryItemId: z.string().uuid().optional(),
  })).default([]),
});

const updateRecipeSchema = createRecipeSchema.partial();

const createMealPlanSchema = z.object({
  recipeId: z.string().uuid(),
  plannedDate: z.coerce.date(),
  mealType: mealTypeSchema,
});

export async function recipesRoutes(app: FastifyInstance): Promise<void> {
  // List recipes with optional search/filter
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { search, tags, page = '1', limit = '20' } = request.query as any;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const conditions = [eq(recipes.householdId, request.user!.householdId)];

      // Search in title and description
      if (search) {
        conditions.push(
          sql`to_tsvector('english', ${recipes.title} || ' ' || COALESCE(${recipes.description}, '')) @@ plainto_tsquery('english', ${search})`
        );
      }

      const recipeList = await db.query.recipes.findMany({
        where: and(...conditions),
        limit: parseInt(limit),
        offset,
        orderBy: (r, { desc }) => [desc(r.createdAt)],
      });

      // Filter by tags in memory if needed (TODO: optimize with proper query)
      let filtered = recipeList;
      if (tags) {
        const tagList = tags.split(',');
        filtered = recipeList.filter((r) =>
          tagList.every((tag: string) => (r.tags as string[]).includes(tag))
        );
      }

      return { success: true, data: { recipes: filtered } };
    }
  );

  // Create recipe
  app.post(
    '/',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createRecipeSchema.parse(request.body);
      const { ingredients, ...recipeData } = input;

      const [recipe] = await db
        .insert(recipes)
        .values({
          householdId: request.user!.householdId,
          createdBy: request.user!.id,
          ...recipeData,
        })
        .returning();

      // Insert ingredients
      if (ingredients.length > 0) {
        await db.insert(recipeIngredients).values(
          ingredients.map((ing) => ({
            recipeId: recipe.id,
            name: ing.name,
            quantity: ing.quantity?.toString(),
            unit: ing.unit,
            notes: ing.notes,
            inventoryItemId: ing.inventoryItemId,
          }))
        );
      }

      return { success: true, data: { recipe } };
    }
  );

  // Get recipe by ID with ingredients
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const recipe = await db.query.recipes.findFirst({
        where: and(
          eq(recipes.id, request.params.id),
          eq(recipes.householdId, request.user!.householdId)
        ),
      });

      if (!recipe) {
        throw Errors.notFound('Recipe');
      }

      const ingredients = await db.query.recipeIngredients.findMany({
        where: eq(recipeIngredients.recipeId, recipe.id),
      });

      return { success: true, data: { recipe, ingredients } };
    }
  );

  // Update recipe
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = updateRecipeSchema.parse(request.body);
      const { ingredients, ...recipeData } = input;

      const [updated] = await db
        .update(recipes)
        .set({ ...recipeData, updatedAt: new Date() })
        .where(
          and(
            eq(recipes.id, request.params.id),
            eq(recipes.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Recipe');
      }

      // Update ingredients if provided
      if (ingredients) {
        // Delete existing and insert new
        await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, request.params.id));
        if (ingredients.length > 0) {
          await db.insert(recipeIngredients).values(
            ingredients.map((ing) => ({
              recipeId: request.params.id,
              name: ing.name,
              quantity: ing.quantity?.toString(),
              unit: ing.unit,
              notes: ing.notes,
              inventoryItemId: ing.inventoryItemId,
            }))
          );
        }
      }

      return { success: true, data: { recipe: updated } };
    }
  );

  // Delete recipe
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(recipes)
        .where(
          and(
            eq(recipes.id, request.params.id),
            eq(recipes.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Recipe deleted' } };
    }
  );

  // Get all tags
  app.get(
    '/tags',
    { preHandler: [authMiddleware] },
    async (request) => {
      const recipeList = await db.query.recipes.findMany({
        where: eq(recipes.householdId, request.user!.householdId),
        columns: { tags: true },
      });

      // Aggregate tags with counts
      const tagCounts: Record<string, number> = {};
      for (const recipe of recipeList) {
        for (const tag of (recipe.tags as string[]) || []) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }

      const tags = Object.entries(tagCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      return { success: true, data: { tags } };
    }
  );

  // Start cooking session
  app.post<{ Params: { id: string } }>(
    '/:id/cook',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { servingsMultiplier = 1 } = z
        .object({ servingsMultiplier: z.number().positive().default(1) })
        .parse(request.body || {});

      const [session] = await db
        .insert(activeCookingSessions)
        .values({
          recipeId: request.params.id,
          userId: request.user!.id,
          deviceId: request.user!.deviceId,
          servingsMultiplier: servingsMultiplier.toString(),
        })
        .returning();

      return { success: true, data: { session } };
    }
  );

  // Get cooking session
  app.get<{ Params: { sessionId: string } }>(
    '/cooking/:sessionId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const session = await db.query.activeCookingSessions.findFirst({
        where: eq(activeCookingSessions.id, request.params.sessionId),
      });

      if (!session) {
        throw Errors.notFound('Cooking session');
      }

      return { success: true, data: { session } };
    }
  );

  // Finish cooking (and optionally deduct inventory)
  app.post<{ Params: { id: string } }>(
    '/:id/finish',
    { preHandler: [authMiddleware] },
    async (request) => {
      const finishSchema = z.object({
        sessionId: z.string().uuid().optional(),
        deductInventory: z.boolean().default(true),
        adjustments: z.array(z.object({
          ingredientId: z.string().uuid(),
          actualQuantityUsed: z.number().nonnegative(),
          skipDeduction: z.boolean().optional(),
        })).optional(),
      });

      const { sessionId, deductInventory, adjustments } = finishSchema.parse(request.body || {});

      const deductionWarnings: string[] = [];
      const deductedItems: Array<{ itemName: string; quantity: number; unit?: string }> = [];

      // Get the recipe and its ingredients
      const recipe = await db.query.recipes.findFirst({
        where: and(
          eq(recipes.id, request.params.id),
          eq(recipes.householdId, request.user!.householdId)
        ),
      });

      if (!recipe) {
        throw Errors.notFound('Recipe');
      }

      // Get cooking session for servings multiplier
      let servingsMultiplier = 1;
      if (sessionId) {
        const session = await db.query.activeCookingSessions.findFirst({
          where: eq(activeCookingSessions.id, sessionId),
        });
        if (session) {
          servingsMultiplier = parseFloat(session.servingsMultiplier || '1');
        }
      }

      // Deduct inventory if requested
      if (deductInventory) {
        const ingredients = await db.query.recipeIngredients.findMany({
          where: eq(recipeIngredients.recipeId, request.params.id),
        });

        for (const ingredient of ingredients) {
          // Skip if no inventory link
          if (!ingredient.inventoryItemId) continue;

          // Check for adjustment
          const adjustment = adjustments?.find(a => a.ingredientId === ingredient.id);
          if (adjustment?.skipDeduction) continue;

          // Get the inventory item for unit conversion info
          const item = await db.query.inventoryItems.findFirst({
            where: eq(inventoryItems.id, ingredient.inventoryItemId),
          });

          if (!item) continue;

          // Calculate quantity to deduct
          let quantityToDeduct = adjustment?.actualQuantityUsed
            ?? (parseFloat(ingredient.quantity || '0') * servingsMultiplier);

          if (quantityToDeduct <= 0) continue;

          // Get stock entries for this item, ordered by expiry date (FIFO)
          const stockEntries = await db.query.inventoryStock.findMany({
            where: eq(inventoryStock.itemId, ingredient.inventoryItemId),
            orderBy: (s, { asc }) => [asc(s.expiryDate), asc(s.addedAt)],
          });

          let remaining = quantityToDeduct;

          for (const stock of stockEntries) {
            if (remaining <= 0) break;

            const stockQty = parseFloat(stock.quantity);

            // Handle unit conversion if needed
            let convertedRemaining = remaining;
            if (ingredient.unit && stock.unit && ingredient.unit !== stock.unit) {
              const conversions = (item.unitConversions as UnitConversion[]) || [];
              const conversion = conversions.find(
                c => c.fromUnit === ingredient.unit && c.toUnit === stock.unit
              );
              if (conversion) {
                convertedRemaining = remaining * conversion.factor;
              }
            }

            if (stockQty <= convertedRemaining) {
              // Delete this stock entry entirely
              await db.delete(inventoryStock).where(eq(inventoryStock.id, stock.id));
              remaining -= stockQty;
            } else {
              // Reduce the stock quantity
              await db
                .update(inventoryStock)
                .set({
                  quantity: (stockQty - convertedRemaining).toString(),
                  updatedAt: new Date(),
                })
                .where(eq(inventoryStock.id, stock.id));
              remaining = 0;
            }
          }

          deductedItems.push({
            itemName: item.name,
            quantity: quantityToDeduct - remaining,
            unit: ingredient.unit || item.defaultUnit || undefined,
          });

          if (remaining > 0) {
            deductionWarnings.push(
              `Insufficient stock for ${item.name}: needed ${quantityToDeduct}, only had ${quantityToDeduct - remaining}`
            );
          }
        }
      }

      // Delete the cooking session
      if (sessionId) {
        await db.delete(activeCookingSessions).where(eq(activeCookingSessions.id, sessionId));
      }

      // Emit websocket event for inventory deductions
      if (deductedItems.length > 0) {
        emitCookingDeduction(request.user!.householdId, {
          recipeId: request.params.id,
          recipeName: recipe.title,
          sessionId,
          deductedItems: deductedItems.map(item => ({
            itemId: '', // We don't track individual item IDs in the deduction
            itemName: item.itemName,
            quantity: item.quantity,
            unit: item.unit,
          })),
          warnings: deductionWarnings.length > 0 ? deductionWarnings : undefined,
        });
      }

      return {
        success: true,
        data: {
          message: 'Cooking finished',
          deductedItems,
          warnings: deductionWarnings.length > 0 ? deductionWarnings : undefined,
        },
      };
    }
  );

  // ===== RECIPE IMPORT =====

  // Start import session
  app.post(
    '/import/start',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        sourceType: z.enum(['url', 'image', 'pdf']),
        sourceData: z.string(), // URL or base64 encoded content
        rawText: z.string().optional(), // For pre-extracted text
      });

      const { sourceType, sourceData, rawText } = schema.parse(request.body);

      const sessionId = await createImportSession(
        request.user!.householdId,
        request.user!.id,
        sourceType,
        sourceData
      );

      // If raw text is provided, process immediately
      if (rawText) {
        await processImportSession(sessionId, rawText, request.user!.householdId);
      }

      return { success: true, data: { sessionId } };
    }
  );

  // Get import session with parsed recipe and matches
  app.get<{ Params: { sessionId: string } }>(
    '/import/:sessionId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const session = await getImportSession(
        request.params.sessionId,
        request.user!.householdId
      );

      return { success: true, data: { session } };
    }
  );

  // Update ingredient matches
  app.post<{ Params: { sessionId: string } }>(
    '/import/:sessionId/match',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        updates: z.array(z.object({
          parsedName: z.string(),
          matchedItemId: z.string().uuid().optional(),
          matchedItemName: z.string().optional(),
        })),
      });

      const { updates } = schema.parse(request.body);

      await updateIngredientMatches(
        request.params.sessionId,
        request.user!.householdId,
        updates
      );

      return { success: true, data: { message: 'Matches updated' } };
    }
  );

  // Confirm import and create recipe
  app.post<{ Params: { sessionId: string } }>(
    '/import/:sessionId/confirm',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        prepTimeMinutes: z.number().int().positive().optional(),
        cookTimeMinutes: z.number().int().positive().optional(),
        servings: z.number().int().positive().optional(),
        imageUrl: z.string().url().optional(),
      });

      const overrides = schema.parse(request.body || {});

      const recipeId = await confirmImportSession(
        request.params.sessionId,
        request.user!.householdId,
        request.user!.id,
        overrides
      );

      return { success: true, data: { recipeId } };
    }
  );

  // Cancel import session
  app.delete<{ Params: { sessionId: string } }>(
    '/import/:sessionId',
    { preHandler: [authMiddleware] },
    async (request) => {
      await cancelImportSession(
        request.params.sessionId,
        request.user!.householdId
      );

      return { success: true, data: { message: 'Import cancelled' } };
    }
  );

  // Match a single ingredient name
  app.post(
    '/ingredients/match',
    { preHandler: [authMiddleware] },
    async (request) => {
      const schema = z.object({
        name: z.string().min(1),
        unit: z.string().optional(),
      });

      const { name, unit } = schema.parse(request.body);

      const suggestions = await matchSingleIngredient(
        name,
        request.user!.householdId,
        unit
      );

      return { success: true, data: { suggestions } };
    }
  );

  // ===== MEAL PLAN SHOPPING LIST GENERATION =====

  // Preview shopping list from meal plans (without adding)
  app.post(
    '/meal-plans/preview-shopping-list',
    { preHandler: [authMiddleware] },
    async (request) => {
      const schema = z.object({
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        checkInventory: z.boolean().default(true),
        servingsMultiplier: z.number().positive().default(1),
      });

      const { startDate, endDate, checkInventory, servingsMultiplier } = schema.parse(request.body);

      const result = await generateShoppingListFromMealPlans(
        request.user!.householdId,
        startDate,
        endDate,
        checkInventory,
        servingsMultiplier
      );

      return { success: true, data: result };
    }
  );

  // Generate and add shopping list items from meal plans
  app.post(
    '/meal-plans/generate-shopping-list',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        checkInventory: z.boolean().default(true),
        servingsMultiplier: z.number().positive().default(1),
      });

      const { startDate, endDate, checkInventory, servingsMultiplier } = schema.parse(request.body);

      const result = await generateShoppingListFromMealPlans(
        request.user!.householdId,
        startDate,
        endDate,
        checkInventory,
        servingsMultiplier
      );

      // Add items to shopping list
      const addedItems = [];
      for (const item of result.items) {
        // Check if already on shopping list
        const existing = await db.query.shoppingList.findFirst({
          where: and(
            eq(shoppingList.householdId, request.user!.householdId),
            eq(shoppingList.isChecked, false),
            item.inventoryItemId
              ? eq(shoppingList.itemId, item.inventoryItemId)
              : eq(shoppingList.customName, item.name)
          ),
        });

        if (existing) {
          // Merge quantities
          const existingQty = parseFloat(existing.quantity || '0');
          await db
            .update(shoppingList)
            .set({
              quantity: (existingQty + item.quantity).toString(),
              updatedAt: new Date(),
            })
            .where(eq(shoppingList.id, existing.id));
        } else {
          // Add new item
          const [added] = await db
            .insert(shoppingList)
            .values({
              householdId: request.user!.householdId,
              itemId: item.inventoryItemId,
              customName: item.inventoryItemId ? undefined : item.name,
              quantity: item.quantity.toString(),
              unit: item.unit,
              addedBy: request.user!.id,
              source: 'meal_plan',
            })
            .returning();

          addedItems.push(added);
        }
      }

      return {
        success: true,
        data: {
          addedCount: addedItems.length,
          mergedCount: result.items.length - addedItems.length,
          items: result.items,
        },
      };
    }
  );

  // Meal plans
  app.get(
    '/meal-plans',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { start, end } = z
        .object({
          start: z.coerce.date().optional(),
          end: z.coerce.date().optional(),
        })
        .parse(request.query);

      const conditions = [eq(mealPlans.householdId, request.user!.householdId)];

      // Filter by date range in memory for simplicity
      const plans = await db.query.mealPlans.findMany({
        where: and(...conditions),
        orderBy: (p, { asc }) => [asc(p.plannedDate)],
      });

      return { success: true, data: { mealPlans: plans } };
    }
  );

  app.post(
    '/meal-plans',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createMealPlanSchema.parse(request.body);

      const [plan] = await db
        .insert(mealPlans)
        .values({
          householdId: request.user!.householdId,
          recipeId: input.recipeId,
          plannedDate: input.plannedDate.toISOString().split('T')[0],
          mealType: input.mealType,
        })
        .returning();

      return { success: true, data: { mealPlan: plan } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/meal-plans/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(mealPlans)
        .where(
          and(
            eq(mealPlans.id, request.params.id),
            eq(mealPlans.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Meal plan removed' } };
    }
  );
}

// Helper function to generate shopping list from meal plans
async function generateShoppingListFromMealPlans(
  householdId: string,
  startDate: Date,
  endDate: Date,
  checkInventory: boolean,
  servingsMultiplier: number
): Promise<{
  items: Array<{
    name: string;
    quantity: number;
    unit?: string;
    inventoryItemId?: string;
    recipes: string[];
  }>;
  inventoryDeductions: Array<{
    name: string;
    deducted: number;
    unit?: string;
  }>;
}> {
  // Get meal plans in date range
  const plans = await db.query.mealPlans.findMany({
    where: and(
      eq(mealPlans.householdId, householdId),
      gte(mealPlans.plannedDate, startDate.toISOString().split('T')[0]),
      lte(mealPlans.plannedDate, endDate.toISOString().split('T')[0])
    ),
  });

  // Get unique recipe IDs
  const recipeIds = [...new Set(plans.map(p => p.recipeId))];

  // Aggregate ingredients across all recipes
  const aggregated = new Map<string, {
    name: string;
    quantity: number;
    unit?: string;
    inventoryItemId?: string;
    recipes: Set<string>;
  }>();

  for (const recipeId of recipeIds) {
    const recipe = await db.query.recipes.findFirst({
      where: eq(recipes.id, recipeId),
    });

    if (!recipe) continue;

    const ingredients = await db.query.recipeIngredients.findMany({
      where: eq(recipeIngredients.recipeId, recipeId),
    });

    // Count how many times this recipe appears in the date range
    const recipeCount = plans.filter(p => p.recipeId === recipeId).length;

    for (const ing of ingredients) {
      const key = ing.inventoryItemId || ing.name.toLowerCase();
      const quantity = (parseFloat(ing.quantity || '0') * servingsMultiplier * recipeCount);

      if (aggregated.has(key)) {
        const existing = aggregated.get(key)!;
        existing.quantity += quantity;
        existing.recipes.add(recipe.title);
      } else {
        aggregated.set(key, {
          name: ing.name,
          quantity,
          unit: ing.unit || undefined,
          inventoryItemId: ing.inventoryItemId || undefined,
          recipes: new Set([recipe.title]),
        });
      }
    }
  }

  const inventoryDeductions: Array<{ name: string; deducted: number; unit?: string }> = [];

  // Subtract current inventory if requested
  if (checkInventory) {
    for (const [key, item] of aggregated.entries()) {
      if (item.inventoryItemId) {
        // Get current stock for this item
        const stockEntries = await db.query.inventoryStock.findMany({
          where: eq(inventoryStock.itemId, item.inventoryItemId),
        });

        const totalStock = stockEntries.reduce(
          (sum, s) => sum + parseFloat(s.quantity),
          0
        );

        if (totalStock > 0) {
          const deducted = Math.min(totalStock, item.quantity);
          item.quantity = Math.max(0, item.quantity - totalStock);

          if (deducted > 0) {
            inventoryDeductions.push({
              name: item.name,
              deducted,
              unit: item.unit,
            });
          }
        }
      }
    }
  }

  // Convert to array and filter out zero quantities
  const items = Array.from(aggregated.values())
    .filter(item => item.quantity > 0)
    .map(item => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      inventoryItemId: item.inventoryItemId,
      recipes: Array.from(item.recipes),
    }));

  return { items, inventoryDeductions };
}

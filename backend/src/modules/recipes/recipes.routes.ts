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
  households,
} from '../../db/schema/index.js';
import { eq, and, sql, gt, gte, lte, asc, isNotNull } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { requireRecipesAccess, requireMealPlanAccess } from '../../middleware/permission.middleware.js';
import { Errors } from '../../lib/errors.js';
import { mealTypeSchema } from '../../lib/validators.js';
import {
  createImportSession,
  processImportSession,
  processUrlImportSession,
  getImportSession,
  updateIngredientMatches,
  confirmImportSession,
  cancelImportSession,
  parseRecipeText,
  parseRecipeTextWithConfidence,
  rematchIngredients,
} from './recipe-import.service.js';
import { parseRecipeFromUrl } from './url-parser.service.js';
import { processRecipeImage, fetchImageFromUrl } from './recipe-image.service.js';
import { convertWithDensity, normalizeUnit, type QuantityUnitSizes } from '../../lib/unit-conversions.js';
import { matchSingleIngredient } from './ingredient-matching.service.js';
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
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  mealType: mealTypeSchema,
  servingsMultiplier: z.number().min(0.5).max(10).optional(),
});

export async function recipesRoutes(app: FastifyInstance): Promise<void> {
  // List recipes with optional search/filter
  app.get(
    '/',
    { preHandler: [authMiddleware, requireRecipesAccess('view')] },
    async (request) => {
      const { search, tags, page = '1', limit = '20' } = request.query as any;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const conditions = [eq(recipes.householdId, request.user!.householdId)];

      // Search in title, description, and tags (partial, case-insensitive)
      if (search) {
        const searchPattern = `%${search}%`;
        conditions.push(
          sql`(
            ${recipes.title} ILIKE ${searchPattern}
            OR ${recipes.description} ILIKE ${searchPattern}
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(${recipes.tags}) AS tag
              WHERE tag ILIKE ${searchPattern}
            )
          )`
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
    { preHandler: [authMiddleware, requireRecipesAccess('edit')] },
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

      // No per-item permissions for recipes - feature-level only

      return { success: true, data: { recipe } };
    }
  );

  // Get tag suggestions (predefined + used tags)
  app.get(
    '/tags/suggestions',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { search } = request.query as { search?: string };

      // Predefined common recipe tags
      const predefinedTags = [
        'breakfast',
        'lunch',
        'dinner',
        'snack',
        'dessert',
        'appetizer',
        'side dish',
        'main course',
        'vegetarian',
        'vegan',
        'gluten-free',
        'dairy-free',
        'low-carb',
        'keto',
        'paleo',
        'healthy',
        'quick',
        'easy',
        'comfort food',
        'soup',
        'salad',
        'pasta',
        'chicken',
        'beef',
        'pork',
        'seafood',
        'fish',
        'asian',
        'mexican',
        'italian',
        'american',
        'mediterranean',
        'indian',
        'thai',
        'japanese',
        'chinese',
        'french',
        'greek',
        'bbq',
        'grilled',
        'baked',
        'fried',
        'slow cooker',
        'instant pot',
        'one pot',
        'meal prep',
        'budget friendly',
        'kid friendly',
        'holiday',
        'summer',
        'winter',
        'fall',
        'spring',
      ];

      // Get all tags used in household recipes
      const householdRecipes = await db.query.recipes.findMany({
        where: eq(recipes.householdId, request.user!.householdId),
        columns: { tags: true },
      });

      // Count tag usage
      const tagCounts = new Map<string, number>();

      // Initialize predefined tags with count 0
      for (const tag of predefinedTags) {
        tagCounts.set(tag.toLowerCase(), 0);
      }

      // Count actual usage
      for (const recipe of householdRecipes) {
        const recipeTags = recipe.tags as string[] | null;
        if (recipeTags) {
          for (const tag of recipeTags) {
            const lowerTag = tag.toLowerCase();
            tagCounts.set(lowerTag, (tagCounts.get(lowerTag) || 0) + 1);
          }
        }
      }

      // Convert to array and sort by count (most used first), then alphabetically
      let suggestions = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.tag.localeCompare(b.tag);
        });

      // Filter by search if provided
      if (search) {
        const searchLower = search.toLowerCase();
        suggestions = suggestions.filter((s) => s.tag.includes(searchLower));
      }

      return {
        success: true,
        data: {
          suggestions: suggestions.slice(0, 20),
          predefinedTags,
        }
      };
    }
  );

  // Get ingredient availability for all recipes (for "Can make now" filter)
  app.get(
    '/availability',
    { preHandler: [authMiddleware, requireRecipesAccess('view')] },
    async (request) => {
      // Get all recipe IDs and their ingredient counts
      const allRecipeIngredientRows = await db
        .select({
          recipeId: recipeIngredients.recipeId,
          inventoryItemId: recipeIngredients.inventoryItemId,
        })
        .from(recipeIngredients)
        .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
        .where(eq(recipes.householdId, request.user!.householdId));

      // Get all stocked item IDs
      const stockEntries = await db
        .select({ itemId: inventoryStock.itemId })
        .from(inventoryStock)
        .innerJoin(inventoryItems, eq(inventoryStock.itemId, inventoryItems.id))
        .where(
          and(
            eq(inventoryItems.householdId, request.user!.householdId),
            gt(inventoryStock.quantity, '0')
          )
        );
      const stockedIds = new Set(stockEntries.map(e => e.itemId));

      // Calculate per-recipe availability
      const recipeAvailability: Record<string, { total: number; have: number }> = {};
      for (const row of allRecipeIngredientRows) {
        if (!recipeAvailability[row.recipeId]) {
          recipeAvailability[row.recipeId] = { total: 0, have: 0 };
        }
        recipeAvailability[row.recipeId].total++;
        if (row.inventoryItemId && stockedIds.has(row.inventoryItemId)) {
          recipeAvailability[row.recipeId].have++;
        }
      }

      return { success: true, data: { availability: recipeAvailability } };
    }
  );

  // Suggest item names for unmatched ingredients (for quick catalog creation)
  app.post(
    '/ingredients/suggest-items',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        ingredientNames: z.array(z.string()),
      });
      const { ingredientNames } = schema.parse(request.body);

      const { simplifyIngredientNames, detectCategory, findSimilarItemName } =
        await import('../../services/ingredient-name-utils.js');

      // Get existing item names for duplicate detection
      const existingItems = await db.query.inventoryItems.findMany({
        where: eq(inventoryItems.householdId, request.user!.householdId),
        columns: { name: true },
      });
      const existingNames = existingItems.map(i => i.name);

      // Simplify names using CRF
      const simplifiedNames = await simplifyIngredientNames(ingredientNames);

      // Build suggestions with category and duplicate warnings
      const suggestions = ingredientNames.map((original, i) => {
        const suggested = simplifiedNames[i];
        const category = detectCategory(original) || detectCategory(suggested);
        const similarTo = findSimilarItemName(suggested, existingNames);

        return {
          originalName: original,
          suggestedName: suggested,
          category: category || undefined,
          similarExisting: similarTo || undefined,
        };
      });

      return { success: true, data: { suggestions } };
    }
  );

  // Link a recipe ingredient to an inventory item
  app.patch<{ Params: { id: string; ingredientId: string } }>(
    '/:id/ingredients/:ingredientId/link',
    { preHandler: [authMiddleware, requireRecipesAccess('edit')] },
    async (request) => {
      const schema = z.object({
        inventoryItemId: z.string().uuid().nullable(),
      });
      const { inventoryItemId } = schema.parse(request.body);

      await db
        .update(recipeIngredients)
        .set({ inventoryItemId })
        .where(
          and(
            eq(recipeIngredients.id, request.params.ingredientId),
            eq(recipeIngredients.recipeId, request.params.id)
          )
        );

      return { success: true, data: { message: 'Ingredient linked' } };
    }
  );

  // Get recipe by ID with ingredients
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireRecipesAccess('view')] },
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

      // Get ingredients with linked inventory item names
      const ingredientRows = await db
        .select({
          id: recipeIngredients.id,
          recipeId: recipeIngredients.recipeId,
          inventoryItemId: recipeIngredients.inventoryItemId,
          name: recipeIngredients.name,
          quantity: recipeIngredients.quantity,
          unit: recipeIngredients.unit,
          notes: recipeIngredients.notes,
          groupName: recipeIngredients.groupName,
          linkedItemName: inventoryItems.name,
        })
        .from(recipeIngredients)
        .leftJoin(inventoryItems, eq(recipeIngredients.inventoryItemId, inventoryItems.id))
        .where(eq(recipeIngredients.recipeId, recipe.id));

      return { success: true, data: { recipe, ingredients: ingredientRows } };
    }
  );

  // Update recipe
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireRecipesAccess('edit')] },
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
    { preHandler: [authMiddleware, requireRecipesAccess('admin')] },
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

  // Upload recipe image (multipart file or URL)
  app.post<{ Params: { id: string } }>(
    '/:id/image',
    { preHandler: [authMiddleware, requireRecipesAccess('edit')] },
    async (request) => {
      // Verify recipe exists and belongs to household
      const recipe = await db.query.recipes.findFirst({
        where: and(
          eq(recipes.id, request.params.id),
          eq(recipes.householdId, request.user!.householdId)
        ),
      });

      if (!recipe) {
        throw Errors.notFound('Recipe');
      }

      let imageBuffer: Buffer;

      // Check if this is a multipart request
      const contentType = request.headers['content-type'] || '';
      if (contentType.includes('multipart/form-data')) {
        // Handle file upload
        const data = await request.file();
        if (!data) {
          throw Errors.badRequest('No file uploaded');
        }
        imageBuffer = await data.toBuffer();
      } else {
        // Handle JSON request with imageUrl
        const schema = z.object({
          imageUrl: z.string().url(),
        });
        const { imageUrl } = schema.parse(request.body);

        try {
          imageBuffer = await fetchImageFromUrl(imageUrl);
        } catch (error) {
          throw Errors.badRequest(error instanceof Error ? error.message : 'Failed to fetch image from URL');
        }
      }

      // Process the image
      try {
        const processed = await processRecipeImage(imageBuffer);

        // Update the recipe with the processed image
        const [updated] = await db
          .update(recipes)
          .set({
            imageData: processed.data,
            imageMimeType: processed.mimeType,
            imageWidth: processed.width,
            imageHeight: processed.height,
            updatedAt: new Date(),
          })
          .where(eq(recipes.id, request.params.id))
          .returning();

        return {
          success: true,
          data: {
            imageData: processed.data,
            imageMimeType: processed.mimeType,
            imageWidth: processed.width,
            imageHeight: processed.height,
          },
        };
      } catch (error) {
        throw Errors.badRequest(error instanceof Error ? error.message : 'Failed to process image');
      }
    }
  );

  // Delete recipe image
  app.delete<{ Params: { id: string } }>(
    '/:id/image',
    { preHandler: [authMiddleware, requireRecipesAccess('edit')] },
    async (request) => {
      const [updated] = await db
        .update(recipes)
        .set({
          imageData: null,
          imageMimeType: null,
          imageWidth: null,
          imageHeight: null,
          updatedAt: new Date(),
        })
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

      return { success: true, data: { message: 'Recipe image deleted' } };
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

  // Get recipe cost estimate from ingredient price history
  app.get<{ Params: { id: string } }>(
    '/:id/cost-estimate',
    { preHandler: [authMiddleware] },
    async (request) => {
      const recipe = await db.query.recipes.findFirst({
        where: and(
          eq(recipes.id, request.params.id),
          eq(recipes.householdId, request.user!.householdId)
        ),
      });
      if (!recipe) throw Errors.notFound('Recipe');

      const ingredients = await db.query.recipeIngredients.findMany({
        where: eq(recipeIngredients.recipeId, request.params.id),
      });

      let totalCost = 0;
      let ingredientsWithPrice = 0;
      let ingredientsWithoutPrice = 0;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      for (const ing of ingredients) {
        if (!ing.inventoryItemId) {
          ingredientsWithoutPrice++;
          continue;
        }

        // Get the most recent stock entry with a price for this item
        const recentPricedStock = await db
          .select()
          .from(inventoryStock)
          .where(and(
            eq(inventoryStock.itemId, ing.inventoryItemId),
            isNotNull(inventoryStock.pricePerUnit),
            gte(inventoryStock.addedAt, thirtyDaysAgo),
          ))
          .orderBy(inventoryStock.addedAt)
          .limit(1);

        if (recentPricedStock.length > 0 && recentPricedStock[0].pricePerUnit) {
          const pricePerUnit = parseFloat(recentPricedStock[0].pricePerUnit);
          const qty = ing.quantity ? parseFloat(ing.quantity) : 1;
          totalCost += pricePerUnit * qty;
          ingredientsWithPrice++;
        } else {
          ingredientsWithoutPrice++;
        }
      }

      const totalIngredients = ingredientsWithPrice + ingredientsWithoutPrice;
      const completeness = totalIngredients > 0
        ? ingredientsWithPrice / totalIngredients
        : 0;

      // Only show cost if most ingredients have prices (>= 60% coverage)
      const showCost = completeness >= 0.6;
      const servings = recipe.servings || 1;

      return {
        success: true,
        data: {
          totalCost: showCost ? Math.round(totalCost * 100) / 100 : null,
          costPerServing: showCost ? Math.round((totalCost / servings) * 100) / 100 : null,
          servings,
          ingredientsWithPrice,
          ingredientsWithoutPrice,
          totalIngredients,
          completeness: Math.round(completeness * 100),
          sufficient: showCost,
        },
      };
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
        mealPlanId: z.string().uuid().optional(),
        deductInventory: z.boolean().default(true),
        adjustments: z.array(z.object({
          ingredientId: z.string().uuid(),
          actualQuantityUsed: z.number().nonnegative(),
          skipDeduction: z.boolean().optional(),
        })).optional(),
      });

      const { sessionId, mealPlanId, deductInventory, adjustments } = finishSchema.parse(request.body || {});

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

      // Deduct inventory if requested. Wrapped in a transaction with
      // SELECT FOR UPDATE on each item's stock rows so two concurrent
      // cook-finish requests for the same item can't both plan against
      // the same tranches and over-deplete. The second transaction blocks
      // until the first commits.
      if (deductInventory) {
        await db.transaction(async (tx) => {
        const ingredients = await tx.query.recipeIngredients.findMany({
          where: eq(recipeIngredients.recipeId, request.params.id),
        });

        for (const ingredient of ingredients) {
          // Skip if no inventory link
          if (!ingredient.inventoryItemId) continue;

          // Check for adjustment
          const adjustment = adjustments?.find(a => a.ingredientId === ingredient.id);
          if (adjustment?.skipDeduction) continue;

          // Get the inventory item for unit conversion info
          const item = await tx.query.inventoryItems.findFirst({
            where: eq(inventoryItems.id, ingredient.inventoryItemId),
          });

          if (!item) continue;

          // Calculate quantity to deduct
          let quantityToDeduct = adjustment?.actualQuantityUsed
            ?? (parseFloat(ingredient.quantity || '0') * servingsMultiplier);

          if (quantityToDeduct <= 0) continue;

          // Get stock entries for this item with row-level locks, ordered by
          // expiry date (FIFO). The lock is held until the transaction
          // commits, so a concurrent cook finishing the same recipe can't
          // see the same rows and double-deduct.
          const stockEntries = await tx
            .select()
            .from(inventoryStock)
            .where(eq(inventoryStock.itemId, ingredient.inventoryItemId))
            .orderBy(asc(inventoryStock.expiryDate), asc(inventoryStock.addedAt))
            .for('update');

          let remaining = quantityToDeduct;

          const density = item.density ? parseFloat(item.density) : null;
          const quantityUnitSizes = (item.quantityUnitSizes as QuantityUnitSizes) || {};

          for (const stock of stockEntries) {
            if (remaining <= 0) break;

            const stockQty = parseFloat(stock.quantity);
            const unitsDiffer =
              !!ingredient.unit &&
              !!stock.unit &&
              normalizeUnit(ingredient.unit) !== normalizeUnit(stock.unit);

            // Pre-compute the two directions we may need. If either side can't
            // convert, we can't safely touch this stock entry — bail out
            // rather than mix units in arithmetic.
            let convertedRemaining = remaining;
            let stockInIngredientUnit = stockQty;
            if (unitsDiffer) {
              const forward = convertWithDensity(remaining, ingredient.unit!, stock.unit!, density, quantityUnitSizes);
              const back = convertWithDensity(stockQty, stock.unit!, ingredient.unit!, density, quantityUnitSizes);
              if (forward === null || back === null) {
                // Can't bridge — leave the stock entry alone and flag the
                // item so the user can supply the missing conversion. We
                // still log nothing here and let needsConversion surface in
                // the UI; the cook completes with under-deducted inventory.
                if (!item.needsConversion) {
                  await tx
                    .update(inventoryItems)
                    .set({ needsConversion: true, updatedAt: new Date() })
                    .where(eq(inventoryItems.id, item.id));
                }
                continue;
              }
              convertedRemaining = forward;
              stockInIngredientUnit = back;
            }

            if (stockQty <= convertedRemaining) {
              // Consume this stock entry whole. Reduce `remaining`
              // (ingredient unit) by the stock's equivalent in ingredient unit.
              await tx.delete(inventoryStock).where(eq(inventoryStock.id, stock.id));
              remaining = Math.max(0, remaining - stockInIngredientUnit);
            } else {
              // Partial consumption: reduce stock by the converted amount.
              await tx
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
        }); // end transaction
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

      // Mark meal plan entry as cooked
      if (mealPlanId) {
        await db
          .update(mealPlans)
          .set({ cookedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(mealPlans.id, mealPlanId),
              eq(mealPlans.householdId, request.user!.householdId)
            )
          );
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

  // Report which optional parsing providers are available so the UI can
  // warn users when LLM/CRF/OCR fallbacks aren't configured.
  app.get(
    '/import/status',
    { preHandler: [authMiddleware, requireMember()] },
    async () => {
      const [{ getLLMProvider }, { isCRFParserAvailable }, { getAllProvidersStatus }] = await Promise.all([
        import('../../services/llm-provider.js'),
        import('../../services/crf-ingredient-parser.js'),
        import('../image-parse/ai-providers/index.js'),
      ]);

      const llm = getLLMProvider();
      const [crfAvailable, imageStatus] = await Promise.all([
        isCRFParserAvailable(),
        getAllProvidersStatus(),
      ]);

      return {
        success: true,
        data: {
          llm: {
            available: !!llm,
            provider: llm?.name ?? null,
          },
          crf: {
            available: crfAvailable,
          },
          image: imageStatus,
        },
      };
    }
  );

  // Preview URL parsing without creating session
  app.post(
    '/import/parse-url',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        url: z.string().url(),
      });

      const { url } = schema.parse(request.body);

      try {
        const result = await parseRecipeFromUrl(url);
        return {
          success: true,
          data: {
            parsedRecipe: result.parsedRecipe,
            parseMethod: result.parseMethod,
            confidence: result.confidence,
            warnings: result.warnings,
          },
        };
      } catch (error) {
        throw Errors.badRequest(error instanceof Error ? error.message : 'Failed to parse URL');
      }
    }
  );

  // Preview text parsing without creating session
  app.post(
    '/import/parse-text',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        text: z.string().min(1),
      });

      const { text } = schema.parse(request.body);

      const result = parseRecipeTextWithConfidence(text);

      // Run ingredient lines through CRF. parseRecipeText only returns raw
      // strings as ingredient names; this turns them into structured
      // ingredients before sending back to the client. If CRF is down, we
      // surface a warning rather than silently regex-parsing.
      let parseMethod: 'text' | 'crf' = 'text';
      const warnings = [...result.warnings];
      if (result.recipe.ingredients && result.recipe.ingredients.length > 0) {
        const { parseIngredientLinesViaCRF, INGREDIENT_PARSER_UNAVAILABLE_WARNING } =
          await import('./recipe-import.service.js');
        const rawLines = result.recipe.ingredients.map((i) => i.name);
        const outcome = await parseIngredientLinesViaCRF(rawLines);
        result.recipe.ingredients = outcome.ingredients;
        if (outcome.degraded) {
          warnings.push(INGREDIENT_PARSER_UNAVAILABLE_WARNING);
        } else {
          parseMethod = 'crf';
        }
      }

      return {
        success: true,
        data: {
          parsedRecipe: result.recipe,
          parseMethod,
          confidence: result.confidence,
          warnings,
        },
      };
    }
  );

  // Start import session
  app.post(
    '/import/start',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        sourceType: z.enum(['url', 'image', 'pdf', 'text']),
        sourceData: z.string(), // URL or base64 encoded content or text
        rawText: z.string().optional(), // For pre-extracted text (legacy)
      });

      const { sourceType, sourceData, rawText } = schema.parse(request.body);

      const sessionId = await createImportSession(
        request.user!.householdId,
        request.user!.id,
        sourceType,
        sourceData
      );

      // Process based on source type
      if (sourceType === 'url') {
        await processUrlImportSession(sessionId, sourceData, request.user!.householdId);
      } else if (sourceType === 'pdf') {
        // Extract text from PDF, then parse as text
        try {
          const { extractTextFromPDF } = await import('../../services/pdf-extraction.js');
          const pdfBuffer = Buffer.from(sourceData, 'base64');
          const extractedText = await extractTextFromPDF(pdfBuffer);
          await processImportSession(sessionId, extractedText, request.user!.householdId, 'pdf');
        } catch (err) {
          // If PDF extraction fails, try raw text if provided
          if (rawText) {
            await processImportSession(sessionId, rawText, request.user!.householdId, 'text');
          } else {
            throw Errors.validation('Failed to extract text from PDF');
          }
        }
      } else if (rawText || sourceType === 'text') {
        await processImportSession(sessionId, rawText || sourceData, request.user!.householdId, 'text');
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

  // Re-parse import session using LLM
  app.post<{ Params: { sessionId: string } }>(
    '/import/:sessionId/reparse-llm',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const session = await getImportSession(request.params.sessionId, request.user!.householdId);
      if (!session) throw Errors.notFound('Import session');

      const rawText = session.sourceData;
      if (!rawText) throw Errors.validation('No source text available for re-parsing');

      const { parseRecipeWithLLM, llmResultToImportFormat } = await import('../../services/llm-recipe-parser.js');
      const llmResult = await parseRecipeWithLLM(rawText);
      if (!llmResult) throw Errors.validation('LLM parsing failed — no provider available or text could not be parsed');

      const converted = llmResultToImportFormat(llmResult);
      const parsedRecipe = converted as any;

      // Re-match ingredients
      const matchResults = await matchIngredients(parsedRecipe.ingredients, request.user!.householdId);
      const ingredientMatches = matchResults.map(r => r.match);

      await db
        .update(recipeImportSessions)
        .set({
          parsedRecipe,
          ingredientMatches,
          parseMethod: 'llm',
          parseConfidence: '0.85',
          parseWarnings: [],
        })
        .where(eq(recipeImportSessions.id, request.params.sessionId));

      return {
        success: true,
        data: {
          parsedRecipe,
          ingredientMatches,
          parseMethod: 'llm',
          confidence: 0.85,
        },
      };
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
        ingredients: z.array(z.object({
          name: z.string(),
          quantity: z.number().optional(),
          unit: z.string().optional(),
          notes: z.string().optional(),
        })).optional(),
        instructions: z.array(z.string()).optional(),
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

  // Re-match ingredients after creating new items
  app.post<{ Params: { sessionId: string } }>(
    '/import/:sessionId/rematch',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const matches = await rematchIngredients(
        request.params.sessionId,
        request.user!.householdId
      );

      return { success: true, data: { matches } };
    }
  );

  // ===== BATCH IMPORT ENDPOINTS =====

  // Start batch import — parse multiple recipes at once
  app.post(
    '/import/start-batch',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        entries: z.array(z.object({
          sourceType: z.enum(['url', 'text']),
          sourceData: z.string(),
          rawText: z.string().optional(),
        })),
      });

      const { entries } = schema.parse(request.body);

      const sessionIds: string[] = [];

      for (const entry of entries) {
        const sessionId = await createImportSession(
          request.user!.householdId,
          request.user!.id,
          entry.sourceType,
          entry.sourceData
        );

        if (entry.sourceType === 'url') {
          await processUrlImportSession(sessionId, entry.sourceData, request.user!.householdId);
        } else {
          await processImportSession(sessionId, entry.rawText || entry.sourceData, request.user!.householdId, 'text');
        }

        sessionIds.push(sessionId);
      }

      return { success: true, data: { sessionIds } };
    }
  );

  // Rematch ingredients for multiple sessions
  app.post(
    '/import/rematch-batch',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        sessionIds: z.array(z.string().uuid()),
      });

      const { sessionIds } = schema.parse(request.body);

      const results: Record<string, unknown> = {};
      for (const sessionId of sessionIds) {
        const matches = await rematchIngredients(sessionId, request.user!.householdId);
        results[sessionId] = matches;
      }

      return { success: true, data: { results } };
    }
  );

  // Confirm multiple import sessions at once
  app.post(
    '/import/confirm-batch',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        sessions: z.array(z.object({
          sessionId: z.string().uuid(),
          overrides: z.object({
            title: z.string().optional(),
            description: z.string().optional(),
            prepTimeMinutes: z.number().int().positive().optional(),
            cookTimeMinutes: z.number().int().positive().optional(),
            servings: z.number().int().positive().optional(),
            ingredients: z.array(z.object({
              name: z.string(),
              quantity: z.number().optional(),
              unit: z.string().optional(),
              notes: z.string().optional(),
            })).optional(),
            instructions: z.array(z.string()).optional(),
          }).optional(),
        })),
      });

      const { sessions } = schema.parse(request.body);

      const recipeIds: string[] = [];
      for (const { sessionId, overrides } of sessions) {
        const recipeId = await confirmImportSession(
          sessionId,
          request.user!.householdId,
          request.user!.id,
          overrides
        );
        recipeIds.push(recipeId);
      }

      return { success: true, data: { recipeIds } };
    }
  );

  // Parse ingredient lines with CRF
  app.post(
    '/ingredients/parse',
    { preHandler: [authMiddleware] },
    async (request) => {
      const schema = z.object({
        lines: z.array(z.string()),
      });
      const { lines } = schema.parse(request.body);

      const { parseIngredientsWithCRF } = await import('../../services/crf-ingredient-parser.js');
      const crfResults = await parseIngredientsWithCRF(lines);

      return {
        success: true,
        data: {
          ingredients: crfResults.map((r) => ({
            name: r.name,
            quantity: r.quantity,
            unit: r.unit,
            notes: r.notes,
          })),
          parser: 'crf',
        },
      };
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
      });

      const { startDate, endDate, checkInventory } = schema.parse(request.body);

      const result = await generateShoppingListFromMealPlans(
        request.user!.householdId,
        startDate,
        endDate,
        checkInventory
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
      });

      const { startDate, endDate, checkInventory } = schema.parse(request.body);

      const result = await generateShoppingListFromMealPlans(
        request.user!.householdId,
        startDate,
        endDate,
        checkInventory
      );

      // Fetch all open shopping-list rows with their linked inventory name in
      // one query, so we can match by either inventory item ID or normalized
      // name across the linked/custom boundary.
      const openRows = await db
        .select({
          id: shoppingList.id,
          itemId: shoppingList.itemId,
          customName: shoppingList.customName,
          quantity: shoppingList.quantity,
          unit: shoppingList.unit,
          source: shoppingList.source,
          sources: shoppingList.sources,
          inventoryName: inventoryItems.name,
          inventoryDensity: inventoryItems.density,
          inventoryQuantityUnitSizes: inventoryItems.quantityUnitSizes,
        })
        .from(shoppingList)
        .leftJoin(inventoryItems, eq(shoppingList.itemId, inventoryItems.id))
        .where(
          and(
            eq(shoppingList.householdId, request.user!.householdId),
            eq(shoppingList.isChecked, false)
          )
        );

      const normalize = (s: string | null | undefined) =>
        (s ?? '').trim().toLowerCase();
      const unitsCompatible = (a: string | null | undefined, b: string | null | undefined) => {
        const an = normalize(a);
        const bn = normalize(b);
        return an === bn || an === '' || bn === '';
      };

      // Mutable map so a single merge target isn't double-claimed by two new
      // items in the same generate pass.
      const liveRows = new Map(openRows.map((r) => [r.id, r]));

      const addedItems: typeof shoppingList.$inferSelect[] = [];
      let mergedCount = 0;

      for (const item of result.items) {
        const itemName = normalize(item.name);
        let existing = null as (typeof openRows)[number] | null;
        // Quantity of the incoming item expressed in the existing row's unit.
        // When units match (compatible) this is simply item.quantity; when
        // they differ we attempt a convert via the item's density/sizes.
        let contributionInRowUnit = item.quantity;
        for (const row of liveRows.values()) {
          const nameMatch =
            (item.inventoryItemId && row.itemId === item.inventoryItemId) ||
            (() => {
              const rowName = normalize(row.customName ?? row.inventoryName);
              return rowName !== '' && rowName === itemName;
            })();
          if (!nameMatch) continue;

          if (unitsCompatible(row.unit, item.unit)) {
            existing = row;
            contributionInRowUnit = item.quantity;
            break;
          }

          // Different unit on the same item — try to convert the incoming
          // quantity into the row's unit. Use the row's linked inventory
          // metadata when present; otherwise the item is unlinked and we
          // can't bridge, so leave them separate.
          if (row.unit && item.unit) {
            const density = row.inventoryDensity ? Number(row.inventoryDensity) : null;
            const sizes = (row.inventoryQuantityUnitSizes ?? {}) as QuantityUnitSizes;
            const converted = convertWithDensity(item.quantity, item.unit, row.unit, density, sizes);
            if (converted !== null) {
              existing = row;
              contributionInRowUnit = converted;
              break;
            }
          }
        }

        if (existing) {
          const existingQty = parseFloat(existing.quantity || '0');
          const newQty = existingQty + contributionInRowUnit;
          // Existing rows from before sources[] existed have an empty array;
          // seed from the legacy `source` column in that case.
          const priorSources =
            existing.sources && existing.sources.length > 0
              ? existing.sources
              : [existing.source];
          const mergedSources = priorSources.includes('meal_plan')
            ? priorSources
            : [...priorSources, 'meal_plan' as const];
          await db
            .update(shoppingList)
            .set({
              quantity: newQty.toString(),
              // Backfill a missing linked-item ID / unit when the new entry
              // resolves a previously-unlinked row.
              ...(existing.itemId == null && item.inventoryItemId
                ? { itemId: item.inventoryItemId }
                : {}),
              ...(!existing.unit && item.unit ? { unit: item.unit } : {}),
              sources: mergedSources,
              updatedAt: new Date(),
            })
            .where(eq(shoppingList.id, existing.id));
          existing.quantity = newQty.toString();
          existing.sources = mergedSources;
          mergedCount += 1;
        } else {
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
              sources: ['meal_plan'],
            })
            .returning();

          addedItems.push(added);
          // Allow subsequent items in the same batch to merge into this row.
          // We don't have the inventory metadata in scope; later items will
          // only merge into this row when units match exactly. That's
          // acceptable — the rare cross-unit merge into a brand-new row in
          // the same batch can be picked up on the next generate pass.
          liveRows.set(added.id, {
            id: added.id,
            itemId: added.itemId,
            customName: added.customName,
            quantity: added.quantity,
            unit: added.unit,
            source: added.source,
            sources: added.sources,
            inventoryName: null,
            inventoryDensity: null,
            inventoryQuantityUnitSizes: null,
          });
        }
      }

      return {
        success: true,
        data: {
          addedCount: addedItems.length,
          mergedCount,
          items: result.items,
        },
      };
    }
  );

  // ===== CONFIDENCE-AWARE SHOPPING LIST (v2) =====

  // Preview shopping list with confidence annotations
  app.post(
    '/meal-plans/shopping-preview',
    { preHandler: [authMiddleware] },
    async (request) => {
      const schema = z.object({
        startDate: z.string(),
        endDate: z.string(),
      });
      const { startDate, endDate } = schema.parse(request.body);

      const { generateFromMealPlan } = await import('../../services/shopping-list-generation.service.js');

      // Get household settings for tier
      const household = await db.query.households.findFirst({
        where: eq(households.id, request.user!.householdId),
      });
      const settings = (household?.settings || {}) as any;
      const tier = settings.inventory?.tier || 'basic';
      const thresholds = settings.inventory?.confidenceThresholds;

      const preview = await generateFromMealPlan(
        request.user!.householdId,
        startDate,
        endDate,
        { tier, confidenceThresholds: thresholds },
      );

      return { success: true, data: { items: preview } };
    }
  );

  // Look-ahead suggestions for efficient shopping
  app.get(
    '/meal-plans/look-ahead-suggestions',
    { preHandler: [authMiddleware] },
    async (request) => {
      const schema = z.object({
        days: z.coerce.number().int().positive().default(7),
      });
      const { days } = schema.parse(request.query);

      const { getLookAheadSuggestions } = await import('../../services/shopping-list-generation.service.js');

      // Get current shopping list item IDs
      const currentItems = await db.query.shoppingList.findMany({
        where: and(
          eq(shoppingList.householdId, request.user!.householdId),
          eq(shoppingList.isChecked, false),
        ),
      });
      const itemIds = currentItems.filter(i => i.itemId).map(i => i.itemId!);

      const suggestions = await getLookAheadSuggestions(
        request.user!.householdId,
        itemIds,
        days,
      );

      return { success: true, data: { suggestions } };
    }
  );

  // Meal plans
  app.get(
    '/meal-plans',
    { preHandler: [authMiddleware, requireMealPlanAccess('view')] },
    async (request) => {
      const { start, end } = z
        .object({
          start: z.coerce.date().optional(),
          end: z.coerce.date().optional(),
        })
        .parse(request.query);

      const conditions = [eq(mealPlans.householdId, request.user!.householdId)];

      // Filter by date range
      if (start) {
        conditions.push(gte(mealPlans.plannedDate, start.toISOString().split('T')[0]));
      }
      if (end) {
        conditions.push(lte(mealPlans.plannedDate, end.toISOString().split('T')[0]));
      }

      const plans = await db.query.mealPlans.findMany({
        where: and(...conditions),
        with: { recipe: true },
        orderBy: (p, { asc }) => [asc(p.plannedDate)],
      });

      return { success: true, data: { mealPlans: plans } };
    }
  );

  app.post(
    '/meal-plans',
    { preHandler: [authMiddleware, requireMealPlanAccess('edit')] },
    async (request) => {
      const input = createMealPlanSchema.parse(request.body);

      // Check for existing meal plan with same recipe, date, and meal type
      const existing = await db.query.mealPlans.findFirst({
        where: and(
          eq(mealPlans.householdId, request.user!.householdId),
          eq(mealPlans.recipeId, input.recipeId),
          eq(mealPlans.plannedDate, input.plannedDate),
          eq(mealPlans.mealType, input.mealType)
        ),
      });

      if (existing) {
        throw Errors.badRequest('This recipe is already planned for this meal');
      }

      const [plan] = await db
        .insert(mealPlans)
        .values({
          householdId: request.user!.householdId,
          recipeId: input.recipeId,
          plannedDate: input.plannedDate,
          mealType: input.mealType,
          servingsMultiplier: input.servingsMultiplier?.toString() ?? '1',
        })
        .returning();

      return { success: true, data: { mealPlan: plan } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/meal-plans/:id',
    { preHandler: [authMiddleware, requireMealPlanAccess('edit')] },
    async (request) => {
      const schema = z.object({
        servingsMultiplier: z.number().min(0.5).max(10).optional(),
      });
      const updates = schema.parse(request.body);

      const [updated] = await db
        .update(mealPlans)
        .set({
          ...(updates.servingsMultiplier !== undefined && {
            servingsMultiplier: updates.servingsMultiplier.toString(),
          }),
        })
        .where(
          and(
            eq(mealPlans.id, request.params.id),
            eq(mealPlans.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Meal plan not found');
      }

      return { success: true, data: { mealPlan: updated } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/meal-plans/:id',
    { preHandler: [authMiddleware, requireMealPlanAccess('edit')] },
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
  checkInventory: boolean
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

  // Sum each meal plan's own servings multiplier per recipe.
  // A recipe planned twice — once at 1× and once at 1.5× — contributes 2.5× of its ingredient quantities.
  const recipeMultipliers = new Map<string, number>();
  for (const plan of plans) {
    const planMult = plan.servingsMultiplier
      ? parseFloat(plan.servingsMultiplier)
      : 1;
    recipeMultipliers.set(
      plan.recipeId,
      (recipeMultipliers.get(plan.recipeId) ?? 0) + planMult
    );
  }

  // Aggregate ingredients across all recipes
  const aggregated = new Map<string, {
    name: string;
    quantity: number;
    unit?: string;
    inventoryItemId?: string;
    recipes: Set<string>;
  }>();

  for (const [recipeId, totalMultiplier] of recipeMultipliers) {
    const recipe = await db.query.recipes.findFirst({
      where: eq(recipes.id, recipeId),
    });

    if (!recipe) continue;

    const ingredients = await db.query.recipeIngredients.findMany({
      where: eq(recipeIngredients.recipeId, recipeId),
    });

    for (const ing of ingredients) {
      const key = ing.inventoryItemId || ing.name.toLowerCase();
      const quantity = parseFloat(ing.quantity || '0') * totalMultiplier;

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
        // Get current stock + item metadata in one round-trip; we need the
        // item's density and sizes to convert stock entries to the recipe
        // unit before any arithmetic.
        const [stockEntries, invItem] = await Promise.all([
          db.query.inventoryStock.findMany({
            where: eq(inventoryStock.itemId, item.inventoryItemId),
          }),
          db.query.inventoryItems.findFirst({
            where: eq(inventoryItems.id, item.inventoryItemId),
          }),
        ]);

        if (stockEntries.length === 0) continue;

        const density = invItem?.density ? Number(invItem.density) : null;
        const sizes = (invItem?.quantityUnitSizes ?? {}) as QuantityUnitSizes;

        // Sum every stock entry, converting to the recipe unit. If *any*
        // entry can't be bridged we don't trust the partial total — leave
        // the recipe ask untouched and surface the gap via needs_conversion so
        // the user can fix the conversion. Skipping is safer than over-
        // subtracting and under-buying.
        let totalStockInRecipeUnit = 0;
        let allConvertible = true;
        for (const s of stockEntries) {
          const qty = parseFloat(s.quantity);
          if (!Number.isFinite(qty) || qty <= 0) continue;
          if (!s.unit || !item.unit || normalizeUnit(s.unit) === normalizeUnit(item.unit)) {
            totalStockInRecipeUnit += qty;
            continue;
          }
          const converted = convertWithDensity(qty, s.unit, item.unit, density, sizes);
          if (converted === null) {
            allConvertible = false;
            break;
          }
          totalStockInRecipeUnit += converted;
        }

        if (!allConvertible) {
          if (invItem && !invItem.needsConversion) {
            await db
              .update(inventoryItems)
              .set({ needsConversion: true, updatedAt: new Date() })
              .where(eq(inventoryItems.id, invItem.id));
          }
          // Leave item.quantity at the full recipe ask.
          continue;
        }

        if (totalStockInRecipeUnit > 0) {
          const deducted = Math.min(totalStockInRecipeUnit, item.quantity);
          item.quantity = Math.max(0, item.quantity - totalStockInRecipeUnit);

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

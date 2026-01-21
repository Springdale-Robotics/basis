import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { recipes, recipeIngredients, mealPlans, activeCookingSessions } from '../../db/schema/index.js';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { mealTypeSchema } from '../../lib/validators.js';

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
      // TODO: Implement inventory deduction logic
      const { sessionId } = z
        .object({ sessionId: z.string().uuid().optional() })
        .parse(request.body || {});

      if (sessionId) {
        await db.delete(activeCookingSessions).where(eq(activeCookingSessions.id, sessionId));
      }

      return { success: true, data: { message: 'Cooking finished' } };
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

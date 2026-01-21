import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Recipe, MealPlan } from '@/types/models';

export interface RecipeIngredientInput {
  name: string;
  quantity?: number;
  unit?: string;
  notes?: string;
  inventoryItemId?: string;
}

export interface RecipeInstructionInput {
  step: number;
  text: string;
  timerIds?: string[];
}

export interface RecipeTimerInput {
  id: string;
  name: string;
  durationSeconds: number;
  stepIndex?: number;
  alertSound?: string;
}

export interface CreateRecipeRequest {
  title: string;
  description?: string;
  servings?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  ingredients?: RecipeIngredientInput[];
  instructions?: RecipeInstructionInput[];
  timers?: RecipeTimerInput[];
  tags?: string[];
  imageUrl?: string;
  sourceUrl?: string;
}

export interface UpdateRecipeRequest extends Partial<CreateRecipeRequest> {}

export interface GetRecipesParams {
  search?: string;
  tags?: string;  // comma-separated
  page?: string;
  limit?: string;
}

export interface CreateMealPlanRequest {
  recipeId: string;
  plannedDate: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
}

export interface GetMealPlansParams {
  start?: string;
  end?: string;
}

export interface RecipeTag {
  name: string;
  count: number;
}

export const recipesApi = {
  list: (params?: GetRecipesParams) =>
    apiGet<{ recipes: Recipe[] }>('/recipes', {
      params: params as Record<string, string | number | boolean | undefined>
    }),

  get: (id: string) =>
    apiGet<{ recipe: Recipe; ingredients: RecipeIngredientInput[] }>(`/recipes/${id}`),

  create: (data: CreateRecipeRequest) =>
    apiPost<{ recipe: Recipe }>('/recipes', data),

  update: (id: string, data: UpdateRecipeRequest) =>
    apiPatch<{ recipe: Recipe }>(`/recipes/${id}`, data),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/recipes/${id}`),

  getTags: () =>
    apiGet<{ tags: RecipeTag[] }>('/recipes/tags'),

  // Cooking
  startCooking: (recipeId: string, servingsMultiplier?: number) =>
    apiPost<{ session: { id: string } }>(`/recipes/${recipeId}/cook`, { servingsMultiplier }),

  finishCooking: (recipeId: string, sessionId?: string) =>
    apiPost<{ message: string }>(`/recipes/${recipeId}/finish`, { sessionId }),

  // Meal Plans
  getMealPlans: (params?: GetMealPlansParams) =>
    apiGet<{ mealPlans: MealPlan[] }>('/recipes/meal-plans', {
      params: params as Record<string, string | number | boolean | undefined>
    }),

  createMealPlan: (data: CreateMealPlanRequest) =>
    apiPost<{ mealPlan: MealPlan }>('/recipes/meal-plans', data),

  deleteMealPlan: (id: string) =>
    apiDelete<{ message: string }>(`/recipes/meal-plans/${id}`),
};

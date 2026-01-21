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
  id?: string;
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
  servingsMultiplier?: number;
}

export interface GetMealPlansParams {
  start?: string;
  end?: string;
}

// Import types
export interface ParsedIngredient {
  name: string;
  quantity?: number;
  unit?: string;
  notes?: string;
}

export interface IngredientMatch {
  parsedName: string;
  parsedQuantity?: number;
  parsedUnit?: string;
  matchStatus: 'matched' | 'unmatched' | 'manual';
  matchedItemId?: string;
  matchedItemName?: string;
  confidence?: number;
  unitConversion?: {
    fromUnit: string;
    toUnit: string;
    factor: number;
  };
  suggestions?: Array<{
    itemId: string;
    name: string;
    confidence: number;
  }>;
}

export interface ParsedRecipe {
  title: string;
  description?: string;
  instructions: string[];
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  imageUrl?: string;
  ingredients: ParsedIngredient[];
}

export interface ImportSession {
  id: string;
  householdId: string;
  userId: string;
  sourceType: 'url' | 'image' | 'pdf';
  sourceData: string;
  parsedRecipe: ParsedRecipe | null;
  ingredientMatches: IngredientMatch[];
  status: 'parsing' | 'pending_review' | 'confirmed' | 'cancelled';
  createdAt: string;
  expiresAt: string;
}

export interface MatchSuggestion {
  itemId: string;
  name: string;
  confidence: number;
  unitConversion?: {
    fromUnit: string;
    toUnit: string;
    factor: number;
  };
}

export interface GenerateShoppingListRequest {
  startDate: string;
  endDate: string;
  checkInventory?: boolean;
  servingsMultiplier?: number;
}

export interface ShoppingListItem {
  name: string;
  quantity: number;
  unit?: string;
  inventoryItemId?: string;
  recipes: string[];
}

export interface GenerateShoppingListResponse {
  items: ShoppingListItem[];
  inventoryDeductions: Array<{
    name: string;
    deducted: number;
    unit?: string;
  }>;
  addedCount?: number;
  mergedCount?: number;
}

export interface FinishCookingRequest {
  sessionId?: string;
  deductInventory?: boolean;
  adjustments?: Array<{
    ingredientId: string;
    actualQuantityUsed: number;
    skipDeduction?: boolean;
  }>;
}

export interface FinishCookingResponse {
  message: string;
  deductedItems: Array<{
    itemName: string;
    quantity: number;
    unit?: string;
  }>;
  warnings?: string[];
}

export interface RecipeTag {
  name: string;
  count: number;
}

export interface TagSuggestion {
  tag: string;
  count: number;
}

export interface TagSuggestionsResponse {
  suggestions: TagSuggestion[];
  predefinedTags: string[];
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

  getTagSuggestions: (search?: string) =>
    apiGet<TagSuggestionsResponse>('/recipes/tags/suggestions', {
      params: search ? { search } : undefined
    }),

  // Cooking
  startCooking: (recipeId: string, servingsMultiplier?: number) =>
    apiPost<{ session: { id: string } }>(`/recipes/${recipeId}/cook`, { servingsMultiplier }),

  finishCooking: (recipeId: string, options?: FinishCookingRequest) =>
    apiPost<FinishCookingResponse>(`/recipes/${recipeId}/finish`, options),

  // Meal Plans
  getMealPlans: (params?: GetMealPlansParams) =>
    apiGet<{ mealPlans: MealPlan[] }>('/recipes/meal-plans', {
      params: params as Record<string, string | number | boolean | undefined>
    }),

  createMealPlan: (data: CreateMealPlanRequest) =>
    apiPost<{ mealPlan: MealPlan }>('/recipes/meal-plans', data),

  deleteMealPlan: (id: string) =>
    apiDelete<{ message: string }>(`/recipes/meal-plans/${id}`),

  // Shopping list generation
  previewShoppingList: (params: GenerateShoppingListRequest) =>
    apiPost<GenerateShoppingListResponse>('/recipes/meal-plans/preview-shopping-list', params),

  generateShoppingList: (params: GenerateShoppingListRequest) =>
    apiPost<GenerateShoppingListResponse>('/recipes/meal-plans/generate-shopping-list', params),

  // Recipe Import
  startImport: (data: { sourceType: 'url' | 'image' | 'pdf'; sourceData: string; rawText?: string }) =>
    apiPost<{ sessionId: string }>('/recipes/import/start', data),

  getImportSession: (sessionId: string) =>
    apiGet<{ session: ImportSession }>(`/recipes/import/${sessionId}`),

  updateImportMatches: (sessionId: string, updates: Array<{ parsedName: string; matchedItemId?: string; matchedItemName?: string }>) =>
    apiPost<{ message: string }>(`/recipes/import/${sessionId}/match`, { updates }),

  confirmImport: (sessionId: string, overrides?: { title?: string; description?: string; prepTimeMinutes?: number; cookTimeMinutes?: number; servings?: number; imageUrl?: string }) =>
    apiPost<{ recipeId: string }>(`/recipes/import/${sessionId}/confirm`, overrides),

  cancelImport: (sessionId: string) =>
    apiDelete<{ message: string }>(`/recipes/import/${sessionId}`),

  matchIngredient: (name: string, unit?: string) =>
    apiPost<{ suggestions: MatchSuggestion[] }>('/recipes/ingredients/match', { name, unit }),
};

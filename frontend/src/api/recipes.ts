import { apiGet, apiPost, apiPatch, apiDelete, apiUpload } from './client';
import type { Recipe, MealPlan } from '@/types/models';

export interface RecipeIngredientInput {
  name: string;
  quantity?: number;
  unit?: string;
  notes?: string;
  inventoryItemId?: string;
  linkedItemName?: string | null;  // Name from linked inventory item
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

export type MatchReason = 'exact' | 'synonym' | 'contains' | 'fuzzy' | 'related';

export interface IngredientMatch {
  parsedName: string;
  parsedQuantity?: number;
  parsedUnit?: string;
  matchStatus: 'matched' | 'unmatched' | 'manual';
  matchedItemId?: string;
  matchedItemName?: string;
  modifiedUnit?: string;  // User-modified unit during import
  confidence?: number;
  matchReason?: MatchReason;
  needsQuantityWeight?: {
    fromUnit: string;
    toUnit: string;
  };
  suggestions?: Array<{
    itemId: string;
    name: string;
    confidence: number;
    matchReason?: MatchReason;
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

export interface ParsedIngredientGroup {
  name?: string;
  ingredients: ParsedIngredient[];
}

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
  ingredientGroups?: ParsedIngredientGroup[];
}

export type ParseMethod =
  | 'json-ld'
  | 'recipe-clipper'
  | 'microdata'
  | 'heuristic'
  | 'text'
  | 'llm'
  | 'crf';

export interface ParseUrlResponse {
  parsedRecipe: ParsedRecipe;
  parseMethod: ParseMethod;
  confidence: number;
  warnings: string[];
}

export interface ParseTextResponse {
  parsedRecipe: ParsedRecipe;
  parseMethod: ParseMethod;
  confidence: number;
  warnings: string[];
}

export interface VisionProviderStatus {
  available: boolean;
  name: string;
  model: string;
  expectedProcessingMs?: number;
  gpuAccelerated?: boolean;
  llmAvailable?: boolean;
  error?: string;
}

export interface ImportStatusResponse {
  llm: { available: boolean; provider: string | null };
  crf: { available: boolean };
  image: {
    activeProvider: string | null;
    primary: VisionProviderStatus | null;
    fallback: VisionProviderStatus | null;
  };
}

export interface ImportSession {
  id: string;
  householdId: string;
  userId: string;
  sourceType: 'url' | 'image' | 'pdf' | 'text';
  sourceData: string;
  parsedRecipe: ParsedRecipe | null;
  ingredientMatches: IngredientMatch[];
  status: 'parsing' | 'pending_review' | 'confirmed' | 'cancelled' | 'failed';
  parseMethod?: ParseMethod;
  parseConfidence?: string;
  parseWarnings?: string[];
  createdAt: string;
  expiresAt: string;
}

export interface MatchSuggestion {
  itemId: string;
  name: string;
  confidence: number;
  matchReason?: MatchReason;
  needsQuantityWeight?: {
    fromUnit: string;
    toUnit: string;
  };
}

export interface GenerateShoppingListRequest {
  startDate: string;
  endDate: string;
  checkInventory?: boolean;
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
  mealPlanId?: string;
  /** Serving scale for deduction when not using a backend cook session. */
  servingsMultiplier?: number;
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

  updateMealPlan: (id: string, data: { servingsMultiplier?: number }) =>
    apiPatch<{ mealPlan: MealPlan }>(`/recipes/meal-plans/${id}`, data),

  deleteMealPlan: (id: string) =>
    apiDelete<{ message: string }>(`/recipes/meal-plans/${id}`),

  // Shopping list generation
  previewShoppingList: (params: GenerateShoppingListRequest) =>
    apiPost<GenerateShoppingListResponse>('/recipes/meal-plans/preview-shopping-list', params),

  generateShoppingList: (params: GenerateShoppingListRequest) =>
    apiPost<GenerateShoppingListResponse>('/recipes/meal-plans/generate-shopping-list', params),

  // Recipe Import
  getImportStatus: () =>
    apiGet<ImportStatusResponse>('/recipes/import/status'),

  parseUrl: (url: string) =>
    apiPost<ParseUrlResponse>('/recipes/import/parse-url', { url }),

  parseText: (text: string) =>
    apiPost<ParseTextResponse>('/recipes/import/parse-text', { text }),

  startImport: (data: { sourceType: 'url' | 'image' | 'pdf' | 'text'; sourceData: string; rawText?: string; imageSessionIds?: string[] }) =>
    apiPost<{ sessionId: string }>('/recipes/import/start', data),

  getImportSession: (sessionId: string) =>
    apiGet<{ session: ImportSession }>(`/recipes/import/${sessionId}`),

  updateImportMatches: (
    sessionId: string,
    updates: Array<{
      parsedName: string;
      matchedItemId?: string;
      matchedItemName?: string;
      modifiedUnit?: string;
      /**
       * Set when the user actively chose this item. The review screen posts
       * every row on save, so without this the backend can't tell a deliberate
       * pick from a suggestion the user scrolled past — and only deliberate
       * picks should teach the household an alias.
       */
      confirmed?: boolean;
    }>
  ) => apiPost<{ message: string }>(`/recipes/import/${sessionId}/match`, { updates }),

  confirmImport: (sessionId: string, overrides?: { title?: string; description?: string; prepTimeMinutes?: number; cookTimeMinutes?: number; servings?: number; imageUrl?: string; ingredients?: Array<{ name: string; quantity?: number; unit?: string; notes?: string }>; instructions?: string[] }) =>
    apiPost<{ recipeId: string }>(`/recipes/import/${sessionId}/confirm`, overrides),

  cancelImport: (sessionId: string) =>
    apiDelete<{ message: string }>(`/recipes/import/${sessionId}`),

  rematchIngredients: (sessionId: string) =>
    apiPost<{ matches: IngredientMatch[] }>(`/recipes/import/${sessionId}/rematch`, {}),

  reparseLLM: (sessionId: string) =>
    apiPost<{ parsedRecipe: ParsedRecipe; ingredientMatches: IngredientMatch[]; parseMethod: string; confidence: number }>(`/recipes/import/${sessionId}/reparse-llm`, {}),

  // Batch import
  /**
   * Batch endpoints report per-entry outcomes and never abort the run: one
   * unreadable URL in a paste of forty used to lose every entry after it,
   * along with any record of which ones had worked.
   */
  startBatchImport: (entries: Array<{ sourceType: 'url' | 'text'; sourceData: string; rawText?: string }>) =>
    apiPost<{
      results: Array<{ sessionId: string | null; status: 'pending_review' | 'failed'; error?: string }>;
      sessionIds: string[];
    }>('/recipes/import/start-batch', { entries }),

  confirmBatchImport: (sessions: Array<{ sessionId: string; overrides?: Record<string, unknown> }>) =>
    apiPost<{
      results: Array<{ sessionId: string; status: 'confirmed' | 'failed'; recipeId?: string; error?: string }>;
      recipeIds: string[];
    }>('/recipes/import/confirm-batch', { sessions }),

  rematchBatchIngredients: (sessionIds: string[]) =>
    apiPost<{
      results: Record<string, IngredientMatch[]>;
      failed: Array<{ sessionId: string; error: string }>;
    }>('/recipes/import/rematch-batch', { sessionIds }),

  parseIngredientLines: (lines: string[]) =>
    apiPost<{ ingredients: Array<{ name: string; quantity?: number; unit?: string; notes?: string }>; parser: string }>('/recipes/ingredients/parse', { lines }),

  matchIngredient: (name: string, unit?: string) =>
    apiPost<{ suggestions: MatchSuggestion[] }>('/recipes/ingredients/match', { name, unit }),

  // Availability
  getAvailability: () =>
    apiGet<{ availability: Record<string, { total: number; have: number }> }>('/recipes/availability'),

  // Item name suggestions for unmatched ingredients
  /**
   * Turn ingredient names into catalog items in one server-side pass: names
   * are canonicalised, existing items reused, and ingredients that reduce to
   * the same item share it. Doing this per-row on the client re-created items
   * the household already had.
   */
  /**
   * Read a filled-in recipe template into text the ordinary import can take.
   *
   * Creates nothing: the recipes come back as text and go through
   * startBatchImport like any other source, so a spreadsheet gets the same
   * review, matching and reconciliation rather than a path of its own.
   */
  importSpreadsheet: (file: File) =>
    apiUpload<{
      recipes: Array<{ title: string; rowNumber: number; text: string }>;
      skipped: Array<{ rowNumber: number; reason: string }>;
      warnings: string[];
    }>('/recipes/import/spreadsheet', file),

  /**
   * What creating items from these ingredients would do — without doing it.
   *
   * Writes nothing, so it can be asked before the household has decided
   * anything. Names that resemble each other come back grouped, because
   * "salt" on one card and "table salt" on another would otherwise become two
   * items and stay that way.
   */
  planItemsForIngredients: (ingredients: Array<{ name: string }>) =>
    apiPost<{
      items: Array<{
        originalNames: string[];
        canonicalName: string;
        action: 'link' | 'create';
        existingItemId?: string;
        existingItemName?: string;
        similarPlanned: Array<{ canonicalName: string; score: number; reason: string }>;
        similarExisting: Array<{ itemId: string; name: string; score: number; reason: string }>;
      }>;
      clusters: Array<{ canonicalNames: string[]; topScore: number }>;
      needingReview: number;
      warnings: string[];
    }>('/recipes/ingredients/plan-items', { ingredients }),

  createItemsForIngredients: (ingredients: Array<{ name: string; unit?: string }>) =>
    apiPost<{
      results: Array<{
        originalName: string;
        itemId: string;
        itemName: string;
        action: 'created' | 'linked';
        similarTo?: { itemId: string; name: string };
      }>;
      warnings: string[];
    }>('/recipes/ingredients/create-items', { ingredients }),

  suggestItems: (ingredientNames: string[]) =>
    apiPost<{ suggestions: Array<{
      originalName: string;
      suggestedName: string;
      category?: string;
      similarExisting?: string;
    }> }>('/recipes/ingredients/suggest-items', { ingredientNames }),

  // Image upload/delete
  uploadImage: (recipeId: string, file: File, onProgress?: (progress: number) => void) =>
    apiUpload<RecipeImageResponse>(`/recipes/${recipeId}/image`, file, { onProgress }),

  uploadImageFromUrl: (recipeId: string, imageUrl: string) =>
    apiPost<RecipeImageResponse>(`/recipes/${recipeId}/image`, { imageUrl }),

  // Copy an existing Files/Photos image into the recipe (processed + embedded).
  uploadImageFromFile: (recipeId: string, fileId: string) =>
    apiPost<RecipeImageResponse>(`/recipes/${recipeId}/image/from-file`, { fileId }),

  deleteImage: (recipeId: string) =>
    apiDelete<{ message: string }>(`/recipes/${recipeId}/image`),

  // Link a recipe ingredient to an inventory item
  linkIngredient: (recipeId: string, ingredientId: string, inventoryItemId: string | null) =>
    apiPatch<{ message: string }>(`/recipes/${recipeId}/ingredients/${ingredientId}/link`, { inventoryItemId }),
};

export interface RecipeImageResponse {
  imageData: string;
  imageMimeType: string;
  imageWidth: number;
  imageHeight: number;
}

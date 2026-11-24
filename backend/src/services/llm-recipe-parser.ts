import { getLLMProvider } from './llm-provider.js';
import { ClaudeError } from '../modules/llm/claude/claude-call.js';

export interface LLMParsedIngredient {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  notes?: string | null;
}

export interface LLMParsedRecipe {
  title: string;
  description?: string | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  servings?: number | null;
  ingredientGroups: Array<{
    name?: string | null;
    ingredients: LLMParsedIngredient[];
  }>;
  instructions: string[];
}

const RECIPE_PARSE_PROMPT = `You are a recipe parser. Extract structured data from the provided recipe text.

Return ONLY valid JSON with exactly this structure (no markdown, no explanation):
{
  "title": "string",
  "description": "string or null",
  "prepTimeMinutes": number or null,
  "cookTimeMinutes": number or null,
  "servings": number or null,
  "ingredientGroups": [
    {
      "name": null,
      "ingredients": [
        { "name": "string", "quantity": number or null, "unit": "string or null", "notes": "string or null" }
      ]
    }
  ],
  "instructions": ["step 1 text", "step 2 text"]
}

Rules:
- Convert fractions to decimals (1/2 → 0.5, ¾ → 0.75, 1 1/2 → 1.5)
- Separate preparation descriptors into notes: "2 cups fresh basil, chopped" → name: "basil", quantity: 2, unit: "cup", notes: "fresh, chopped"
- Use standard unit names: cup, tsp, tbsp, oz, lb, g, kg, mL, L, piece, slice, clove, can, bunch, pinch
- If ingredients are organized into groups (e.g., "For the sauce:", "Dough:"), use separate group objects with names
- If no explicit groups, use a single group with name: null
- Each instruction should be one discrete step, using the text's own sentences
- Copy the wording of names, steps and notes exactly as written: keep the spelling, abbreviations and punctuation; do not expand abbreviations ("min." stays "min."), add words, or complete sentences. You are dividing the text into fields, not rewriting it
- If timing info isn't explicitly stated, use null
- Omit fields that can't be determined rather than guessing`;

/**
 * Warning attached to every LLM-parsed recipe.
 *
 * The LLM fallback is the least reliable parser and used to report the second
 * highest confidence in the system, having first cleared the warning list. A
 * model that quietly rewords an instruction or invents a quantity produced a
 * result the UI presented as clean.
 */
export const LLM_PARSE_WARNING =
  'Read by AI because the recipe text was hard to parse. Check the quantities and steps against the original before saving.';

/**
 * Reject LLM output that isn't shaped like a recipe.
 *
 * Previously this only checked that three keys were present, so a response
 * with an empty ingredient name, a quantity of "two", or no steps at all went
 * straight through and replaced a parse that may well have been better.
 */
export function validateLLMRecipe(parsed: LLMParsedRecipe | null | undefined): parsed is LLMParsedRecipe {
  if (!parsed || typeof parsed.title !== 'string' || !parsed.title.trim()) return false;
  if (!Array.isArray(parsed.ingredientGroups) || !Array.isArray(parsed.instructions)) return false;

  const instructions = parsed.instructions.filter((step) => typeof step === 'string' && step.trim());
  if (instructions.length === 0) return false;

  const ingredients = parsed.ingredientGroups.flatMap((group) =>
    Array.isArray(group?.ingredients) ? group.ingredients : []
  );
  if (ingredients.length === 0) return false;

  for (const ingredient of ingredients) {
    if (!ingredient || typeof ingredient.name !== 'string' || !ingredient.name.trim()) return false;
    // A name long enough to be a whole recipe line means the model echoed the
    // input instead of parsing it.
    if (ingredient.name.length > 80) return false;
    if (ingredient.quantity != null && (typeof ingredient.quantity !== 'number' || !Number.isFinite(ingredient.quantity) || ingredient.quantity < 0)) {
      return false;
    }
    if (ingredient.unit != null && typeof ingredient.unit !== 'string') return false;
  }

  return true;
}

export type LLMParseOutcome =
  | { ok: true; recipe: LLMParsedRecipe }
  | { ok: false; reason: 'unavailable' | 'unparseable' }
  /** Claude failed in a way the user should hear about (bad key, rate limit, …). */
  | { ok: false; reason: 'provider_error'; userMessage: string };

/** Shown on an import that fell back to basic parsing because Claude failed. */
export function llmFailureWarning(userMessage: string): string {
  return `Claude couldn't help with this recipe: ${userMessage} Used basic parsing instead.`;
}

/**
 * Parse recipe text using an LLM (Claude or Ollama).
 * Claude failures come back as 'provider_error' so callers can tell the user;
 * anything else that goes wrong stays a quiet 'unparseable', as before.
 */
export async function parseRecipeWithLLM(text: string): Promise<LLMParseOutcome> {
  const provider = await getLLMProvider();
  if (!provider) {
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const response = await provider.complete(
      `Recipe text:\n"""\n${text}\n"""`,
      {
        systemPrompt: RECIPE_PARSE_PROMPT,
        // Room for thinking (current Claude models) plus a long recipe.
        maxTokens: 16000,
      }
    );

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = response.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as LLMParsedRecipe;

    if (!validateLLMRecipe(parsed)) return { ok: false, reason: 'unparseable' };

    return { ok: true, recipe: parsed };
  } catch (error) {
    if (error instanceof ClaudeError) {
      return { ok: false, reason: 'provider_error', userMessage: error.message };
    }
    console.error(`[LLM Recipe Parser] Failed (${provider.name}):`, error);
    return { ok: false, reason: 'unparseable' };
  }
}

/**
 * Convert LLM parsed recipe into the ParsedRecipe format used by the import system.
 */
export function llmResultToImportFormat(llmResult: LLMParsedRecipe): {
  title: string;
  description?: string;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  ingredients: Array<{ name: string; quantity?: number; unit?: string; notes?: string }>;
  instructions: string[];
  ingredientGroups?: Array<{ name?: string; ingredients: Array<{ name: string; quantity?: number; unit?: string; notes?: string }> }>;
} {
  // Flatten all ingredients from groups
  const allIngredients: Array<{ name: string; quantity?: number; unit?: string; notes?: string }> = [];
  const groups: Array<{ name?: string; ingredients: Array<{ name: string; quantity?: number; unit?: string; notes?: string }> }> = [];

  for (const group of llmResult.ingredientGroups) {
    const groupIngs = group.ingredients.map(ing => ({
      name: ing.name,
      quantity: ing.quantity ?? undefined,
      unit: ing.unit ?? undefined,
      notes: ing.notes ?? undefined,
      groupName: group.name ?? undefined,
    }));
    allIngredients.push(...groupIngs);
    groups.push({
      name: group.name ?? undefined,
      ingredients: groupIngs,
    });
  }

  return {
    title: llmResult.title,
    description: llmResult.description ?? undefined,
    prepTimeMinutes: llmResult.prepTimeMinutes ?? undefined,
    cookTimeMinutes: llmResult.cookTimeMinutes ?? undefined,
    servings: llmResult.servings ?? undefined,
    ingredients: allIngredients,
    instructions: llmResult.instructions,
    ingredientGroups: groups.length > 0 ? groups : undefined,
  };
}

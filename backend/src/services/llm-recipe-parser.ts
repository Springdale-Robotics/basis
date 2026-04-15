import { getLLMProvider } from './llm-provider.js';

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
- Each instruction should be one discrete step
- If timing info isn't explicitly stated, use null
- Omit fields that can't be determined rather than guessing`;

/**
 * Parse recipe text using an LLM (Claude or Ollama).
 * Returns a structured recipe or null if no LLM is available or parsing fails.
 */
export async function parseRecipeWithLLM(text: string): Promise<LLMParsedRecipe | null> {
  const provider = getLLMProvider();
  if (!provider) {
    return null;
  }

  try {
    const response = await provider.complete(
      `Recipe text:\n"""\n${text}\n"""`,
      {
        systemPrompt: RECIPE_PARSE_PROMPT,
        maxTokens: 4096,
        temperature: 0,
      }
    );

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = response.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as LLMParsedRecipe;

    // Basic validation
    if (!parsed.title || !parsed.ingredientGroups || !parsed.instructions) {
      return null;
    }

    // Flatten ingredient groups into a flat ingredients array for compatibility
    // (the import system expects both formats)
    return parsed;
  } catch (error) {
    console.error(`[LLM Recipe Parser] Failed (${provider.name}):`, error);
    return null;
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

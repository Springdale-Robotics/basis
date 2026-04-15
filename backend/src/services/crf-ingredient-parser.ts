import { config } from '../config/index.js';

interface CRFParsedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  confidence: number;
}

interface CRFParseResponse {
  results: CRFParsedIngredient[];
  parser: string;
  processing_time_ms: number;
}

/**
 * Parse ingredient lines using the CRF-based NLP model
 * hosted in the VLM-LLM Python service.
 *
 * Returns null if the service is unavailable.
 */
export async function parseIngredientsWithCRF(
  ingredientLines: string[]
): Promise<CRFParsedIngredient[] | null> {
  const serviceUrl = config.VLM_LLM_SERVICE_URL;

  try {
    const response = await fetch(`${serviceUrl}/parse/ingredients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients: ingredientLines }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as CRFParseResponse;
    return data.results;
  } catch {
    return null;
  }
}

/**
 * Check if the CRF ingredient parser is available.
 */
export async function isCRFParserAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.VLM_LLM_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

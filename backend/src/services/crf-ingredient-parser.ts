import { config } from '../config/index.js';
import { AppError, ErrorCode } from '../lib/errors.js';

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
 * Throws if the service is unavailable or returns an error.
 */
export async function parseIngredientsWithCRF(
  ingredientLines: string[]
): Promise<CRFParsedIngredient[]> {
  const serviceUrl = config.VLM_LLM_SERVICE_URL;

  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/parse/ingredients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients: ingredientLines }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
      'Ingredient parser service is not available. Please try again shortly.',
      { service: 'vlm-llm', url: serviceUrl, cause: String(err) },
      503
    );
  }

  if (!response.ok) {
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
      'Ingredient parser returned an error. Please try again shortly.',
      { service: 'vlm-llm', status: response.status },
      503
    );
  }

  const data = (await response.json()) as CRFParseResponse;
  return data.results;
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

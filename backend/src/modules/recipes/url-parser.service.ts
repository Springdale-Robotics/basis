import * as cheerio from 'cheerio';
import type { ParsedRecipe, ParsedIngredient, IngredientGroup } from '../../db/schema/recipes.js';
// Raw-string emission. URL extractors return ingredients as
// `{name: rawString}` only — the downstream session re-parses each via CRF
// (see processUrlImportSession). Keeping URL parsing regex-free here means
// CRF or LLM failures surface as warnings instead of confidently-wrong
// regex output reaching the user.
function rawIngredient(line: string): ParsedIngredient {
  return { name: line.trim(), quantity: undefined, unit: undefined };
}

export type ParseMethod = 'json-ld' | 'recipe-clipper' | 'microdata' | 'heuristic';

export interface UrlParseResult {
  parsedRecipe: ParsedRecipe;
  parseMethod: ParseMethod;
  confidence: number;
  warnings: string[];
  /** Visible page text — kept for downstream LLM fallback when confidence is low. */
  pageText?: string;
}

/**
 * Fetch and parse a recipe from a URL
 */
export async function parseRecipeFromUrl(url: string): Promise<UrlParseResult> {
  const warnings: string[] = [];

  // Fetch the URL
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HomeManager/1.0; +https://homemanager.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    html = await response.text();
  } catch (error) {
    throw new Error(`Failed to fetch URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  const $ = cheerio.load(html);

  // Extract visible page text once — passed back on the result so a downstream
  // LLM fallback can consume it without re-fetching the URL.
  const pageText = extractVisibleText($);

  // Strategy 1: JSON-LD Schema.org
  const jsonLdResult = tryParseJsonLd($, url, warnings);
  if (jsonLdResult && jsonLdResult.confidence >= 0.8) {
    return { ...jsonLdResult, pageText };
  }

  // Strategy 2: RecipeClipper (ML-based extraction)
  const clipperResult = await tryRecipeClipper(html, url, warnings);
  if (clipperResult && clipperResult.confidence >= 0.7) {
    return { ...clipperResult, pageText };
  }

  // Strategy 3: Microdata
  const microdataResult = tryParseMicrodata($, url, warnings);
  if (microdataResult && microdataResult.confidence >= 0.6) {
    return { ...microdataResult, pageText };
  }

  // Strategy 4: Heuristic fallback
  const heuristicResult = tryHeuristicParse($, url, warnings);
  if (heuristicResult) {
    return { ...heuristicResult, pageText };
  }

  // Return best result we have or throw
  const bestResult = jsonLdResult || clipperResult || microdataResult;
  if (bestResult) {
    return { ...bestResult, pageText };
  }

  throw new Error('Could not parse recipe from URL. The page may not contain a recognizable recipe format.');
}

/**
 * Pull visible text from a cheerio document — strips <script>, <style>,
 * <nav>, <header>, <footer> and collapses whitespace so the result is a
 * reasonable input for downstream LLM parsing.
 */
function extractVisibleText($: cheerio.CheerioAPI): string {
  const $copy = cheerio.load($.html());
  $copy('script, style, nav, header, footer, noscript, iframe, svg').remove();
  return $copy('body').text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse JSON-LD structured data for Recipe schema
 */
function tryParseJsonLd($: cheerio.CheerioAPI, sourceUrl: string, warnings: string[]): UrlParseResult | null {
  try {
    const scripts = $('script[type="application/ld+json"]');

    for (let i = 0; i < scripts.length; i++) {
      const content = $(scripts[i]).html();
      if (!content) continue;

      try {
        const data = JSON.parse(content);

        // Handle both single objects and @graph arrays
        const items = data['@graph'] || (Array.isArray(data) ? data : [data]);

        for (const item of items) {
          if (item['@type'] === 'Recipe' || item['@type']?.includes?.('Recipe')) {
            const recipe = parseSchemaOrgRecipe(item, sourceUrl);
            if (recipe) {
              return {
                parsedRecipe: recipe,
                parseMethod: 'json-ld',
                confidence: calculateConfidence(recipe),
                warnings,
              };
            }
          }
        }
      } catch {
        // Invalid JSON, continue to next script
      }
    }
  } catch (error) {
    warnings.push(`JSON-LD parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return null;
}

/**
 * Parse a Schema.org Recipe object into our format
 */
function parseSchemaOrgRecipe(data: Record<string, unknown>, sourceUrl: string): ParsedRecipe | null {
  try {
    const recipe: ParsedRecipe = {
      title: getString(data.name) || 'Untitled Recipe',
      description: getString(data.description),
      instructions: parseInstructions(data.recipeInstructions),
      ingredients: parseIngredients(data.recipeIngredient),
      sourceUrl,
    };

    // Parse timing
    const prepTime = parseDuration(data.prepTime);
    const cookTime = parseDuration(data.cookTime);
    const totalTime = parseDuration(data.totalTime);

    if (prepTime) recipe.prepTimeMinutes = prepTime;
    if (cookTime) recipe.cookTimeMinutes = cookTime;
    if (!prepTime && !cookTime && totalTime) {
      recipe.cookTimeMinutes = totalTime;
    }

    // Parse servings
    const servings = parseServings(data.recipeYield);
    if (servings) recipe.servings = servings;

    // Parse image
    const image = parseImage(data.image);
    if (image) recipe.imageUrl = image;

    // Parse author
    const author = parseAuthor(data.author);
    if (author) recipe.author = author;

    // Parse cuisine
    const cuisine = getString(data.recipeCuisine);
    if (cuisine) recipe.cuisine = cuisine;

    return recipe;
  } catch {
    return null;
  }
}

/**
 * Try RecipeClipper for ML-based extraction
 */
async function tryRecipeClipper(html: string, sourceUrl: string, warnings: string[]): Promise<UrlParseResult | null> {
  try {
    // Dynamic import to handle potential loading issues
    const clipperModule = await import('@julianpoy/recipe-clipper');
    const RecipeClipper = clipperModule.default || clipperModule;

    const clipped = await RecipeClipper(html, { url: sourceUrl });

    if (!clipped || (!clipped.ingredients?.length && !clipped.instructions?.length)) {
      return null;
    }

    const recipe: ParsedRecipe = {
      title: clipped.title || 'Untitled Recipe',
      description: clipped.description,
      instructions: Array.isArray(clipped.instructions)
        ? clipped.instructions.map((i: string | { text: string }) =>
            typeof i === 'string' ? i : i.text
          )
        : [],
      ingredients: Array.isArray(clipped.ingredients)
        ? clipped.ingredients.map((i: string) => rawIngredient(i))
        : [],
      sourceUrl,
    };

    if (clipped.prepTime) recipe.prepTimeMinutes = parseDuration(clipped.prepTime);
    if (clipped.cookTime) recipe.cookTimeMinutes = parseDuration(clipped.cookTime);
    if (clipped.totalTime && !recipe.prepTimeMinutes && !recipe.cookTimeMinutes) {
      recipe.cookTimeMinutes = parseDuration(clipped.totalTime);
    }

    if (clipped.yield) recipe.servings = parseServings(clipped.yield);
    if (clipped.imageUrl) recipe.imageUrl = clipped.imageUrl;

    return {
      parsedRecipe: recipe,
      parseMethod: 'recipe-clipper',
      confidence: calculateConfidence(recipe),
      warnings,
    };
  } catch (error) {
    warnings.push(`RecipeClipper failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

/**
 * Parse Microdata format
 */
function tryParseMicrodata($: cheerio.CheerioAPI, sourceUrl: string, warnings: string[]): UrlParseResult | null {
  try {
    const recipeElement = $('[itemtype*="schema.org/Recipe"], [itemtype*="Recipe"]');
    if (!recipeElement.length) return null;

    const getName = (prop: string) => {
      const el = recipeElement.find(`[itemprop="${prop}"]`);
      return el.attr('content') || el.text().trim();
    };

    const getAll = (prop: string) => {
      return recipeElement
        .find(`[itemprop="${prop}"]`)
        .map((_, el) => $(el).attr('content') || $(el).text().trim())
        .get()
        .filter(Boolean);
    };

    const title = getName('name');
    if (!title) return null;

    const recipe: ParsedRecipe = {
      title,
      description: getName('description'),
      instructions: getAll('recipeInstructions')
        .flatMap(i => i.split('\n').filter(Boolean)),
      ingredients: getAll('recipeIngredient').map(i => rawIngredient(i)),
      sourceUrl,
    };

    const prepTime = parseDuration(getName('prepTime'));
    const cookTime = parseDuration(getName('cookTime'));
    if (prepTime) recipe.prepTimeMinutes = prepTime;
    if (cookTime) recipe.cookTimeMinutes = cookTime;

    const servings = parseServings(getName('recipeYield'));
    if (servings) recipe.servings = servings;

    const image = getName('image') || recipeElement.find('[itemprop="image"]').attr('src');
    if (image) recipe.imageUrl = image;

    return {
      parsedRecipe: recipe,
      parseMethod: 'microdata',
      confidence: calculateConfidence(recipe),
      warnings,
    };
  } catch (error) {
    warnings.push(`Microdata parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

/**
 * Heuristic parsing as last resort
 */
function tryHeuristicParse($: cheerio.CheerioAPI, sourceUrl: string, warnings: string[]): UrlParseResult | null {
  try {
    // Try to find a title
    const title = $('h1').first().text().trim() ||
                  $('title').text().split('|')[0].split('-')[0].trim() ||
                  'Untitled Recipe';

    // Look for ingredients section
    const ingredientSelectors = [
      '.recipe-ingredients',
      '.ingredients',
      '[class*="ingredient"]',
      '#ingredients',
      'section:has(h2:contains("Ingredient"))',
      'div:has(h3:contains("Ingredient"))',
    ];

    let ingredients: ParsedIngredient[] = [];
    for (const selector of ingredientSelectors) {
      const section = $(selector);
      if (section.length) {
        const items = section.find('li, p').map((_, el) => $(el).text().trim()).get();
        if (items.length > 0) {
          ingredients = items.filter(Boolean).map(i => rawIngredient(i));
          break;
        }
      }
    }

    // Look for instructions section
    const instructionSelectors = [
      '.recipe-instructions',
      '.instructions',
      '.directions',
      '.method',
      '[class*="instruction"]',
      '[class*="direction"]',
      '#instructions',
      '#directions',
      'section:has(h2:contains("Instruction"))',
      'section:has(h2:contains("Direction"))',
      'section:has(h2:contains("Method"))',
    ];

    let instructions: string[] = [];
    for (const selector of instructionSelectors) {
      const section = $(selector);
      if (section.length) {
        const items = section.find('li, p').map((_, el) => $(el).text().trim()).get();
        if (items.length > 0) {
          instructions = items.filter(i => i.length > 10);
          break;
        }
      }
    }

    if (ingredients.length === 0 && instructions.length === 0) {
      warnings.push('Could not find ingredients or instructions sections');
      return null;
    }

    const recipe: ParsedRecipe = {
      title,
      instructions,
      ingredients,
      sourceUrl,
    };

    // Try to find prep/cook times
    const timePatterns = [
      /prep(?:aration)?\s*(?:time)?[:\s]*(\d+)\s*(min|minute|hour|hr)/i,
      /cook(?:ing)?\s*(?:time)?[:\s]*(\d+)\s*(min|minute|hour|hr)/i,
    ];

    const bodyText = $('body').text();
    const prepMatch = bodyText.match(timePatterns[0]);
    const cookMatch = bodyText.match(timePatterns[1]);

    if (prepMatch) {
      recipe.prepTimeMinutes = parseInt(prepMatch[1]) * (prepMatch[2].startsWith('h') ? 60 : 1);
    }
    if (cookMatch) {
      recipe.cookTimeMinutes = parseInt(cookMatch[1]) * (cookMatch[2].startsWith('h') ? 60 : 1);
    }

    // Try to find servings
    const servingsMatch = bodyText.match(/(?:serve|serving|yield)[s]?[:\s]*(\d+)/i);
    if (servingsMatch) {
      recipe.servings = parseInt(servingsMatch[1]);
    }

    // Try to find image
    const image = $('meta[property="og:image"]').attr('content') ||
                  $('img[class*="recipe"]').first().attr('src') ||
                  $('img[alt*="recipe"]').first().attr('src');
    if (image) recipe.imageUrl = image;

    warnings.push('Used heuristic parsing - results may be less accurate');

    return {
      parsedRecipe: recipe,
      parseMethod: 'heuristic',
      confidence: Math.min(0.5, calculateConfidence(recipe)),
      warnings,
    };
  } catch (error) {
    warnings.push(`Heuristic parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

// Helper functions

function getString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] as string | undefined;
  return undefined;
}

function parseDuration(value: unknown): number | undefined {
  if (!value) return undefined;
  const str = String(value);

  // ISO 8601 duration (PT30M, PT1H30M, etc.)
  const isoMatch = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (isoMatch) {
    const hours = parseInt(isoMatch[1] || '0');
    const minutes = parseInt(isoMatch[2] || '0');
    const seconds = parseInt(isoMatch[3] || '0');
    return hours * 60 + minutes + Math.ceil(seconds / 60);
  }

  // Plain number (assume minutes)
  const numMatch = str.match(/(\d+)/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    // If it says "hour" or is a large number, convert
    if (str.toLowerCase().includes('hour') || str.toLowerCase().includes('hr')) {
      return num * 60;
    }
    return num;
  }

  return undefined;
}

function parseServings(value: unknown): number | undefined {
  if (!value) return undefined;
  const str = String(value);

  // Handle ranges like "4-6 servings" - take the average
  const rangeMatch = str.match(/(\d+)\s*-\s*(\d+)/);
  if (rangeMatch) {
    return Math.round((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
  }

  // Handle simple numbers
  const numMatch = str.match(/(\d+)/);
  if (numMatch) {
    return parseInt(numMatch[1]);
  }

  return undefined;
}

function parseImage(value: unknown): string | undefined {
  if (!value) return undefined;

  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first !== null) {
      return (first as Record<string, unknown>).url as string | undefined;
    }
  }
  if (typeof value === 'object' && value !== null) {
    return (value as Record<string, unknown>).url as string | undefined;
  }

  return undefined;
}

function parseAuthor(value: unknown): string | undefined {
  if (!value) return undefined;

  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return parseAuthor(value[0]);
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return getString(obj.name) || getString(obj['@name']);
  }

  return undefined;
}

function parseInstructions(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === 'string') {
    return value.split('\n').map(s => s.trim()).filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        // HowToStep or HowToSection
        if (obj['@type'] === 'HowToSection') {
          const sectionSteps = obj.itemListElement;
          if (Array.isArray(sectionSteps)) {
            return parseInstructions(sectionSteps);
          }
        }
        return [getString(obj.text) || getString(obj.name) || ''].filter(Boolean);
      }
      return [];
    });
  }

  return [];
}

function parseIngredients(value: unknown): ParsedIngredient[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return rawIngredient(item);
        }
        return null;
      })
      .filter((i): i is ParsedIngredient => i !== null);
  }

  return [];
}

/**
 * Calculate confidence score based on completeness
 */
function calculateConfidence(recipe: ParsedRecipe): number {
  let score = 0;
  const weights = {
    title: 0.1,
    description: 0.05,
    instructions: 0.25,
    ingredients: 0.35,
    prepTime: 0.05,
    cookTime: 0.05,
    servings: 0.05,
    image: 0.05,
    author: 0.025,
    cuisine: 0.025,
  };

  if (recipe.title && recipe.title !== 'Untitled Recipe') score += weights.title;
  if (recipe.description) score += weights.description;
  if (recipe.instructions.length > 0) {
    score += weights.instructions * Math.min(1, recipe.instructions.length / 5);
  }
  if (recipe.ingredients.length > 0) {
    score += weights.ingredients * Math.min(1, recipe.ingredients.length / 5);
    // Bonus for having quantities
    const withQuantity = recipe.ingredients.filter(i => i.quantity).length;
    score += (withQuantity / recipe.ingredients.length) * 0.1;
  }
  if (recipe.prepTimeMinutes) score += weights.prepTime;
  if (recipe.cookTimeMinutes) score += weights.cookTime;
  if (recipe.servings) score += weights.servings;
  if (recipe.imageUrl) score += weights.image;
  if (recipe.author) score += weights.author;
  if (recipe.cuisine) score += weights.cuisine;

  return Math.min(1, score);
}

/**
 * Local AI fallback interface for future use
 */
export interface LocalAIParser {
  parseRecipeText(text: string): Promise<ParsedRecipe | null>;
  isAvailable(): boolean;
}

// Placeholder for local AI integration
let localAIParser: LocalAIParser | null = null;

export function registerLocalAIParser(parser: LocalAIParser): void {
  localAIParser = parser;
}

export function getLocalAIParser(): LocalAIParser | null {
  return localAIParser;
}

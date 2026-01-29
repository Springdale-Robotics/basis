import type { ParsedContentType } from '../../../db/schema/image-parse.js';

interface TypeDetectionResult {
  type: ParsedContentType;
  confidence: number;
  reasoning: string;
}

// Keywords and patterns for content type detection
const RECIPE_INDICATORS = [
  /ingredients?/i,
  /instructions?/i,
  /directions?/i,
  /steps?/i,
  /\d+\s*(cup|tbsp|tsp|oz|lb|g|kg|ml|l)\b/i,
  /preheat|bake|cook|simmer|boil|fry|stir|mix|combine|whisk|fold/i,
  /serves?\s*\d+/i,
  /prep\s*time/i,
  /cook\s*time/i,
  /servings?/i,
];

const CALENDAR_INDICATORS = [
  /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/, // Dates like 12/25/2024
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i, // Times
  /\b(meeting|appointment|event|call|conference|lunch|dinner|breakfast)\b/i,
  /\b(at|@)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/i,
  /schedule|calendar|agenda/i,
];

const LIST_INDICATORS = [
  /^[\-\*\•\○\◦\‣\⁃\→]\s*/m, // Bullet points
  /^\d+[\.\)]\s+/m, // Numbered lists
  /^☐|^☑|^\[[ x]\]/im, // Checkboxes
  /shopping|grocery|to\s*do|task|buy|need|todo/i,
];

/**
 * Detect the content type from raw extracted text
 */
export function detectContentType(rawText: string): TypeDetectionResult {
  const scores = {
    recipe: 0,
    calendar_event: 0,
    list: 0,
  };

  // Count matches for each type
  for (const pattern of RECIPE_INDICATORS) {
    if (pattern.test(rawText)) {
      scores.recipe += 1;
    }
  }

  for (const pattern of CALENDAR_INDICATORS) {
    if (pattern.test(rawText)) {
      scores.calendar_event += 1;
    }
  }

  for (const pattern of LIST_INDICATORS) {
    if (pattern.test(rawText)) {
      scores.list += 1;
    }
  }

  // Additional heuristics
  const lines = rawText.split('\n').filter((l) => l.trim());
  const shortLines = lines.filter((l) => l.length < 50);
  const bulletLines = lines.filter((l) => /^[\-\*\•\○\d\.]\s*/.test(l.trim()));

  // If most lines are short and look like a list, boost list score
  if (shortLines.length / lines.length > 0.7 && bulletLines.length > 2) {
    scores.list += 2;
  }

  // If there are ingredient-like patterns with quantities, boost recipe score
  const quantityPattern = /\d+\s*(cup|tbsp|tsp|oz|lb|g|kg|ml|l|tablespoon|teaspoon|ounce|pound|gram|kilogram|milliliter|liter)\b/gi;
  const quantityMatches = rawText.match(quantityPattern);
  if (quantityMatches && quantityMatches.length >= 3) {
    scores.recipe += 3;
  }

  // If there are multiple date/time patterns, boost calendar score
  const datePattern = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g;
  const timePattern = /\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi;
  const dateMatches = rawText.match(datePattern);
  const timeMatches = rawText.match(timePattern);
  if ((dateMatches?.length || 0) + (timeMatches?.length || 0) >= 3) {
    scores.calendar_event += 2;
  }

  // Determine the winner
  const maxScore = Math.max(scores.recipe, scores.calendar_event, scores.list);
  const totalMatches = scores.recipe + scores.calendar_event + scores.list;

  // If no clear winner or very low scores, return unknown
  if (maxScore === 0 || totalMatches < 2) {
    return {
      type: 'unknown',
      confidence: 0.3,
      reasoning: 'No clear content type detected from text patterns',
    };
  }

  // Calculate confidence based on how dominant the winner is
  const confidence = totalMatches > 0 ? Math.min(0.95, 0.5 + (maxScore / totalMatches) * 0.4) : 0.3;

  if (scores.recipe >= scores.calendar_event && scores.recipe >= scores.list) {
    return {
      type: 'recipe',
      confidence,
      reasoning: `Recipe patterns detected: ${scores.recipe} matches (ingredients, cooking terms, measurements)`,
    };
  }

  if (scores.calendar_event >= scores.list) {
    return {
      type: 'calendar_event',
      confidence,
      reasoning: `Calendar patterns detected: ${scores.calendar_event} matches (dates, times, event keywords)`,
    };
  }

  return {
    type: 'list',
    confidence,
    reasoning: `List patterns detected: ${scores.list} matches (bullet points, checkboxes, short items)`,
  };
}

/**
 * Build an AI prompt based on the detected content type.
 * Supports both detailed prompts for capable models and simple prompts for lightweight models.
 */
export function buildExtractionPrompt(
  detectedType: ParsedContentType,
  hintType?: ParsedContentType,
  useSimplePrompt = false
): string {
  const targetType = hintType || detectedType;

  // Simple prompts for lightweight models like moondream
  if (useSimplePrompt) {
    return buildSimplePrompt(targetType);
  }

  const baseInstructions = `You are an expert at extracting structured information from images of handwritten or printed text.
Analyze this image carefully and extract the content.

IMPORTANT: Output your response as valid JSON only, with no additional text before or after.`;

  switch (targetType) {
    case 'list':
      return `${baseInstructions}

Extract the list items from this image. For each item, identify:
- The text content
- Whether it appears to be checked/completed (look for checkmarks, strikethroughs, or crossed items)
- Any date or time mentioned

Output as JSON in this exact format:
{
  "type": "list",
  "confidence": 0.0-1.0,
  "title": "optional list title if visible",
  "items": [
    {
      "content": "item text",
      "isChecked": false,
      "dueDate": null or "YYYY-MM-DD" if mentioned,
      "confidence": 0.0-1.0
    }
  ],
  "suggestedListType": "checklist" or "reminder" or "notes"
}`;

    case 'recipe':
      return `${baseInstructions}

Extract the recipe from this image. Identify:
- Recipe title
- List of ingredients with quantities and units (standardize units: cup, tbsp, tsp, oz, lb, g, ml, l)
- Step-by-step instructions
- Prep time and cook time if mentioned
- Number of servings if mentioned

Output as JSON in this exact format:
{
  "type": "recipe",
  "confidence": 0.0-1.0,
  "title": "Recipe Name",
  "description": "optional description",
  "prepTimeMinutes": null or number,
  "cookTimeMinutes": null or number,
  "servings": null or number,
  "ingredients": [
    {
      "name": "ingredient name",
      "quantity": number or null,
      "unit": "unit" or null,
      "notes": "any special notes",
      "confidence": 0.0-1.0
    }
  ],
  "instructions": ["step 1", "step 2", ...]
}`;

    case 'calendar_event':
      return `${baseInstructions}

Extract calendar events or appointments from this image. For each event, identify:
- Event title/name
- Date (convert to YYYY-MM-DD format)
- Time if mentioned (use 24-hour format HH:MM)
- Location if mentioned
- Whether it's an all-day event
- Any recurrence pattern (daily, weekly, monthly, etc.)

Output as JSON in this exact format:
{
  "type": "calendar_event",
  "confidence": 0.0-1.0,
  "events": [
    {
      "title": "event name",
      "startTime": "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD" for all-day,
      "endTime": "YYYY-MM-DDTHH:MM:SS" or null,
      "location": "location" or null,
      "description": "any notes",
      "allDay": true/false,
      "recurrenceHint": null or "weekly on monday" etc,
      "confidence": 0.0-1.0
    }
  ]
}`;

    case 'mixed':
    case 'unknown':
    default:
      return `${baseInstructions}

Analyze this image and extract any structured content. This might be:
- A list (shopping list, to-do list, notes)
- A recipe (ingredients and instructions)
- Calendar events (appointments, schedules)

First determine what type of content this is, then extract it.

Output as JSON in one of these formats based on what you find:

For lists:
{
  "type": "list",
  "confidence": 0.0-1.0,
  "title": "optional",
  "items": [{"content": "text", "isChecked": false, "confidence": 0.9}],
  "suggestedListType": "checklist"
}

For recipes:
{
  "type": "recipe",
  "confidence": 0.0-1.0,
  "title": "name",
  "ingredients": [{"name": "item", "quantity": 1, "unit": "cup", "confidence": 0.9}],
  "instructions": ["step 1", "step 2"]
}

For calendar events:
{
  "type": "calendar_event",
  "confidence": 0.0-1.0,
  "events": [{"title": "event", "startTime": "2024-01-01T10:00:00", "confidence": 0.9}]
}

If you cannot determine the content type or extract meaningful structure:
{
  "type": "unknown",
  "confidence": 0.0-1.0,
  "rawText": "all visible text from the image"
}`;
  }
}

/**
 * Build a simple, direct prompt for lightweight vision models like moondream.
 * These models work better with straightforward instructions.
 */
function buildSimplePrompt(targetType: ParsedContentType): string {
  switch (targetType) {
    case 'list':
      return `Read all the text in this image. List each item on a new line starting with a dash.
If an item is checked or crossed out, add "[CHECKED]" after it.
Example:
- Milk
- Eggs [CHECKED]
- Bread`;

    case 'recipe':
      return `Read this recipe image. Write out:

TITLE: [recipe name]

INGREDIENTS:
- [quantity] [unit] [ingredient name]
- [continue for each ingredient]

INSTRUCTIONS:
1. [first step]
2. [second step]
[continue for each step]

SERVINGS: [number if shown]
PREP TIME: [minutes if shown]
COOK TIME: [minutes if shown]`;

    case 'calendar_event':
      return `Read this image and list all events, appointments, or scheduled items.
For each event, write:
- Event: [name]
- Date: [date if shown]
- Time: [time if shown]
- Location: [location if shown]

List all events you can see.`;

    case 'mixed':
    case 'unknown':
    default:
      return `Read all the text visible in this image.
If it's a list, write each item on a new line with a dash.
If it's a recipe, identify the title, ingredients, and instructions.
If it's a schedule, list any events with their dates and times.
Write out everything you can see clearly.`;
  }
}

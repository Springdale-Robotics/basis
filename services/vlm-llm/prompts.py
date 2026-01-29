"""
Extraction prompt templates for VLM + LLM two-stage pipeline.

Stage 1 (VLM): Simple prompt to extract raw text from image
Stage 2 (LLM): Detailed prompts to structure and normalize text into JSON
"""

from typing import Literal

ContentType = Literal["list", "recipe", "calendar_event", "mixed", "unknown"]


# =============================================================================
# VLM PROMPTS (Stage 1 - Vision Model)
# =============================================================================

VLM_TEXT_EXTRACTION_PROMPT = """Extract all text from this image exactly as written.
Include every word, number, and symbol you can see.
Preserve the original formatting and layout as much as possible.
Do not interpret or restructure - just transcribe what you see.
If the text appears to be a list, recipe, or calendar, maintain its structure."""


# =============================================================================
# LLM PROMPTS (Stage 2 - Text Model)
# =============================================================================

def build_llm_structuring_prompt(
    detected_type: ContentType,
    raw_text: str,
    hint_type: ContentType | None = None,
) -> str:
    """
    Build an LLM prompt for structuring raw text from VLM output.

    Args:
        detected_type: The content type detected from the raw text
        raw_text: The raw text extracted by VLM
        hint_type: Optional user-provided hint about the content type

    Returns:
        A prompt string for the LLM
    """
    target_type = hint_type or detected_type

    if target_type == "list":
        return _build_list_prompt(raw_text)
    elif target_type == "recipe":
        return _build_recipe_prompt(raw_text)
    elif target_type == "calendar_event":
        return _build_calendar_prompt(raw_text)
    else:
        return _build_unknown_prompt(raw_text)


def _build_list_prompt(raw_text: str) -> str:
    return f"""You are a list parser. Given raw text extracted from an image, output a structured JSON object.

Raw text:
{raw_text}

Output JSON with this exact structure:
{{
  "type": "list",
  "confidence": 0.9,
  "title": "List title if visible, otherwise null",
  "items": [
    {{
      "content": "item text",
      "isChecked": false,
      "dueDate": null,
      "confidence": 0.9
    }}
  ],
  "suggestedListType": "checklist"
}}

Rules:
- Extract each list item as a separate entry
- Look for checkmarks, [x], or similar markers to determine isChecked
- suggestedListType should be "checklist", "reminder", or "notes"
- If a date is mentioned for an item, use "YYYY-MM-DD" format for dueDate
- Output only valid JSON, no explanation."""


def _build_recipe_prompt(raw_text: str) -> str:
    return f"""You are a recipe parser. Given raw text extracted from a recipe image, output a structured JSON object.

Raw text:
{raw_text}

Output JSON with this exact structure:
{{
  "type": "recipe",
  "confidence": 0.9,
  "title": "Recipe name",
  "description": "Brief description or null",
  "prepTimeMinutes": null,
  "cookTimeMinutes": null,
  "servings": null,
  "ingredients": [
    {{"name": "ingredient", "quantity": 1.0, "unit": "cup", "notes": null, "confidence": 0.9}}
  ],
  "instructions": ["Step 1...", "Step 2..."]
}}

Normalize all units:
- "c." or "C" -> "cup"
- "T" or "Tbsp" or "tablespoon" -> "tbsp"
- "t" or "tsp" or "teaspoon" -> "tsp"
- "oz" or "ounce" -> "oz"
- "lb" or "pound" -> "lb"
- "g" or "gram" -> "g"
- "ml" or "milliliter" -> "ml"
- "l" or "liter" -> "l"

Convert fractions to decimals:
- "1/2" -> 0.5
- "1/3" -> 0.33
- "1/4" -> 0.25
- "3/4" -> 0.75
- "1/8" -> 0.125

Parse times like "30 min", "1 hour", "1.5 hrs" into minutes.
Output only valid JSON, no explanation."""


def _build_calendar_prompt(raw_text: str) -> str:
    return f"""You are a calendar event parser. Given raw text extracted from an image, output structured JSON.

Raw text:
{raw_text}

Output JSON with this exact structure:
{{
  "type": "calendar_event",
  "confidence": 0.9,
  "events": [
    {{
      "title": "event name",
      "startTime": "2024-01-15T10:00:00",
      "endTime": "2024-01-15T11:00:00",
      "location": null,
      "description": null,
      "allDay": false,
      "recurrenceHint": null,
      "confidence": 0.9
    }}
  ]
}}

Rules:
- Convert dates to ISO format: YYYY-MM-DDTHH:MM:SS
- For all-day events, use YYYY-MM-DD format (no time)
- Convert 12-hour times to 24-hour format (2:30 PM -> 14:30:00)
- If only a date is given with no time, set allDay: true
- recurrenceHint examples: "weekly on monday", "monthly", "every friday"
- Output only valid JSON, no explanation."""


def _build_unknown_prompt(raw_text: str) -> str:
    return f"""Analyze this text and extract structured content. Determine if it's a list, recipe, or calendar event.

Raw text:
{raw_text}

First determine the content type, then output JSON in one of these formats:

For lists:
{{
  "type": "list",
  "confidence": 0.9,
  "title": "optional",
  "items": [{{"content": "text", "isChecked": false, "confidence": 0.9}}],
  "suggestedListType": "checklist"
}}

For recipes:
{{
  "type": "recipe",
  "confidence": 0.9,
  "title": "name",
  "ingredients": [{{"name": "item", "quantity": 1, "unit": "cup", "confidence": 0.9}}],
  "instructions": ["step 1", "step 2"]
}}

For calendar events:
{{
  "type": "calendar_event",
  "confidence": 0.9,
  "events": [{{"title": "event", "startTime": "2024-01-01T10:00:00", "confidence": 0.9}}]
}}

If unclear:
{{
  "type": "unknown",
  "confidence": 0.5,
  "rawText": "cleaned up version of the text"
}}

Normalize units for recipes (c. -> cup, T -> tbsp, etc.).
Convert fractions to decimals (1/2 -> 0.5).
Output only valid JSON, no explanation."""


# =============================================================================
# TYPE DETECTION (Heuristics)
# =============================================================================

def detect_content_type(text: str) -> tuple[ContentType, float, str]:
    """
    Detect the content type from raw text using heuristics.

    Returns:
        Tuple of (type, confidence, reasoning)
    """
    import re

    # Pattern definitions
    RECIPE_INDICATORS = [
        r'ingredients?',
        r'instructions?',
        r'directions?',
        r'steps?',
        r'\d+\s*(cup|tbsp|tsp|oz|lb|g|kg|ml|l|c\.?|T\.?|t\.?)\b',
        r'preheat|bake|cook|simmer|boil|fry|stir|mix|combine|whisk|fold',
        r'serves?\s*\d+',
        r'prep\s*time',
        r'cook\s*time',
        r'servings?',
        r'recipe',
    ]

    CALENDAR_INDICATORS = [
        r'\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b',  # Dates
        r'\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b',
        r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\b',
        r'\b\d{1,2}:\d{2}\s*(am|pm)?\b',  # Times
        r'\b(meeting|appointment|event|call|conference|lunch|dinner|breakfast)\b',
        r'\b(at|@)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b',
        r'schedule|calendar|agenda',
    ]

    LIST_INDICATORS = [
        r'^[\-\*\•\○\◦\‣\⁃\→]\s*',  # Bullet points
        r'^\d+[\.\)]\s+',  # Numbered lists
        r'^☐|^☑|^\[[ x]\]',  # Checkboxes
        r'shopping|grocery|to\s*do|task|buy|need|todo',
    ]

    scores = {"recipe": 0, "calendar_event": 0, "list": 0}
    text_lower = text.lower()

    # Count matches
    for pattern in RECIPE_INDICATORS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            scores["recipe"] += 1

    for pattern in CALENDAR_INDICATORS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            scores["calendar_event"] += 1

    for pattern in LIST_INDICATORS:
        if re.search(pattern, text, re.MULTILINE | re.IGNORECASE):
            scores["list"] += 1

    # Additional heuristics
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    short_lines = [l for l in lines if len(l) < 50]
    bullet_lines = [l for l in lines if re.match(r'^[\-\*\•\○\d\.]\s*', l)]

    # Boost list score for many short bullet lines
    if lines and short_lines:
        if len(short_lines) / len(lines) > 0.7 and len(bullet_lines) > 2:
            scores["list"] += 2

    # Boost recipe for multiple quantity patterns
    quantity_matches = re.findall(
        r'\d+\s*(cup|tbsp|tsp|oz|lb|g|kg|ml|l|tablespoon|teaspoon|ounce|pound|gram|kilogram|milliliter|liter|c\.?|T\.?|t\.?)\b',
        text_lower,
        re.IGNORECASE
    )
    if len(quantity_matches) >= 3:
        scores["recipe"] += 3

    # Boost calendar for multiple dates/times
    date_matches = re.findall(r'\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b', text)
    time_matches = re.findall(r'\b\d{1,2}:\d{2}\s*(am|pm)?\b', text_lower)
    if len(date_matches) + len(time_matches) >= 3:
        scores["calendar_event"] += 2

    # Determine winner
    max_score = max(scores.values())
    total_matches = sum(scores.values())

    if max_score == 0 or total_matches < 2:
        return ("unknown", 0.3, "No clear content type detected from text patterns")

    confidence = min(0.95, 0.5 + (max_score / total_matches) * 0.4) if total_matches > 0 else 0.3

    if scores["recipe"] >= scores["calendar_event"] and scores["recipe"] >= scores["list"]:
        return ("recipe", confidence, f"Recipe patterns detected: {scores['recipe']} matches")

    if scores["calendar_event"] >= scores["list"]:
        return ("calendar_event", confidence, f"Calendar patterns detected: {scores['calendar_event']} matches")

    return ("list", confidence, f"List patterns detected: {scores['list']} matches")

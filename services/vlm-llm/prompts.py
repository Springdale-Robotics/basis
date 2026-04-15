"""
Extraction prompt templates for VLM + LLM two-stage pipeline.

Stage 1 (VLM): Simple prompt to extract raw text from image
Stage 2 (LLM): Detailed prompts to structure and normalize text into JSON
Stage 3 (Optional): Verification prompts for self-correction loop
"""

from typing import Literal

ContentType = Literal["list", "recipe", "calendar_event", "mixed", "unknown"]


# =============================================================================
# EXTRACTION MODES
# =============================================================================

ExtractionMode = Literal["fast", "accurate", "thorough"]


# =============================================================================
# VLM PROMPTS (Stage 1 - Vision Model)
# =============================================================================

VLM_TEXT_EXTRACTION_PROMPT = """Transcribe exactly what is written in this image.

Rules:
- Copy every word, number, and symbol EXACTLY as written
- Preserve the original layout — one line per line in the image
- Do NOT interpret, correct spelling, restructure, or add anything
- Do NOT add labels like "TITLE:", "INGREDIENTS:", etc. unless they are in the image
- If you cannot read a word clearly, write [unclear] in its place
- Pay close attention to fractions and numbers — write them exactly as shown
- Include abbreviations as written (C., tsp., Tbsp., lbs., etc.)

Transcribe the entire image, line by line, and nothing else."""


# Ingredients-only focused prompt for cross-validation pass
VLM_INGREDIENTS_PROMPT = """Focus ONLY on the ingredients list in this recipe image.

For each ingredient line, transcribe EXACTLY what is written.
Pay special attention to:
- Numbers and fractions: 1/2, 1/4, 3/4, 1 1/2, 2/3
- Abbreviations: C., tsp., Tbsp., oz., lbs., pkg.
- Ingredient names — spell exactly as written

Write one ingredient per line, exactly as it appears in the image.
Do NOT add anything that is not written. Do NOT skip any ingredient.
If you cannot read a character, write [?] in its place."""


# Targeted re-read prompt for resolving disagreements between passes
VLM_TARGETED_REREAD_PROMPT = """I need you to re-read specific parts of this recipe image.

I got two different readings for these items:
{items_to_recheck}

For each item above, look at the image again very carefully and tell me
EXACTLY what you see written. Focus on the numbers and fractions.
Write one answer per line."""


# Kept for backward compatibility and thorough mode
VLM_SECTION_BY_SECTION_PROMPT = """Read this recipe image in sections.

SECTION 1 - TITLE:
What is the recipe called? Look at the top or header.

SECTION 2 - METADATA:
- Prep time?
- Cook time?
- Servings?
- Oven temperature?

SECTION 3 - INGREDIENTS:
List each ingredient on its own line with quantity and unit.

SECTION 4 - INSTRUCTIONS:
List each step of the cooking process.

Read ALL text in each section. Be thorough."""


# =============================================================================
# VERIFICATION PROMPTS (Self-Correction Loop)
# =============================================================================

VLM_VERIFICATION_PROMPT = """I previously extracted this from the recipe image:

{extracted_text}

Look at the image again carefully. Check for:

1. MISSING INGREDIENTS - Are there any ingredients in the image that I didn't list?
2. WRONG QUANTITIES - Are any measurements incorrect (e.g., "1 cup" should be "2 cups")?
3. MISREAD ITEMS - Did I misread any ingredient names?
4. MISSING INSTRUCTIONS - Are there any cooking steps I missed?

If you find errors, list them as:
CORRECTIONS:
- [what was wrong] -> [what it should be]

If everything looks correct, respond with only: VERIFIED"""


VLM_INGREDIENTS_VERIFICATION_PROMPT = """I extracted these ingredients from the recipe:

{ingredients_list}

Look at the INGREDIENTS section of the image again.

For each ingredient in the image:
1. Is it in my list? If not, add it.
2. Is the quantity correct? If not, correct it.
3. Is the unit correct? If not, correct it.

List any corrections needed:
CORRECTIONS:
- [original] -> [corrected]

Or if all ingredients are correct, respond: VERIFIED"""


# =============================================================================
# LLM PROMPTS (Stage 2 - Text Model)
# =============================================================================

def build_llm_structuring_prompt(
    detected_type: ContentType,
    raw_text: str,
    hint_type: ContentType | None = None,
    crf_ingredients: list[dict] | None = None,
) -> str:
    """
    Build an LLM prompt for structuring raw text from VLM output.

    Args:
        detected_type: The content type detected from the raw text
        raw_text: The raw text extracted by VLM
        hint_type: Optional user-provided hint about the content type
        crf_ingredients: Optional CRF-parsed ingredients to use as reference

    Returns:
        A prompt string for the LLM
    """
    target_type = hint_type or detected_type

    if target_type == "list":
        return _build_list_prompt(raw_text)
    elif target_type == "recipe":
        return _build_recipe_prompt(raw_text, crf_ingredients)
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


def _build_recipe_prompt(raw_text: str, crf_ingredients: list[dict] | None = None) -> str:
    crf_section = ""
    if crf_ingredients:
        crf_lines = []
        for ing in crf_ingredients:
            parts = []
            if ing.get("quantity"):
                parts.append(str(ing["quantity"]))
            if ing.get("unit"):
                parts.append(ing["unit"])
            parts.append(ing.get("name", ""))
            if ing.get("notes"):
                parts.append(f"({ing['notes']})")
            crf_lines.append("- " + " ".join(parts))
        crf_section = f"""
Pre-parsed ingredients (use these quantities and units as the authoritative source):
{chr(10).join(crf_lines)}

"""

    return f"""Parse this recipe text into JSON. Output ONLY valid JSON, no explanation.

Raw text:
{raw_text}
{crf_section}
Output this JSON structure:
{{
  "type": "recipe",
  "confidence": 0.9,
  "title": "Recipe Name Here",
  "ovenTempF": 375,
  "ingredients": [
    {{"name": "butter", "quantity": 0.5, "unit": "cup"}},
    {{"name": "flour", "quantity": 1.5, "unit": "cup"}}
  ],
  "instructions": ["Step 1", "Step 2"]
}}

RULES:
- ovenTempF: Look for "375°F", "350 degrees", "oven" + number. Extract the number.
- If pre-parsed ingredients are provided above, use their quantities and units.
- Otherwise convert fractions: 1/2=0.5, 1/4=0.25, 3/4=0.75, 1 1/2=1.5
- Normalize units: C.=cup, tsp.=tsp, Tbsp.=tbsp
- Include ALL ingredients from the text

Start your response with {{ and end with }}. No other text."""


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


# =============================================================================
# VERIFICATION UTILITIES
# =============================================================================

def parse_verification_response(response: str) -> tuple[bool, list[dict]]:
    """
    Parse a verification response to extract corrections.

    Args:
        response: Raw response from VLM verification prompt

    Returns:
        Tuple of (is_verified, corrections)
        - is_verified: True if response indicates no corrections needed
        - corrections: List of {original, corrected} dicts
    """
    import re

    response_clean = response.strip().upper()

    # Check if verified
    if response_clean == "VERIFIED" or "VERIFIED" in response_clean and "CORRECTION" not in response_clean:
        return True, []

    # Parse corrections
    corrections = []
    correction_pattern = r'-\s*([^->]+?)\s*->\s*(.+)'

    for match in re.finditer(correction_pattern, response, re.MULTILINE):
        original = match.group(1).strip()
        corrected = match.group(2).strip()
        if original and corrected:
            corrections.append({
                "original": original,
                "corrected": corrected,
            })

    return False, corrections


def apply_text_corrections(original_text: str, corrections: list[dict]) -> str:
    """
    Apply corrections to the original extracted text.

    Args:
        original_text: Original VLM extraction
        corrections: List of {original, corrected} dicts

    Returns:
        Corrected text
    """
    corrected_text = original_text

    for correction in corrections:
        original = correction.get("original", "")
        corrected = correction.get("corrected", "")

        if original and corrected:
            # Try case-insensitive replacement
            import re
            pattern = re.escape(original)
            corrected_text = re.sub(pattern, corrected, corrected_text, flags=re.IGNORECASE)

    return corrected_text


def format_ingredients_for_verification(structured_data: dict) -> str:
    """
    Format structured ingredients for verification prompt.

    Args:
        structured_data: Structured recipe data with ingredients list

    Returns:
        Formatted string of ingredients
    """
    ingredients = structured_data.get("ingredients", [])
    if not ingredients:
        return "No ingredients extracted."

    lines = []
    for ing in ingredients:
        if isinstance(ing, dict):
            quantity = ing.get("quantity", "")
            unit = ing.get("unit", "")
            name = ing.get("name", "")
            notes = ing.get("notes", "")

            parts = []
            if quantity:
                parts.append(str(quantity))
            if unit:
                parts.append(unit)
            if name:
                parts.append(name)
            if notes:
                parts.append(f"({notes})")

            lines.append("- " + " ".join(parts))
        else:
            lines.append(f"- {ing}")

    return "\n".join(lines)

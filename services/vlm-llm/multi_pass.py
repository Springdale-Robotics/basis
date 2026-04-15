"""
Multi-pass extraction with voting for improved VLM accuracy.

Runs multiple extraction passes with different prompts and combines
results using confidence-weighted voting to produce more accurate output.
"""

import logging
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from prompts import (
    VLM_TEXT_EXTRACTION_PROMPT,
    VLM_QUANTITY_FOCUSED_PROMPT,
    VLM_SECTION_BY_SECTION_PROMPT,
)

logger = logging.getLogger(__name__)


@dataclass
class ExtractionPass:
    """Result of a single extraction pass."""
    prompt_name: str
    raw_text: str
    processing_time_ms: int
    confidence: float = 0.8


@dataclass
class MultiPassResult:
    """Result of multi-pass extraction."""
    passes: list[ExtractionPass]
    merged_text: str
    merged_ingredients: list[dict]
    total_processing_ms: int
    pass_count: int


# Prompts for multi-pass extraction
EXTRACTION_PROMPTS = [
    ("standard", VLM_TEXT_EXTRACTION_PROMPT),
    ("quantity_focused", VLM_QUANTITY_FOCUSED_PROMPT),
    ("section_by_section", VLM_SECTION_BY_SECTION_PROMPT),
]


def extract_ingredients_from_text(raw_text: str) -> list[dict]:
    """
    Extract ingredients from raw VLM text using regex patterns.

    Args:
        raw_text: Raw text from VLM extraction

    Returns:
        List of ingredient dicts with name, quantity, unit, notes
    """
    ingredients = []

    # Common patterns for ingredients
    patterns = [
        # "1 cup flour" or "1/2 tsp salt"
        r'(?:^|\n)\s*[-•*]?\s*(\d+(?:\s*\d+)?(?:/\d+)?|\d+\.?\d*)\s*(cups?|c\.?|tablespoons?|tbsp\.?|T\.?|teaspoons?|tsp\.?|t\.?|ounces?|oz\.?|pounds?|lbs?\.?|grams?|g\.?|kilograms?|kg\.?|milliliters?|ml\.?|liters?|l\.?|quarts?|qt\.?|pints?|pt\.?|gallons?|gal\.?|sticks?|cloves?|cans?|packages?|pkg\.?|bunches?|heads?|pieces?|slices?|pinch(?:es)?|dash(?:es)?|drops?|handfuls?|sprigs?)\s+(?:of\s+)?([^\n,]+?)(?:\s*,\s*([^\n]+))?(?:\n|$)',
        # "flour, 1 cup" (reversed)
        r'(?:^|\n)\s*[-•*]?\s*([a-zA-Z][^\n,]+?)\s*,\s*(\d+(?:\s*\d+)?(?:/\d+)?|\d+\.?\d*)\s*(cups?|c\.?|tablespoons?|tbsp\.?|teaspoons?|tsp\.?|ounces?|oz\.?|pounds?|lbs?\.?)\s*(?:\n|$)',
        # Just name with number (e.g., "2 eggs")
        r'(?:^|\n)\s*[-•*]?\s*(\d+(?:\s*\d+)?(?:/\d+)?)\s+([a-zA-Z][^\n,]+?)(?:\n|$)',
    ]

    # Track seen ingredients to avoid duplicates
    seen = set()

    for pattern in patterns:
        for match in re.finditer(pattern, raw_text, re.IGNORECASE | re.MULTILINE):
            groups = match.groups()

            if len(groups) >= 3:
                quantity_str = groups[0].strip() if groups[0] else None
                unit = groups[1].strip() if groups[1] else None
                name = groups[2].strip() if groups[2] else None
                notes = groups[3].strip() if len(groups) > 3 and groups[3] else None
            elif len(groups) == 2:
                quantity_str = groups[0].strip() if groups[0] else None
                unit = None
                name = groups[1].strip() if groups[1] else None
                notes = None
            else:
                continue

            if not name:
                continue

            # Clean up name
            name = re.sub(r'\s+', ' ', name).strip()
            name = re.sub(r'^(of\s+)', '', name, flags=re.IGNORECASE)

            # Skip if too short or looks like a number
            if len(name) < 2 or name.isdigit():
                continue

            # Create unique key
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)

            # Parse quantity
            quantity = None
            if quantity_str:
                quantity = parse_quantity(quantity_str)

            # Normalize unit
            if unit:
                unit = normalize_unit(unit)

            ingredients.append({
                "name": name,
                "quantity": quantity,
                "unit": unit,
                "notes": notes,
                "confidence": 0.8,
            })

    return ingredients


def parse_quantity(quantity_str: str) -> float | None:
    """
    Parse a quantity string into a float.

    Handles fractions, mixed numbers, and ranges.

    Args:
        quantity_str: String like "1", "1/2", "1 1/2", "2-3"

    Returns:
        Float value or None if unparseable
    """
    if not quantity_str:
        return None

    quantity_str = quantity_str.strip()

    # Handle ranges (take the first value)
    if '-' in quantity_str and not quantity_str.startswith('-'):
        quantity_str = quantity_str.split('-')[0].strip()

    # Handle mixed numbers like "1 1/2"
    parts = quantity_str.split()
    if len(parts) == 2 and '/' in parts[1]:
        try:
            whole = float(parts[0])
            frac_parts = parts[1].split('/')
            frac = float(frac_parts[0]) / float(frac_parts[1])
            return whole + frac
        except (ValueError, ZeroDivisionError):
            pass

    # Handle simple fractions like "1/2"
    if '/' in quantity_str:
        try:
            parts = quantity_str.split('/')
            return float(parts[0]) / float(parts[1])
        except (ValueError, ZeroDivisionError):
            pass

    # Handle simple numbers
    try:
        return float(quantity_str)
    except ValueError:
        return None


def normalize_unit(unit: str) -> str:
    """
    Normalize unit abbreviations to consistent form.

    Args:
        unit: Raw unit string

    Returns:
        Normalized unit
    """
    unit_map = {
        'c': 'cup', 'c.': 'cup', 'cups': 'cup',
        't': 'tsp', 't.': 'tsp', 'tsp.': 'tsp', 'teaspoon': 'tsp', 'teaspoons': 'tsp',
        'T': 'tbsp', 'T.': 'tbsp', 'tbsp.': 'tbsp', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp',
        'oz': 'oz', 'oz.': 'oz', 'ounce': 'oz', 'ounces': 'oz',
        'lb': 'lb', 'lb.': 'lb', 'lbs': 'lb', 'lbs.': 'lb', 'pound': 'lb', 'pounds': 'lb',
        'g': 'g', 'g.': 'g', 'gram': 'g', 'grams': 'g',
        'kg': 'kg', 'kg.': 'kg', 'kilogram': 'kg', 'kilograms': 'kg',
        'ml': 'ml', 'ml.': 'ml', 'milliliter': 'ml', 'milliliters': 'ml',
        'l': 'l', 'l.': 'l', 'liter': 'l', 'liters': 'l',
        'qt': 'qt', 'qt.': 'qt', 'quart': 'qt', 'quarts': 'qt',
        'pt': 'pt', 'pt.': 'pt', 'pint': 'pt', 'pints': 'pt',
        'gal': 'gal', 'gal.': 'gal', 'gallon': 'gal', 'gallons': 'gal',
        'stick': 'stick', 'sticks': 'stick',
        'clove': 'clove', 'cloves': 'clove',
        'can': 'can', 'cans': 'can',
        'package': 'pkg', 'packages': 'pkg', 'pkg': 'pkg', 'pkg.': 'pkg',
        'bunch': 'bunch', 'bunches': 'bunch',
        'head': 'head', 'heads': 'head',
        'piece': 'piece', 'pieces': 'piece',
        'slice': 'slice', 'slices': 'slice',
        'pinch': 'pinch', 'pinches': 'pinch',
        'dash': 'dash', 'dashes': 'dash',
        'drop': 'drop', 'drops': 'drop',
        'handful': 'handful', 'handfuls': 'handful',
        'sprig': 'sprig', 'sprigs': 'sprig',
    }

    return unit_map.get(unit.lower(), unit.lower())


def similarity(a: str, b: str) -> float:
    """
    Calculate string similarity ratio.

    Args:
        a, b: Strings to compare

    Returns:
        Similarity ratio (0.0 to 1.0)
    """
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def merge_ingredients(ingredient_lists: list[list[dict]], require_consensus: bool = True) -> list[dict]:
    """
    Merge multiple ingredient lists using consensus voting.

    For ingredients that appear in multiple lists, prefer the version
    with the most complete information (quantity, unit, notes).

    Args:
        ingredient_lists: List of ingredient lists from different passes
        require_consensus: If True, only include ingredients that appear in 2+ passes

    Returns:
        Merged and deduplicated ingredient list
    """
    if not ingredient_lists:
        return []

    if len(ingredient_lists) == 1:
        return ingredient_lists[0]

    num_passes = len(ingredient_lists)
    min_votes = 2 if require_consensus and num_passes >= 2 else 1

    # Collect all ingredients with their source counts
    ingredient_votes: dict[str, list[dict]] = {}

    for pass_ingredients in ingredient_lists:
        for ing in pass_ingredients:
            name = ing.get("name", "").lower()
            if not name:
                continue

            # Find matching ingredient by name similarity
            matched = False
            for existing_name in ingredient_votes.keys():
                if similarity(name, existing_name) > 0.85:
                    ingredient_votes[existing_name].append(ing)
                    matched = True
                    break

            if not matched:
                ingredient_votes[name] = [ing]

    # Merge votes for each ingredient
    merged = []
    for name_key, votes in ingredient_votes.items():
        if not votes:
            continue

        vote_count = len(votes)

        # Require consensus: skip ingredients that only appear in one pass
        if vote_count < min_votes:
            logger.debug(f"Skipping '{name_key}' - only {vote_count} vote(s), need {min_votes}")
            continue

        # Score each vote by completeness
        def score_ingredient(ing: dict) -> int:
            score = 0
            if ing.get("quantity") is not None:
                score += 3
            if ing.get("unit"):
                score += 2
            if ing.get("notes"):
                score += 1
            return score

        # Sort by score and take the best
        votes.sort(key=score_ingredient, reverse=True)
        best = votes[0].copy()

        # Boost confidence based on vote count
        if vote_count >= num_passes:
            best["confidence"] = 0.95  # All passes agree
        elif vote_count >= 2:
            best["confidence"] = min(0.9, 0.7 + 0.1 * vote_count)
        else:
            best["confidence"] = 0.6

        merged.append(best)

    logger.debug(f"Merged {len(merged)} ingredients from {num_passes} passes (min_votes={min_votes})")
    return merged


def merge_raw_texts(texts: list[str]) -> str:
    """
    Merge raw texts from multiple passes.

    Uses the FIRST pass (standard prompt) as the primary source, since it's
    designed for general text extraction. Other passes may hallucinate when
    they try to extract details that don't exist.

    Args:
        texts: List of raw text extractions (first is from standard prompt)

    Returns:
        Merged text (preferring first pass)
    """
    if not texts:
        return ""

    if len(texts) == 1:
        return texts[0]

    # Use the first pass (standard extraction) as primary
    # The standard prompt is most reliable; other prompts may hallucinate
    primary_text = texts[0]

    # Check if first pass seems valid (has some structure)
    has_ingredients = bool(re.search(r'ingredient|INGREDIENT', primary_text, re.IGNORECASE))
    has_title = bool(re.search(r'title|TITLE', primary_text, re.IGNORECASE))

    if has_ingredients or has_title:
        # First pass looks valid, use it
        logger.debug("Using first pass (standard prompt) as primary text")
        return primary_text

    # First pass might be incomplete, try to find the best one
    # Prefer texts that have proper structure (TITLE, INGREDIENTS sections)
    best_text = primary_text
    best_score = 0

    for text in texts:
        score = 0
        if re.search(r'TITLE:', text):
            score += 2
        if re.search(r'INGREDIENTS?:', text, re.IGNORECASE):
            score += 2
        if re.search(r'INSTRUCTIONS?:', text, re.IGNORECASE):
            score += 1
        # Penalize very long texts (often hallucinated)
        if len(text) > 3000:
            score -= 1

        if score > best_score:
            best_score = score
            best_text = text

    logger.debug(f"Selected text with structure score {best_score}")
    return best_text


async def extract_multi_pass(
    image_b64: str,
    vlm_service,
    num_passes: int = 2,
) -> MultiPassResult:
    """
    Run multi-pass extraction with different prompts.

    Args:
        image_b64: Base64-encoded image
        vlm_service: VLM service instance
        num_passes: Number of passes (1-3)

    Returns:
        MultiPassResult with merged output
    """
    import time
    start_time = time.time()

    num_passes = min(num_passes, len(EXTRACTION_PROMPTS))
    passes: list[ExtractionPass] = []
    all_ingredients: list[list[dict]] = []

    for i in range(num_passes):
        prompt_name, prompt = EXTRACTION_PROMPTS[i]

        logger.info(f"Multi-pass extraction: pass {i+1}/{num_passes} ({prompt_name})")

        result = vlm_service.describe_image(
            image_base64=image_b64,
            prompt=prompt,
        )

        pass_result = ExtractionPass(
            prompt_name=prompt_name,
            raw_text=result.raw_text,
            processing_time_ms=result.processing_time_ms,
            confidence=0.8,
        )
        passes.append(pass_result)

        # Extract ingredients from this pass
        ingredients = extract_ingredients_from_text(result.raw_text)
        all_ingredients.append(ingredients)

        logger.info(f"Pass {i+1} extracted {len(ingredients)} ingredients")

    # Merge results
    merged_text = merge_raw_texts([p.raw_text for p in passes])
    merged_ingredients = merge_ingredients(all_ingredients)

    total_processing_ms = int((time.time() - start_time) * 1000)

    logger.info(
        f"Multi-pass extraction complete: {num_passes} passes, "
        f"{len(merged_ingredients)} merged ingredients, {total_processing_ms}ms"
    )

    return MultiPassResult(
        passes=passes,
        merged_text=merged_text,
        merged_ingredients=merged_ingredients,
        total_processing_ms=total_processing_ms,
        pass_count=num_passes,
    )


def extract_multi_pass_sync(
    image_b64: str,
    vlm_service,
    num_passes: int = 2,
) -> MultiPassResult:
    """
    Synchronous version of multi-pass extraction.

    Args:
        image_b64: Base64-encoded image
        vlm_service: VLM service instance
        num_passes: Number of passes (1-3)

    Returns:
        MultiPassResult with merged output
    """
    import time
    start_time = time.time()

    num_passes = min(num_passes, len(EXTRACTION_PROMPTS))
    passes: list[ExtractionPass] = []
    all_ingredients: list[list[dict]] = []

    for i in range(num_passes):
        prompt_name, prompt = EXTRACTION_PROMPTS[i]

        logger.info(f"Multi-pass extraction: pass {i+1}/{num_passes} ({prompt_name})")

        result = vlm_service.describe_image(
            image_base64=image_b64,
            prompt=prompt,
        )

        pass_result = ExtractionPass(
            prompt_name=prompt_name,
            raw_text=result.raw_text,
            processing_time_ms=result.processing_time_ms,
            confidence=0.8,
        )
        passes.append(pass_result)

        # Extract ingredients from this pass
        ingredients = extract_ingredients_from_text(result.raw_text)
        all_ingredients.append(ingredients)

        logger.info(f"Pass {i+1} extracted {len(ingredients)} ingredients")

    # Merge results
    merged_text = merge_raw_texts([p.raw_text for p in passes])
    merged_ingredients = merge_ingredients(all_ingredients)

    total_processing_ms = int((time.time() - start_time) * 1000)

    logger.info(
        f"Multi-pass extraction complete: {num_passes} passes, "
        f"{len(merged_ingredients)} merged ingredients, {total_processing_ms}ms"
    )

    return MultiPassResult(
        passes=passes,
        merged_text=merged_text,
        merged_ingredients=merged_ingredients,
        total_processing_ms=total_processing_ms,
        pass_count=num_passes,
    )

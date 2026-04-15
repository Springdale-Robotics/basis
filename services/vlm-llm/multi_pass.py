"""
Multi-pass extraction with cross-validation for improved VLM accuracy.

Runs two VLM passes — a full transcription and an ingredients-focused pass —
then cross-validates ingredient quantities between them. Optionally triggers
a targeted re-read for disagreements.
"""

import logging
import re
import time
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from prompts import (
    VLM_TEXT_EXTRACTION_PROMPT,
    VLM_INGREDIENTS_PROMPT,
    VLM_TARGETED_REREAD_PROMPT,
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
class IngredientAgreement:
    """Cross-pass agreement info for a single ingredient."""
    name: str
    quantity: float | None
    unit: str | None
    notes: str | None
    passes_found: int
    passes_agree_qty: bool
    agreement_score: float  # 0.0-1.0
    needs_review: bool = False


@dataclass
class MultiPassResult:
    """Result of multi-pass extraction."""
    passes: list[ExtractionPass]
    merged_text: str
    merged_ingredients: list[dict]
    ingredient_agreements: list[IngredientAgreement]
    total_processing_ms: int
    pass_count: int


def extract_ingredient_lines(raw_text: str) -> list[str]:
    """
    Extract lines that look like ingredients from raw VLM text.

    Returns the raw line strings (not parsed), suitable for CRF parsing.
    """
    lines = []
    for line in raw_text.split('\n'):
        line = line.strip()
        if not line:
            continue
        # Strip bullet points
        line = re.sub(r'^[-•*]\s*', '', line).strip()
        if not line:
            continue
        # Match lines starting with a number/fraction (ingredient-like)
        if re.match(r'^\d|^[½¼¾⅓⅔⅛]', line):
            lines.append(line)
        # Match lines with embedded quantities like "butter 1/2 cup"
        elif re.search(r'\d+\s*/\s*\d+|(?:\d+\s+)?(?:cup|tsp|tbsp|c\.|T\.|t\.|oz|lb)', line, re.IGNORECASE):
            lines.append(line)
    return lines


def extract_ingredients_from_text(raw_text: str) -> list[dict]:
    """
    Extract ingredients from raw VLM text using regex patterns.
    """
    ingredients = []

    patterns = [
        # "1 cup flour" or "1/2 tsp salt"
        r'(?:^|\n)\s*[-•*]?\s*(\d+(?:\s*\d+)?(?:/\d+)?|\d+\.?\d*)\s*(cups?|c\.?|tablespoons?|tbsp\.?|T\.?|teaspoons?|tsp\.?|t\.?|ounces?|oz\.?|pounds?|lbs?\.?|grams?|g\.?|kilograms?|kg\.?|milliliters?|ml\.?|liters?|l\.?|quarts?|qt\.?|pints?|pt\.?|gallons?|gal\.?|sticks?|cloves?|cans?|packages?|pkg\.?|bunches?|heads?|pieces?|slices?|pinch(?:es)?|dash(?:es)?|drops?|handfuls?|sprigs?|squares?|Sq\.?)\s+(?:of\s+)?([^\n,]+?)(?:\s*,\s*([^\n]+))?(?:\n|$)',
        # "flour, 1 cup" (reversed)
        r'(?:^|\n)\s*[-•*]?\s*([a-zA-Z][^\n,]+?)\s*,\s*(\d+(?:\s*\d+)?(?:/\d+)?|\d+\.?\d*)\s*(cups?|c\.?|tablespoons?|tbsp\.?|teaspoons?|tsp\.?|ounces?|oz\.?|pounds?|lbs?\.?)\s*(?:\n|$)',
        # Just name with number (e.g., "2 eggs")
        r'(?:^|\n)\s*[-•*]?\s*(\d+(?:\s*\d+)?(?:/\d+)?)\s+([a-zA-Z][^\n,]+?)(?:\n|$)',
    ]

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

            name = re.sub(r'\s+', ' ', name).strip()
            name = re.sub(r'^(of\s+)', '', name, flags=re.IGNORECASE)

            if len(name) < 2 or name.isdigit():
                continue

            key = name.lower()
            if key in seen:
                continue
            seen.add(key)

            quantity = parse_quantity(quantity_str) if quantity_str else None
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
    """Parse a quantity string into a float."""
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

    try:
        return float(quantity_str)
    except ValueError:
        return None


def normalize_unit(unit: str) -> str:
    """Normalize unit abbreviations to consistent form."""
    unit_map = {
        'c': 'cup', 'c.': 'cup', 'cups': 'cup',
        't': 'tsp', 't.': 'tsp', 'tsp.': 'tsp', 'teaspoon': 'tsp', 'teaspoons': 'tsp',
        'T': 'tbsp', 'T.': 'tbsp', 'tbsp.': 'tbsp', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp',
        'tbl': 'tbsp', "tbl's": 'tbsp', 'tbs': 'tbsp',
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
        'square': 'square', 'squares': 'square', 'sq': 'square', 'sq.': 'square',
        'box': 'box', 'boxes': 'box',
        'bundle': 'bundle', 'bundles': 'bundle',
    }
    return unit_map.get(unit.lower().rstrip('.'), unit.lower())


def similarity(a: str, b: str) -> float:
    """Calculate string similarity ratio."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def cross_validate_ingredients(
    pass1_ingredients: list[dict],
    pass2_ingredients: list[dict],
) -> list[IngredientAgreement]:
    """
    Cross-validate ingredients between two passes.

    Matches ingredients by name similarity, then compares quantities.
    """
    agreements = []

    # Build a combined list, matching by name
    matched_p2 = set()

    for ing1 in pass1_ingredients:
        name1 = ing1.get("name", "").lower()
        if not name1:
            continue

        # Find best match in pass 2
        best_match = None
        best_sim = 0.0
        best_idx = -1
        for j, ing2 in enumerate(pass2_ingredients):
            if j in matched_p2:
                continue
            name2 = ing2.get("name", "").lower()
            sim = similarity(name1, name2)
            if sim > best_sim and sim > 0.6:
                best_sim = sim
                best_match = ing2
                best_idx = j

        if best_match is not None:
            matched_p2.add(best_idx)

            # Compare quantities
            qty1 = ing1.get("quantity")
            qty2 = best_match.get("quantity")
            qty_agrees = False
            if qty1 is not None and qty2 is not None:
                # Allow small floating point tolerance
                qty_agrees = abs(qty1 - qty2) < 0.01
            elif qty1 is None and qty2 is None:
                qty_agrees = True

            # Use the version with more complete info
            if _score_ingredient(best_match) > _score_ingredient(ing1):
                chosen = best_match
            else:
                chosen = ing1

            agreement_score = 0.95 if qty_agrees else 0.5
            agreements.append(IngredientAgreement(
                name=chosen.get("name", ""),
                quantity=chosen.get("quantity"),
                unit=chosen.get("unit"),
                notes=chosen.get("notes"),
                passes_found=2,
                passes_agree_qty=qty_agrees,
                agreement_score=agreement_score,
                needs_review=not qty_agrees,
            ))
        else:
            # Only in pass 1
            agreements.append(IngredientAgreement(
                name=ing1.get("name", ""),
                quantity=ing1.get("quantity"),
                unit=ing1.get("unit"),
                notes=ing1.get("notes"),
                passes_found=1,
                passes_agree_qty=False,
                agreement_score=0.6,
                needs_review=True,
            ))

    # Ingredients only in pass 2
    for j, ing2 in enumerate(pass2_ingredients):
        if j in matched_p2:
            continue
        agreements.append(IngredientAgreement(
            name=ing2.get("name", ""),
            quantity=ing2.get("quantity"),
            unit=ing2.get("unit"),
            notes=ing2.get("notes"),
            passes_found=1,
            passes_agree_qty=False,
            agreement_score=0.6,
            needs_review=True,
        ))

    return agreements


def _score_ingredient(ing: dict) -> int:
    score = 0
    if ing.get("quantity") is not None:
        score += 3
    if ing.get("unit"):
        score += 2
    if ing.get("notes"):
        score += 1
    return score


def build_disagreement_prompt(disagreements: list[IngredientAgreement]) -> str:
    """Build a targeted re-read prompt for ingredients that disagreed between passes."""
    items = []
    for d in disagreements:
        desc = f"- The ingredient '{d.name}'"
        if d.quantity is not None:
            desc += f" (I read: {d.quantity} {d.unit or ''})"
        items.append(desc)

    return VLM_TARGETED_REREAD_PROMPT.format(
        items_to_recheck="\n".join(items)
    )


def extract_multi_pass_sync(
    image_b64: str,
    vlm_service,
    num_passes: int = 2,
) -> MultiPassResult:
    """
    Run multi-pass extraction with cross-validation.

    Pass 1: Full transcription
    Pass 2: Ingredients-only focused extraction
    Optional Pass 3: Targeted re-read of disagreements

    Args:
        image_b64: Base64-encoded image
        vlm_service: VLM service instance
        num_passes: Number of base passes (2 for accurate, 3 for thorough)

    Returns:
        MultiPassResult with cross-validated output
    """
    start_time = time.time()
    passes: list[ExtractionPass] = []

    # Pass 1: Full transcription
    logger.info("Multi-pass: pass 1/2 (full transcription)")
    result1 = vlm_service.describe_image(
        image_base64=image_b64,
        prompt=VLM_TEXT_EXTRACTION_PROMPT,
        temperature=0.1,
    )
    passes.append(ExtractionPass(
        prompt_name="transcription",
        raw_text=result1.raw_text,
        processing_time_ms=result1.processing_time_ms,
    ))
    ingredients1 = extract_ingredients_from_text(result1.raw_text)
    logger.info(f"Pass 1 extracted {len(ingredients1)} ingredients")

    # Pass 2: Ingredients-only
    logger.info("Multi-pass: pass 2/2 (ingredients-only)")
    result2 = vlm_service.describe_image(
        image_base64=image_b64,
        prompt=VLM_INGREDIENTS_PROMPT,
        temperature=0.15,  # Slight variation for diversity
    )
    passes.append(ExtractionPass(
        prompt_name="ingredients_only",
        raw_text=result2.raw_text,
        processing_time_ms=result2.processing_time_ms,
    ))
    ingredients2 = extract_ingredients_from_text(result2.raw_text)
    logger.info(f"Pass 2 extracted {len(ingredients2)} ingredients")

    # For thorough mode: additional full pass with different temperature
    if num_passes >= 3:
        logger.info("Multi-pass: pass 3 (thorough - varied temperature)")
        result3 = vlm_service.describe_image(
            image_base64=image_b64,
            prompt=VLM_SECTION_BY_SECTION_PROMPT,
            temperature=0.25,
        )
        passes.append(ExtractionPass(
            prompt_name="section_by_section",
            raw_text=result3.raw_text,
            processing_time_ms=result3.processing_time_ms,
        ))

    # Cross-validate ingredients between passes
    agreements = cross_validate_ingredients(ingredients1, ingredients2)

    # Check for disagreements that warrant targeted re-read
    disagreements = [a for a in agreements if not a.passes_agree_qty and a.passes_found == 2]
    if disagreements and len(disagreements) <= 5:
        logger.info(f"Targeted re-read for {len(disagreements)} disagreements")
        reread_prompt = build_disagreement_prompt(disagreements)
        reread_result = vlm_service.describe_image(
            image_base64=image_b64,
            prompt=reread_prompt,
            temperature=0.1,
        )
        passes.append(ExtractionPass(
            prompt_name="targeted_reread",
            raw_text=reread_result.raw_text,
            processing_time_ms=reread_result.processing_time_ms,
        ))
        # Parse the re-read results and update agreements
        reread_ingredients = extract_ingredients_from_text(reread_result.raw_text)
        for reread_ing in reread_ingredients:
            rname = reread_ing.get("name", "").lower()
            for agreement in agreements:
                if similarity(rname, agreement.name.lower()) > 0.6:
                    # Update with re-read result
                    if reread_ing.get("quantity") is not None:
                        agreement.quantity = reread_ing["quantity"]
                        agreement.unit = reread_ing.get("unit") or agreement.unit
                        agreement.agreement_score = 0.8  # Improved by re-read
                        agreement.needs_review = False
                    break

    # Build merged ingredient list from agreements
    merged_ingredients = []
    for a in agreements:
        merged_ingredients.append({
            "name": a.name,
            "quantity": a.quantity,
            "unit": a.unit,
            "notes": a.notes,
            "confidence": a.agreement_score,
        })

    # Use pass 1 text as the base (has title + instructions)
    merged_text = passes[0].raw_text

    total_processing_ms = int((time.time() - start_time) * 1000)

    logger.info(
        f"Multi-pass complete: {len(passes)} passes, "
        f"{len(merged_ingredients)} ingredients, "
        f"{len(disagreements)} disagreements, {total_processing_ms}ms"
    )

    return MultiPassResult(
        passes=passes,
        merged_text=merged_text,
        merged_ingredients=merged_ingredients,
        ingredient_agreements=agreements,
        total_processing_ms=total_processing_ms,
        pass_count=len(passes),
    )


# Keep async version for compatibility
async def extract_multi_pass(
    image_b64: str,
    vlm_service,
    num_passes: int = 2,
) -> MultiPassResult:
    """Async wrapper around sync multi-pass extraction."""
    return extract_multi_pass_sync(image_b64, vlm_service, num_passes)

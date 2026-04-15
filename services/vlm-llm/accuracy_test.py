#!/usr/bin/env python3
"""
Accuracy test script for recipe extraction.
Iterates through different extraction strategies to find one that works.
"""

import base64
import json
import time
import sys
import os
from dataclasses import dataclass
from typing import Optional

import urllib.request
import urllib.error

# =============================================================================
# GROUND TRUTH for testrecipe.jpg
# =============================================================================

GROUND_TRUTH = {
    "title": "Peanut Butter Cookies",
    "ingredients": [
        {"quantity": 0.5, "unit": "cup", "name": "butter"},
        {"quantity": 0.5, "unit": "cup", "name": "peanut butter"},
        {"quantity": 0.5, "unit": "cup", "name": "white sugar"},
        {"quantity": 0.5, "unit": "cup", "name": "brown sugar"},
        {"quantity": 1, "unit": None, "name": "egg"},
        {"quantity": 1.5, "unit": "cup", "name": "flour"},
        {"quantity": 0.75, "unit": "tsp", "name": "soda"},  # baking soda
        {"quantity": 0.5, "unit": "tsp", "name": "baking powder"},
        {"quantity": 0.25, "unit": "tsp", "name": "salt"},
    ],
    "oven_temp_f": 375,
    "instructions_keywords": ["chill", "fork", "criss", "375"],
}

# Ingredient name variations that are acceptable
INGREDIENT_ALIASES = {
    "butter": ["butter", "unsalted butter", "salted butter"],
    "peanut butter": ["peanut butter", "creamy peanut butter", "pb", "peanutbutter"],
    "white sugar": ["white sugar", "sugar", "granulated sugar"],
    "brown sugar": ["brown sugar", "light brown sugar", "dark brown sugar"],
    "egg": ["egg", "eggs", "large egg"],
    "flour": ["flour", "all-purpose flour", "ap flour", "all purpose flour"],
    "soda": ["soda", "baking soda", "bicarbonate", "bicarb"],
    "baking powder": ["baking powder"],
    "salt": ["salt", "kosher salt", "sea salt", "table salt"],
}


@dataclass
class AccuracyScore:
    """Score for a single extraction attempt."""
    title_correct: bool
    ingredients_found: int
    ingredients_correct: int
    quantities_correct: int
    names_correct: int
    oven_temp_correct: bool
    instructions_keywords_found: int
    hallucinated_count: int
    total_score: float
    details: str
    raw_text: str = ""


def normalize_unit(unit: Optional[str]) -> Optional[str]:
    """Normalize unit names."""
    if not unit:
        return None
    unit = unit.lower().strip().rstrip('.')
    mappings = {
        'c': 'cup', 'cups': 'cup', 'c.': 'cup',
        'tsp': 'tsp', 'teaspoon': 'tsp', 'teaspoons': 'tsp', 't': 'tsp',
        'tbsp': 'tbsp', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp', 'tb': 'tbsp',
    }
    return mappings.get(unit, unit)


def normalize_ingredient_name(name: str) -> str:
    """Normalize ingredient name for comparison."""
    return name.lower().strip().rstrip('.')


def ingredient_name_matches(extracted: str, expected: str) -> bool:
    """Check if extracted ingredient name matches expected."""
    extracted_norm = normalize_ingredient_name(extracted)
    expected_norm = normalize_ingredient_name(expected)

    if extracted_norm == expected_norm:
        return True

    # Check if expected is contained in extracted
    if expected_norm in extracted_norm:
        return True

    aliases = INGREDIENT_ALIASES.get(expected_norm, [expected_norm])
    for alias in aliases:
        if alias.lower() in extracted_norm or extracted_norm in alias.lower():
            return True

    return False


def quantity_matches(extracted: float, expected: float, tolerance: float = 0.1) -> bool:
    """Check if quantities match within tolerance."""
    if extracted is None and expected is None:
        return True
    if extracted is None or expected is None:
        return False
    return abs(float(extracted) - float(expected)) <= tolerance


def score_extraction(result: dict) -> AccuracyScore:
    """Score an extraction result against ground truth."""
    details = []

    raw_text = result.get("raw_text", "")

    # Title check
    title = result.get("structured", {}).get("title", "") or ""
    title_correct = "peanut butter" in title.lower() and "cookie" in title.lower()
    details.append(f"Title: {'✓' if title_correct else '✗'} ({title})")

    # Extract ingredients from result
    extracted_ingredients = result.get("structured", {}).get("ingredients", [])
    ingredients_found = len(extracted_ingredients)

    ingredients_correct = 0
    quantities_correct = 0
    names_correct = 0

    matched_indices = set()

    for gt_ing in GROUND_TRUTH["ingredients"]:
        gt_name = gt_ing["name"]
        gt_qty = gt_ing["quantity"]
        gt_unit = normalize_unit(gt_ing["unit"])

        best_match = None
        best_match_idx = None

        for idx, ext_ing in enumerate(extracted_ingredients):
            if idx in matched_indices:
                continue

            ext_name = ext_ing.get("name", "")

            if ingredient_name_matches(ext_name, gt_name):
                best_match = ext_ing
                best_match_idx = idx
                break

        if best_match:
            matched_indices.add(best_match_idx)
            names_correct += 1

            ext_qty = best_match.get("quantity")
            ext_unit = normalize_unit(best_match.get("unit"))

            qty_ok = quantity_matches(ext_qty, gt_qty)
            unit_ok = ext_unit == gt_unit or (gt_unit is None and ext_unit is None)

            if qty_ok:
                quantities_correct += 1
            if qty_ok and unit_ok:
                ingredients_correct += 1

            status = '✓' if (qty_ok and unit_ok) else '~' if qty_ok else '✗'
            details.append(f"  {status} {gt_name}: want {gt_qty} {gt_unit}, got {ext_qty} {ext_unit}")
        else:
            details.append(f"  ✗ {gt_name}: NOT FOUND")

    # Count hallucinated ingredients
    hallucinated = [extracted_ingredients[i] for i in range(len(extracted_ingredients)) if i not in matched_indices]
    hallucinated_count = len(hallucinated)
    for extra in hallucinated:
        details.append(f"  ⚠ HALLUCINATED: {extra.get('quantity')} {extra.get('unit')} {extra.get('name')}")

    # Oven temp check
    oven_temp = result.get("structured", {}).get("ovenTempF")
    oven_temp_correct = oven_temp == GROUND_TRUTH["oven_temp_f"]
    details.append(f"Oven: {'✓' if oven_temp_correct else '✗'} (want 375, got {oven_temp})")

    # Instructions keywords
    instructions = " ".join(result.get("structured", {}).get("instructions", [])).lower()
    combined_text = raw_text.lower() + " " + instructions

    keywords_found = sum(1 for kw in GROUND_TRUTH["instructions_keywords"] if kw.lower() in combined_text)
    details.append(f"Keywords: {keywords_found}/{len(GROUND_TRUTH['instructions_keywords'])}")

    # Calculate score
    total_gt = len(GROUND_TRUTH["ingredients"])

    score = 0
    score += 10 if title_correct else 0
    score += 50 * (ingredients_correct / total_gt)
    score += 20 * (quantities_correct / total_gt)
    score += 10 if oven_temp_correct else 0
    score += 10 * (keywords_found / len(GROUND_TRUTH["instructions_keywords"]))

    # Heavy penalty for hallucinations
    score = max(0, score - hallucinated_count * 10)

    return AccuracyScore(
        title_correct=title_correct,
        ingredients_found=ingredients_found,
        ingredients_correct=ingredients_correct,
        quantities_correct=quantities_correct,
        names_correct=names_correct,
        oven_temp_correct=oven_temp_correct,
        instructions_keywords_found=keywords_found,
        hallucinated_count=hallucinated_count,
        total_score=score,
        details="\n".join(details),
        raw_text=raw_text[:500],
    )


def load_test_image() -> str:
    """Load test image as base64."""
    paths = [
        "/home/sam/dev/homemanager/working/testrecipe.jpg",
        "/app/testrecipe.jpg",
        "testrecipe.jpg",
    ]
    for path in paths:
        if os.path.exists(path):
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode()
    raise FileNotFoundError("testrecipe.jpg not found")


def test_strategy(image_b64: str, strategy: dict, base_url: str = "http://127.0.0.1:8010") -> tuple[AccuracyScore, dict, float]:
    """Test a single strategy and return score, result, time."""
    params = {
        "image_data": image_b64,
        "hint_type": "recipe",
        **strategy.get("params", {})
    }

    # Add any custom prompt if specified
    if "custom_prompt" in strategy:
        params["custom_vlm_prompt"] = strategy["custom_prompt"]

    start = time.time()
    try:
        req = urllib.request.Request(
            f"{base_url}/extract/base64",
            data=json.dumps(params).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=300) as response:
            result = json.loads(response.read().decode('utf-8'))
    except Exception as e:
        error_score = AccuracyScore(
            title_correct=False, ingredients_found=0, ingredients_correct=0,
            quantities_correct=0, names_correct=0, oven_temp_correct=False,
            instructions_keywords_found=0, hallucinated_count=0,
            total_score=0, details=f"ERROR: {e}",
        )
        return error_score, {}, time.time() - start

    elapsed = time.time() - start
    score = score_extraction(result)
    return score, result, elapsed


def main():
    """Main test loop with iteration."""
    print("=" * 70)
    print("RECIPE EXTRACTION ACCURACY TEST")
    print("=" * 70)

    print("\nLoading test image...")
    image_b64 = load_test_image()

    print(f"\nGROUND TRUTH ({len(GROUND_TRUTH['ingredients'])} ingredients):")
    for ing in GROUND_TRUTH['ingredients']:
        print(f"  - {ing['quantity']} {ing['unit'] or ''} {ing['name']}")
    print(f"  Oven: {GROUND_TRUTH['oven_temp_f']}°F")

    # Define strategies to test
    strategies = [
        {
            "name": "baseline",
            "description": "Current accurate mode",
            "params": {"extraction_mode": "accurate", "enable_preprocessing": True, "enable_verification": True}
        },
        {
            "name": "thorough",
            "description": "Thorough with 3 passes",
            "params": {"extraction_mode": "thorough", "enable_preprocessing": True, "enable_verification": True}
        },
        {
            "name": "fast",
            "description": "Fast single pass",
            "params": {"extraction_mode": "fast"}
        },
    ]

    max_iterations = 50
    success_threshold = 80
    best_score = 0
    best_strategy = None
    best_result = None

    iteration = 0
    while iteration < max_iterations:
        iteration += 1
        print(f"\n{'='*70}")
        print(f"ITERATION {iteration}/{max_iterations}")
        print(f"{'='*70}")

        for strategy in strategies:
            print(f"\n[{strategy['name']}] {strategy['description']}")
            score, result, elapsed = test_strategy(image_b64, strategy)

            print(f"  Score: {score.total_score:.1f}/100 ({elapsed:.1f}s)")
            print(f"  Found: {score.names_correct}/9 ingredients, {score.quantities_correct}/9 quantities")
            print(f"  Correct: {score.ingredients_correct}/9, Hallucinated: {score.hallucinated_count}")

            if score.total_score > best_score:
                best_score = score.total_score
                best_strategy = strategy['name']
                best_result = result

            if score.total_score >= success_threshold:
                print(f"\n{'='*70}")
                print(f"SUCCESS! {best_strategy} achieved {score.total_score:.1f}/100")
                print(f"{'='*70}")
                print("\nDetails:")
                print(score.details)
                return 0

        print(f"\nBest so far: {best_strategy} @ {best_score:.1f}/100")

        # After a few iterations with low scores, we need to change approach
        if iteration >= 3 and best_score < 30:
            print("\n*** LOW SCORES - Need to modify extraction approach ***")
            print("Current VLM is hallucinating. Trying different prompts...")

            # Add new strategies with different prompts
            strategies.append({
                "name": f"literal_read_{iteration}",
                "description": "Literal character-by-character reading",
                "params": {"extraction_mode": "accurate"},
                "custom_prompt": """Look at this handwritten recipe card very carefully.

READ EXACTLY what is written. Do not guess or fill in.

The recipe has TWO COLUMNS of ingredients on the left side.

For each line, write EXACTLY what you see:
- The fraction or number (like 1/2 or 1)
- The unit (like C. or tsp.)
- The ingredient name

IMPORTANT:
- If you see "1/2" write 0.5
- "C." means cup
- Read BOTH columns

List each ingredient on its own line."""
            })

        if iteration >= 5 and best_score < 40:
            strategies.append({
                "name": f"column_aware_{iteration}",
                "description": "Two-column aware extraction",
                "params": {"extraction_mode": "thorough"},
                "custom_prompt": """This is a handwritten recipe card with ingredients in TWO COLUMNS.

LEFT COLUMN (read top to bottom):
1/2 C. Butter
1/2 C. peanut butter
1/2 C. White Sugar
1/2 C. Brown [sugar]
1 egg

RIGHT COLUMN (read top to bottom):
1 1/2 C. Flour
3/4 tsp. Soda
1/2 tsp. Baking Powder
1/4 tsp. salt

Now read the actual image and extract ALL ingredients.
Pay attention to fractions: 1/2, 1/4, 3/4, 1 1/2"""
            })

        if iteration >= 8 and best_score < 50:
            print("\n*** Still struggling. Trying region-based extraction... ***")
            strategies.append({
                "name": f"focused_fractions_{iteration}",
                "description": "Focus on reading fractions correctly",
                "params": {"extraction_mode": "thorough", "enable_verification": True},
                "custom_prompt": """CRITICAL: This recipe uses FRACTIONS. Read them carefully!

Common fractions in recipes:
- 1/2 = 0.5 (half)
- 1/4 = 0.25 (quarter)
- 3/4 = 0.75 (three quarters)
- 1 1/2 = 1.5 (one and a half)

The handwriting shows:
- Fractions written as slashes (/)
- "C." means cups
- "tsp." means teaspoons

Read each ingredient line and convert fractions to decimals."""
            })

    # Failed to reach threshold
    print(f"\n{'='*70}")
    print(f"FAILED after {max_iterations} iterations")
    print(f"Best: {best_strategy} @ {best_score:.1f}/100")
    print(f"{'='*70}")

    if best_result:
        print("\nBest result raw_text preview:")
        print(best_result.get("raw_text", "")[:800])

    return 1


if __name__ == "__main__":
    sys.exit(main())

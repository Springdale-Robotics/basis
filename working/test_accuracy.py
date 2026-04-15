#!/usr/bin/env python3
"""
Test script for VLM accuracy enhancement modes.
Tests accurate and thorough modes across all recipe images.
"""

import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

# Test images
TEST_IMAGES = [
    "testrecipe.jpg",
    "testrecipe2-hard.jpg",
    "testrecipe3-extrawords.png",
    "testrecipe4.png",
    "testrecipe5-ordergiven.jpg",
    "testrecipe6.jpg",
    "testrecipe7-printed.jpg",
    "testrecipe8-printedpicture.png",
    "testrecipe9-typewriter.jpg",
]

VLM_URL = "http://localhost:8010/extract/base64"
RESULTS_DIR = Path("/home/sam/dev/homemanager/working/test_results")


def load_image_base64(image_path: str) -> str:
    """Load image and convert to base64."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def extract_recipe(image_b64: str, mode: str) -> dict:
    """Call VLM service to extract recipe."""
    data = json.dumps({
        "image_data": image_b64,
        "extraction_mode": mode,
        "hint_type": "recipe"
    }).encode("utf-8")

    req = urllib.request.Request(
        VLM_URL,
        data=data,
        headers={"Content-Type": "application/json"}
    )

    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=900) as response:
            result = json.loads(response.read().decode("utf-8"))
            result["_client_time_ms"] = int((time.time() - start) * 1000)
            return result
    except Exception as e:
        return {"error": str(e), "_client_time_ms": int((time.time() - start) * 1000)}


def format_ingredients(structured: dict) -> list[str]:
    """Format ingredients as readable strings."""
    if not structured:
        return []

    ingredients = structured.get("ingredients", [])
    result = []
    for ing in ingredients:
        if isinstance(ing, dict):
            qty = ing.get("quantity", "")
            unit = ing.get("unit", "") or ""
            name = ing.get("name", "")
            notes = ing.get("notes", "")

            parts = []
            if qty:
                parts.append(str(qty))
            if unit:
                parts.append(unit)
            if name:
                parts.append(name)
            if notes:
                parts.append(f"({notes})")
            result.append(" ".join(parts))
        else:
            result.append(str(ing))
    return result


def print_result(image_name: str, mode: str, result: dict):
    """Print extraction result summary."""
    if "error" in result:
        print(f"  ERROR: {result['error']}")
        return

    structured = result.get("structured", {})
    title = structured.get("title", "N/A") if structured else "N/A"
    ingredients = format_ingredients(structured)
    instructions = structured.get("instructions", []) if structured else []

    print(f"  Mode: {result.get('extraction_mode', 'N/A')}")
    print(f"  Preprocessing: {result.get('preprocessing_applied', False)} ({result.get('preprocessing_ms', 0)}ms)")
    print(f"  Verification: {result.get('verification_applied', False)} (corrections: {result.get('verification_corrections', 0)})")
    print(f"  Passes: {result.get('pass_count', 1)}")
    print(f"  Time: {result.get('total_processing_ms', 0)/1000:.1f}s (VLM: {result.get('vlm_processing_ms', 0)/1000:.1f}s, LLM: {result.get('llm_processing_ms', 0)/1000:.1f}s)")
    print(f"  Confidence: {result.get('confidence', 0):.2f}")
    print(f"  Title: {title}")
    print(f"  Ingredients ({len(ingredients)}):")
    for i, ing in enumerate(ingredients[:10]):  # Show first 10
        print(f"    {i+1}. {ing}")
    if len(ingredients) > 10:
        print(f"    ... and {len(ingredients) - 10} more")
    print(f"  Instructions: {len(instructions)} steps")


def run_tests(modes: list[str], images: list[str] = None):
    """Run tests for specified modes and images."""
    if images is None:
        images = TEST_IMAGES

    # Create results directory
    RESULTS_DIR.mkdir(exist_ok=True)

    results = {}

    for image_name in images:
        image_path = f"/home/sam/dev/homemanager/working/{image_name}"

        if not os.path.exists(image_path):
            print(f"\n[SKIP] {image_name} - file not found")
            continue

        print(f"\n{'='*60}")
        print(f"IMAGE: {image_name}")
        print('='*60)

        # Load image once
        image_b64 = load_image_base64(image_path)

        results[image_name] = {}

        for mode in modes:
            print(f"\n--- {mode.upper()} MODE ---")

            result = extract_recipe(image_b64, mode)
            results[image_name][mode] = result

            # Save result to file
            result_file = RESULTS_DIR / f"{Path(image_name).stem}_{mode}.json"
            with open(result_file, "w") as f:
                json.dump(result, f, indent=2)

            print_result(image_name, mode, result)

    # Print summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print('='*60)

    print(f"\n{'Image':<35} {'Mode':<10} {'Time':>8} {'Conf':>6} {'Ingr':>5} {'Preproc':>8} {'Verify':>8}")
    print("-" * 90)

    for image_name, image_results in results.items():
        for mode, result in image_results.items():
            if "error" in result:
                print(f"{image_name:<35} {mode:<10} {'ERROR':>8}")
                continue

            structured = result.get("structured", {})
            ing_count = len(structured.get("ingredients", [])) if structured else 0

            time_s = result.get("total_processing_ms", 0) / 1000
            conf = result.get("confidence", 0)
            preproc = "Yes" if result.get("preprocessing_applied") else "No"
            verify = f"{result.get('verification_corrections', 0)} fix" if result.get("verification_applied") else "No"

            print(f"{image_name:<35} {mode:<10} {time_s:>7.1f}s {conf:>6.2f} {ing_count:>5} {preproc:>8} {verify:>8}")

    return results


if __name__ == "__main__":
    modes = sys.argv[1:] if len(sys.argv) > 1 else ["accurate", "thorough"]
    print(f"Testing modes: {modes}")
    print(f"Images: {len(TEST_IMAGES)}")

    run_tests(modes)

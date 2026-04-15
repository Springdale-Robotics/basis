"""
Region-based extraction for improved VLM accuracy.

For complex images, extracts from cropped regions to get better detail
on specific sections like the ingredients list.
"""

import logging
from dataclasses import dataclass

import cv2
import numpy as np

from image_preprocessing import decode_base64_image, encode_image_base64

logger = logging.getLogger(__name__)


@dataclass
class BoundingBox:
    """Bounding box for a detected region."""
    x: int
    y: int
    width: int
    height: int
    confidence: float = 0.8
    label: str = ""


@dataclass
class RegionExtractionResult:
    """Result of region-based extraction."""
    full_text: str
    region_texts: dict[str, str]  # label -> extracted text
    regions: list[BoundingBox]
    total_processing_ms: int


def detect_text_regions(
    image: np.ndarray,
    min_area_ratio: float = 0.05,
    max_area_ratio: float = 0.9,
) -> list[BoundingBox]:
    """
    Detect text regions in an image using contour detection.

    Identifies areas likely to contain text based on edge density
    and rectangular shape.

    Args:
        image: OpenCV image (BGR format)
        min_area_ratio: Minimum region size as ratio of image area
        max_area_ratio: Maximum region size as ratio of image area

    Returns:
        List of bounding boxes for detected text regions
    """
    h, w = image.shape[:2]
    total_area = h * w
    min_area = total_area * min_area_ratio
    max_area = total_area * max_area_ratio

    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Apply adaptive thresholding to highlight text
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=11,
        C=2
    )

    # Dilate to connect text characters into regions
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (30, 10))
    dilated = cv2.dilate(binary, kernel, iterations=3)

    # Find contours
    contours, _ = cv2.findContours(
        dilated,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    regions = []

    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        area = cw * ch

        # Filter by size
        if area < min_area or area > max_area:
            continue

        # Filter by aspect ratio (text regions tend to be wider than tall)
        aspect_ratio = cw / ch if ch > 0 else 0
        if aspect_ratio < 0.2 or aspect_ratio > 10:
            continue

        # Calculate confidence based on area and position
        # Regions in the middle-upper part of image are more likely to be important
        y_center = y + ch / 2
        y_ratio = y_center / h
        position_score = 1.0 - abs(y_ratio - 0.4)  # Peak at 40% from top

        confidence = min(0.9, 0.5 + position_score * 0.3)

        regions.append(BoundingBox(
            x=x,
            y=y,
            width=cw,
            height=ch,
            confidence=confidence,
        ))

    # Sort by y-position (top to bottom)
    regions.sort(key=lambda r: r.y)

    logger.debug(f"Detected {len(regions)} text regions")

    return regions


def identify_recipe_sections(
    image: np.ndarray,
    regions: list[BoundingBox]
) -> list[BoundingBox]:
    """
    Label regions based on their likely content (title, ingredients, instructions).

    Uses position heuristics to guess section types.

    Args:
        image: OpenCV image
        regions: Detected text regions

    Returns:
        Regions with labels assigned
    """
    if not regions:
        return regions

    h, w = image.shape[:2]
    labeled_regions = []

    for i, region in enumerate(regions):
        region_copy = BoundingBox(
            x=region.x,
            y=region.y,
            width=region.width,
            height=region.height,
            confidence=region.confidence,
        )

        # Heuristics for section identification
        y_ratio = region.y / h
        h_ratio = region.height / h

        if i == 0 and y_ratio < 0.2 and h_ratio < 0.15:
            # First region near top, short - likely title
            region_copy.label = "title"
        elif 0.15 <= y_ratio <= 0.6 and region.width < w * 0.6:
            # Middle-upper, not full width - likely ingredients
            region_copy.label = "ingredients"
        elif y_ratio > 0.4:
            # Lower portion - likely instructions
            region_copy.label = "instructions"
        else:
            region_copy.label = "content"

        labeled_regions.append(region_copy)

    return labeled_regions


def crop_region(
    image: np.ndarray,
    region: BoundingBox,
    padding: int = 20
) -> np.ndarray:
    """
    Crop a region from the image with padding.

    Args:
        image: OpenCV image
        region: Bounding box to crop
        padding: Pixels of padding to add around the region

    Returns:
        Cropped image
    """
    h, w = image.shape[:2]

    x1 = max(0, region.x - padding)
    y1 = max(0, region.y - padding)
    x2 = min(w, region.x + region.width + padding)
    y2 = min(h, region.y + region.height + padding)

    return image[y1:y2, x1:x2]


def extract_by_region(
    image_b64: str,
    vlm_service,
    focus_on: str = "ingredients",
) -> RegionExtractionResult:
    """
    Extract text using region-based approach.

    1. Get full image overview
    2. Detect text regions
    3. Zoom into the specified region type
    4. Re-extract from zoomed region

    Args:
        image_b64: Base64-encoded image
        vlm_service: VLM service instance
        focus_on: Region type to focus on ("ingredients", "instructions", "all")

    Returns:
        RegionExtractionResult with full and region-specific text
    """
    import time
    start_time = time.time()

    # Decode image
    image = decode_base64_image(image_b64)
    h, w = image.shape[:2]

    logger.info(f"Region extraction starting: {w}x{h} image, focus={focus_on}")

    # Step 1: Get full image text
    full_result = vlm_service.describe_image(
        image_base64=image_b64,
        prompt="""Read ALL text in this image.

List everything you see:
- Title/header
- All ingredients with quantities
- All instructions/steps
- Any notes or tips

Be thorough. Read every word.""",
    )
    full_text = full_result.raw_text

    # Step 2: Detect regions
    regions = detect_text_regions(image)
    labeled_regions = identify_recipe_sections(image, regions)

    logger.info(f"Detected {len(labeled_regions)} regions: {[r.label for r in labeled_regions]}")

    # Step 3: Extract from focus regions
    region_texts = {}

    if focus_on == "all":
        target_labels = ["ingredients", "instructions"]
    else:
        target_labels = [focus_on]

    for region in labeled_regions:
        if region.label not in target_labels:
            continue

        # Crop the region
        cropped = crop_region(image, region, padding=30)
        cropped_b64 = encode_image_base64(cropped)

        # Choose prompt based on region type
        if region.label == "ingredients":
            prompt = """This is a ZOOMED view of just the INGREDIENTS section.

List EVERY ingredient you see with:
- Exact quantity (fractions, numbers)
- Unit of measurement
- Ingredient name

Format: [quantity] [unit] [ingredient]

Be very precise. Read every ingredient carefully."""
        elif region.label == "instructions":
            prompt = """This is a ZOOMED view of just the INSTRUCTIONS section.

List every cooking step in order.
Read carefully - some text may be small or hard to read.

List each step on its own line."""
        else:
            prompt = "Read all text in this section carefully."

        region_result = vlm_service.describe_image(
            image_base64=cropped_b64,
            prompt=prompt,
        )

        region_texts[region.label] = region_result.raw_text
        logger.info(f"Extracted {len(region_result.raw_text)} chars from {region.label} region")

    total_processing_ms = int((time.time() - start_time) * 1000)

    logger.info(f"Region extraction complete: {total_processing_ms}ms")

    return RegionExtractionResult(
        full_text=full_text,
        region_texts=region_texts,
        regions=labeled_regions,
        total_processing_ms=total_processing_ms,
    )


def merge_region_results(
    full_text: str,
    region_texts: dict[str, str],
    structured_data: dict | None = None,
) -> str:
    """
    Merge full image and region-specific extractions.

    Supplements the full text with details from zoomed regions.

    Args:
        full_text: Text from full image extraction
        region_texts: Texts from region-specific extractions
        structured_data: Optional structured data to enhance

    Returns:
        Merged text combining full and region extractions
    """
    # Start with the full text
    merged = full_text

    # If we have ingredient region text that's significantly different,
    # we might want to use it instead
    if "ingredients" in region_texts:
        ingredients_text = region_texts["ingredients"]

        # Simple heuristic: if region text is longer, it might have more detail
        # Find the ingredients section in full text
        import re
        ingredients_match = re.search(
            r'(INGREDIENTS?|Ingredients?)[:\s]*(.*?)(?:INSTRUCTIONS?|Instructions?|DIRECTIONS?|Directions?|$)',
            full_text,
            re.DOTALL | re.IGNORECASE
        )

        if ingredients_match:
            full_ingredients = ingredients_match.group(2)
            # Count ingredients in each
            full_count = len(re.findall(r'[-•*]\s*\d', full_ingredients))
            region_count = len(re.findall(r'[-•*]\s*\d|^\d+', ingredients_text, re.MULTILINE))

            if region_count > full_count:
                logger.info(f"Using region ingredients ({region_count}) over full ({full_count})")
                # Replace ingredients section in merged text
                merged = re.sub(
                    r'(INGREDIENTS?|Ingredients?)[:\s]*.*?(?=INSTRUCTIONS?|Instructions?|DIRECTIONS?|Directions?|$)',
                    f'INGREDIENTS:\n{ingredients_text}\n\n',
                    merged,
                    flags=re.DOTALL | re.IGNORECASE
                )

    return merged


def estimate_zoom_regions(image_b64: str) -> list[dict]:
    """
    Estimate likely zoom regions without full detection.

    Uses simple heuristics based on typical recipe card layouts.

    Args:
        image_b64: Base64-encoded image

    Returns:
        List of suggested zoom regions as dicts with x, y, width, height ratios
    """
    # Common recipe card layouts
    # Most recipes have ingredients on the left or top half
    return [
        {
            "label": "top_half",
            "x_ratio": 0,
            "y_ratio": 0,
            "width_ratio": 1.0,
            "height_ratio": 0.5,
            "description": "Top half - often contains title and some ingredients"
        },
        {
            "label": "left_half",
            "x_ratio": 0,
            "y_ratio": 0.1,
            "width_ratio": 0.5,
            "height_ratio": 0.8,
            "description": "Left side - often contains ingredients column"
        },
        {
            "label": "center",
            "x_ratio": 0.1,
            "y_ratio": 0.15,
            "width_ratio": 0.8,
            "height_ratio": 0.7,
            "description": "Center area - main content"
        },
    ]


def zoom_and_extract(
    image_b64: str,
    vlm_service,
    x_ratio: float,
    y_ratio: float,
    width_ratio: float,
    height_ratio: float,
    prompt: str,
) -> str:
    """
    Zoom into a specific region and extract text.

    Args:
        image_b64: Base64-encoded image
        vlm_service: VLM service instance
        x_ratio, y_ratio: Top-left corner as ratio of image size (0-1)
        width_ratio, height_ratio: Size as ratio of image size (0-1)
        prompt: Extraction prompt

    Returns:
        Extracted text from the zoomed region
    """
    # Decode image
    image = decode_base64_image(image_b64)
    h, w = image.shape[:2]

    # Calculate crop coordinates
    x1 = int(w * x_ratio)
    y1 = int(h * y_ratio)
    x2 = int(w * (x_ratio + width_ratio))
    y2 = int(h * (y_ratio + height_ratio))

    # Ensure bounds
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(w, x2)
    y2 = min(h, y2)

    # Crop
    cropped = image[y1:y2, x1:x2]

    if cropped.size == 0:
        logger.warning(f"Empty crop region: ({x1},{y1}) to ({x2},{y2})")
        return ""

    # Encode and extract
    cropped_b64 = encode_image_base64(cropped)

    result = vlm_service.describe_image(
        image_base64=cropped_b64,
        prompt=prompt,
    )

    return result.raw_text

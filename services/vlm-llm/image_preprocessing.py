"""
Image preprocessing module for VLM accuracy enhancement.

Applies preprocessing steps before VLM processing to improve text extraction:
1. Auto-deskew - correct rotation
2. Contrast enhancement - CLAHE for better text visibility
3. Resolution optimization - resize to optimal VLM input size
"""

import base64
import io
import logging
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class PreprocessingResult:
    """Result of image preprocessing."""
    image_b64: str
    original_size: tuple[int, int]  # (width, height)
    processed_size: tuple[int, int]
    deskew_angle: float
    preprocessing_time_ms: int


def decode_base64_image(image_b64: str) -> np.ndarray:
    """
    Decode a base64 image string to OpenCV format.

    Args:
        image_b64: Base64-encoded image (may include data URL prefix)

    Returns:
        OpenCV image array (BGR format)
    """
    # Handle data URL format
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    image_bytes = base64.b64decode(image_b64)
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        raise ValueError("Failed to decode image")

    return image


def encode_image_base64(image: np.ndarray, format: str = "png") -> str:
    """
    Encode an OpenCV image to base64 string.

    Args:
        image: OpenCV image array
        format: Output format (png, jpg, webp)

    Returns:
        Base64-encoded image string
    """
    ext = f".{format}"
    encode_params = []

    if format in ("jpg", "jpeg"):
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, 95]
    elif format == "png":
        encode_params = [cv2.IMWRITE_PNG_COMPRESSION, 6]
    elif format == "webp":
        encode_params = [cv2.IMWRITE_WEBP_QUALITY, 95]

    success, buffer = cv2.imencode(ext, image, encode_params)
    if not success:
        raise ValueError(f"Failed to encode image to {format}")

    return base64.b64encode(buffer).decode("utf-8")


def auto_deskew(image: np.ndarray, max_angle: float = 15.0) -> tuple[np.ndarray, float]:
    """
    Detect and correct image rotation using Hough Line Transform.

    Analyzes text lines in the image and rotates to align them horizontally.
    Only corrects small rotations (within max_angle) to avoid overcorrection.

    Args:
        image: OpenCV image (BGR format)
        max_angle: Maximum rotation angle to correct (degrees)

    Returns:
        Tuple of (deskewed image, rotation angle applied in degrees)
    """
    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Apply edge detection
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    # Dilate edges to connect broken lines
    kernel = np.ones((3, 3), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)

    # Detect lines using Hough Transform
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=100,
        minLineLength=50,
        maxLineGap=10
    )

    if lines is None or len(lines) < 5:
        logger.debug("Not enough lines detected for deskew, skipping")
        return image, 0.0

    # Calculate angles of detected lines
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        if x2 - x1 != 0:  # Avoid division by zero
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            # Only consider near-horizontal lines (within 45 degrees)
            if -45 < angle < 45:
                angles.append(angle)

    if not angles:
        logger.debug("No suitable lines for deskew angle calculation")
        return image, 0.0

    # Use median angle to be robust against outliers
    median_angle = float(np.median(angles))

    # Only correct if within max_angle threshold
    if abs(median_angle) > max_angle:
        logger.debug(f"Detected angle {median_angle:.2f}° exceeds max {max_angle}°, skipping")
        return image, 0.0

    if abs(median_angle) < 0.5:
        logger.debug(f"Angle {median_angle:.2f}° too small, skipping deskew")
        return image, 0.0

    logger.info(f"Deskewing image by {-median_angle:.2f}°")

    # Rotate image to correct skew
    h, w = image.shape[:2]
    center = (w // 2, h // 2)
    rotation_matrix = cv2.getRotationMatrix2D(center, median_angle, 1.0)

    # Calculate new bounding box to avoid cropping
    cos = abs(rotation_matrix[0, 0])
    sin = abs(rotation_matrix[0, 1])
    new_w = int(h * sin + w * cos)
    new_h = int(h * cos + w * sin)

    # Adjust rotation matrix for translation
    rotation_matrix[0, 2] += (new_w - w) / 2
    rotation_matrix[1, 2] += (new_h - h) / 2

    # Apply rotation with white background (common for documents)
    rotated = cv2.warpAffine(
        image,
        rotation_matrix,
        (new_w, new_h),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255)
    )

    return rotated, -median_angle


def enhance_contrast(image: np.ndarray, clip_limit: float = 2.0, tile_size: int = 8) -> np.ndarray:
    """
    Enhance image contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization).

    CLAHE works well for documents with varying lighting conditions by
    applying histogram equalization on small tiles with contrast limiting.

    Args:
        image: OpenCV image (BGR format)
        clip_limit: Contrast limiting threshold (higher = more contrast)
        tile_size: Size of tiles for adaptive equalization

    Returns:
        Contrast-enhanced image
    """
    # Convert to LAB color space (L channel is luminance)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    # Apply CLAHE to the L channel
    clahe = cv2.createCLAHE(
        clipLimit=clip_limit,
        tileGridSize=(tile_size, tile_size)
    )
    enhanced_l = clahe.apply(l_channel)

    # Merge channels and convert back to BGR
    enhanced_lab = cv2.merge([enhanced_l, a_channel, b_channel])
    enhanced = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)

    logger.debug(f"Applied CLAHE contrast enhancement (clip={clip_limit}, tile={tile_size})")

    return enhanced


def optimize_resolution(
    image: np.ndarray,
    target_longest_edge: int = 1024,
    min_size: int = 512,
    max_size: int = 2048
) -> np.ndarray:
    """
    Resize image to optimal size for VLM processing.

    VLMs typically work best with images around 1024px on the longest edge.
    Too small loses detail, too large wastes compute and can reduce accuracy.

    Args:
        image: OpenCV image
        target_longest_edge: Target size for longest edge in pixels
        min_size: Minimum size (won't downscale below this)
        max_size: Maximum size (won't upscale above this)

    Returns:
        Resized image
    """
    h, w = image.shape[:2]
    current_longest = max(h, w)

    # Determine target size
    if current_longest <= min_size:
        # Image is small, don't downscale further
        target = current_longest
    elif current_longest >= max_size:
        # Image is very large, resize to max
        target = max_size
    else:
        # Resize to target
        target = target_longest_edge

    # Calculate scale factor
    scale = target / current_longest

    if 0.95 < scale < 1.05:
        # Within 5%, no resize needed
        logger.debug(f"Image size {w}x{h} is close to optimal, skipping resize")
        return image

    new_w = int(w * scale)
    new_h = int(h * scale)

    # Use appropriate interpolation
    if scale > 1:
        # Upscaling - use LANCZOS for quality
        interpolation = cv2.INTER_LANCZOS4
    else:
        # Downscaling - use AREA for quality
        interpolation = cv2.INTER_AREA

    resized = cv2.resize(image, (new_w, new_h), interpolation=interpolation)

    logger.debug(f"Resized image from {w}x{h} to {new_w}x{new_h} (scale={scale:.2f})")

    return resized


def sharpen_image(image: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """
    Apply unsharp masking to sharpen text edges.

    Args:
        image: OpenCV image
        strength: Sharpening strength (0.5 = subtle, 1.0 = normal, 1.5 = strong)

    Returns:
        Sharpened image
    """
    # Create Gaussian blur
    blurred = cv2.GaussianBlur(image, (0, 0), 3)

    # Apply unsharp mask: result = original + strength * (original - blurred)
    sharpened = cv2.addWeighted(image, 1.0 + strength, blurred, -strength, 0)

    logger.debug(f"Applied sharpening (strength={strength})")

    return sharpened


def denoise_image(image: np.ndarray, strength: int = 10) -> np.ndarray:
    """
    Apply denoising to reduce noise artifacts that can confuse VLM.

    Uses Non-Local Means Denoising which preserves edges while removing noise.

    Args:
        image: OpenCV image
        strength: Denoising strength (higher = more smoothing, may blur text)

    Returns:
        Denoised image
    """
    # Use fastNlMeansDenoisingColored for color images
    denoised = cv2.fastNlMeansDenoisingColored(
        image,
        None,
        h=strength,
        hForColorComponents=strength,
        templateWindowSize=7,
        searchWindowSize=21
    )

    logger.debug(f"Applied denoising (strength={strength})")

    return denoised


def preprocess_image(
    image_b64: str,
    enable_deskew: bool = True,
    enable_contrast: bool = True,
    enable_resize: bool = True,
    enable_sharpen: bool = False,
    enable_denoise: bool = False,
    target_size: int = 1024,
) -> PreprocessingResult:
    """
    Full preprocessing pipeline for VLM input images.

    Applies a sequence of preprocessing steps to optimize the image
    for text extraction by the VLM.

    Args:
        image_b64: Base64-encoded input image
        enable_deskew: Auto-correct rotation
        enable_contrast: Apply CLAHE contrast enhancement
        enable_resize: Resize to optimal VLM input size
        enable_sharpen: Apply sharpening (can help with blurry images)
        enable_denoise: Apply denoising (can help with noisy images)
        target_size: Target size for longest edge when resizing

    Returns:
        PreprocessingResult with processed image and metadata
    """
    import time
    start_time = time.time()

    # Decode image
    image = decode_base64_image(image_b64)
    original_h, original_w = image.shape[:2]
    original_size = (original_w, original_h)

    logger.info(f"Preprocessing image: {original_w}x{original_h}")

    deskew_angle = 0.0

    # Step 1: Deskew
    if enable_deskew:
        image, deskew_angle = auto_deskew(image)

    # Step 2: Denoise (before other enhancements)
    if enable_denoise:
        image = denoise_image(image)

    # Step 3: Contrast enhancement
    if enable_contrast:
        image = enhance_contrast(image)

    # Step 4: Sharpen
    if enable_sharpen:
        image = sharpen_image(image)

    # Step 5: Resize to optimal size
    if enable_resize:
        image = optimize_resolution(image, target_longest_edge=target_size)

    # Get final dimensions
    processed_h, processed_w = image.shape[:2]
    processed_size = (processed_w, processed_h)

    # Encode result
    result_b64 = encode_image_base64(image, format="png")

    processing_time_ms = int((time.time() - start_time) * 1000)

    logger.info(
        f"Preprocessing complete: {original_w}x{original_h} -> {processed_w}x{processed_h}, "
        f"deskew={deskew_angle:.1f}°, time={processing_time_ms}ms"
    )

    return PreprocessingResult(
        image_b64=result_b64,
        original_size=original_size,
        processed_size=processed_size,
        deskew_angle=deskew_angle,
        preprocessing_time_ms=processing_time_ms,
    )


def get_image_info(image_b64: str) -> dict:
    """
    Get basic information about an image without full preprocessing.

    Useful for deciding what preprocessing steps are needed.

    Args:
        image_b64: Base64-encoded image

    Returns:
        Dict with image properties
    """
    image = decode_base64_image(image_b64)
    h, w = image.shape[:2]

    # Calculate brightness (mean of grayscale)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    brightness = float(np.mean(gray))

    # Calculate contrast (standard deviation of grayscale)
    contrast = float(np.std(gray))

    # Estimate noise level (using Laplacian variance)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    noise_estimate = float(laplacian.var())

    return {
        "width": w,
        "height": h,
        "brightness": brightness,  # 0-255, higher = brighter
        "contrast": contrast,  # higher = more contrast
        "noise_estimate": noise_estimate,  # higher = more detail/noise
        "aspect_ratio": w / h if h > 0 else 1.0,
    }

"""
FastAPI application for VLM + LLM two-stage image parsing service.

Stage 1 (VLM): Vision model reads images (handles handwriting, stylized fonts)
Stage 2 (LLM): Text model normalizes and structures output into JSON

Provides endpoints:
- GET /health - Service availability
- POST /extract/base64 - Full VLM+LLM pipeline with accuracy modes
- POST /vlm/describe - VLM-only (for debugging)
- POST /llm/structure - LLM-only (for debugging)

Extraction modes:
- fast: Single pass, no preprocessing (~20s with GPU)
- accurate: Preprocessing + verification (~60s with GPU)
- thorough: Preprocessing + multi-pass + verification + zoom (~120s with GPU)
"""

import base64
import logging
import time
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Application settings from environment variables."""

    # Ollama connection
    ollama_host: str = Field(default="http://ollama:11434", alias="OLLAMA_HOST")

    # VLM settings (vision model for Stage 1)
    vlm_model: str = Field(default="llava:7b", alias="VLM_MODEL")
    vlm_model_cpu: str = Field(default="moondream", alias="VLM_MODEL_CPU")

    # LLM settings (text model for Stage 2)
    llm_model: str = Field(default="qwen2.5:7b", alias="LLM_MODEL")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


# Import services (lazy loading)
from vlm_service import get_vlm_service
from llm_service import get_llm_service
from prompts import (
    VLM_TEXT_EXTRACTION_PROMPT,
    VLM_VERIFICATION_PROMPT,
    VLM_INGREDIENTS_VERIFICATION_PROMPT,
    build_llm_structuring_prompt,
    detect_content_type,
    ContentType,
    parse_verification_response,
    apply_text_corrections,
    format_ingredients_for_verification,
)
from image_preprocessing import preprocess_image, PreprocessingResult
from multi_pass import extract_multi_pass_sync, MultiPassResult
from region_extraction import extract_by_region, RegionExtractionResult
import re

# Extraction mode type
ExtractionMode = Literal["fast", "accurate", "thorough", "counsel"]


def extract_title_and_instructions(raw_text: str) -> tuple[str, list[str]]:
    """
    Extract recipe title and instructions from raw VLM text.
    Used as fallback when LLM returns only ingredients as an array.
    """
    title = "Untitled Recipe"
    instructions = []

    lines = raw_text.split('\n')

    # Try to extract title from various patterns
    # Pattern 1: "TITLE: Recipe Name" or "**Title:** Recipe Name"
    title_match = re.search(r'(?:\*\*)?(?:TITLE|Title)(?:\*\*)?[:\s]+(.+?)(?:\n|$)', raw_text)
    if title_match:
        title = title_match.group(1).strip().strip('*')

    # Pattern 2: Look for recipe name in first few lines (often bold or header)
    if title == "Untitled Recipe":
        for line in lines[:5]:
            line = line.strip()
            # Skip empty lines and section headers
            if not line or line.lower() in ['ingredients', 'instructions', 'directions']:
                continue
            # Remove markdown formatting
            clean = re.sub(r'\*\*|\#\#|\#', '', line).strip()
            # If it looks like a title (not too long, not a list item)
            if 5 < len(clean) < 80 and not re.match(r'^[\-\*\d]', clean) and not ':' in clean[:20]:
                title = clean
                break

    # Extract instructions
    in_instructions = False
    for line in lines:
        line_lower = line.lower().strip()

        # Detect instructions section
        if 'instruction' in line_lower or 'direction' in line_lower or 'method' in line_lower:
            in_instructions = True
            continue

        # End instructions section at certain markers
        if in_instructions:
            if line_lower.startswith('note') or line_lower.startswith('tip') or '---' in line:
                break

            # Clean up instruction line
            text = line.strip()
            if text:
                # Remove step numbers and bullets
                text = re.sub(r'^[\d\.\)\-\*\•]+\s*', '', text)
                text = re.sub(r'^step\s*\d+[:\.\)]\s*', '', text, flags=re.IGNORECASE)
                if len(text) > 10:  # Only add meaningful instructions
                    instructions.append(text)

    return title, instructions


# =============================================================================
# Pydantic Models
# =============================================================================

class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    vlm_available: bool
    vlm_model: str | None
    llm_available: bool
    llm_model: str | None
    gpu_available: bool  # Whether Ollama is using GPU acceleration
    expected_processing_ms: int  # Estimated time based on GPU/CPU mode


class VLMDescribeRequest(BaseModel):
    """Request for VLM-only endpoint."""
    image_data: str = Field(..., description="Base64-encoded image data")
    prompt: str | None = Field(None, description="Custom prompt (optional)")


class VLMDescribeResponse(BaseModel):
    """Response from VLM-only endpoint."""
    raw_text: str
    model: str
    processing_time_ms: int


class LLMStructureRequest(BaseModel):
    """Request for LLM-only endpoint."""
    raw_text: str = Field(..., description="Raw text to structure")
    hint_type: ContentType | None = Field(None, description="Content type hint")


class LLMStructureResponse(BaseModel):
    """Response from LLM-only endpoint."""
    structured: dict | list | None
    detected_type: ContentType
    model: str
    processing_time_ms: int


class ExtractBase64Request(BaseModel):
    """Request for full VLM+LLM pipeline."""
    image_data: str = Field(..., description="Base64-encoded image data")
    hint_type: ContentType | None = Field(None, description="Content type hint")
    # Accuracy enhancement options
    extraction_mode: ExtractionMode = Field(
        default="accurate",
        description="Extraction mode: fast (single pass), accurate (preprocess+verify), thorough (multi-pass+zoom)"
    )
    enable_preprocessing: bool = Field(
        default=True,
        description="Enable image preprocessing (deskew, contrast, resize)"
    )
    enable_verification: bool = Field(
        default=True,
        description="Enable self-correction verification loop"
    )


class ExtractResponse(BaseModel):
    """Response from full VLM+LLM pipeline."""
    raw_text: str
    detected_type: ContentType
    structured: dict | list | None
    confidence: float
    vlm_processing_ms: int
    llm_processing_ms: int
    total_processing_ms: int
    # Accuracy enhancement metadata
    extraction_mode: ExtractionMode = "fast"
    preprocessing_applied: bool = False
    preprocessing_ms: int = 0
    verification_applied: bool = False
    verification_corrections: int = 0
    pass_count: int = 1


# =============================================================================
# Application Lifecycle
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting VLM-LLM service...")

    # Check GPU availability early to select appropriate VLM model
    gpu_available = await check_ollama_gpu()

    # Select VLM model based on GPU availability
    # Note: moondream is faster but poor at text extraction, so we use llava:7b always
    if gpu_available:
        selected_vlm = settings.vlm_model  # llava:7b for GPU
        logger.info(f"GPU detected - using VLM: {selected_vlm}")
    else:
        # Use llava:7b even on CPU - moondream doesn't extract text well
        selected_vlm = settings.vlm_model  # llava:7b for CPU too
        logger.info(f"No GPU - using VLM (slower on CPU): {selected_vlm}")

    # Store selected model in app.state for use by request handlers
    app.state.vlm_model = selected_vlm
    app.state.gpu_available = gpu_available

    logger.info(f"VLM model: {selected_vlm}")
    logger.info(f"LLM model: {settings.llm_model}")

    # Check VLM availability
    try:
        vlm_service = get_vlm_service(
            ollama_host=settings.ollama_host,
            model=selected_vlm,
        )
        if vlm_service.is_available:
            logger.info(f"VLM service ready: {vlm_service.model_name}")
        else:
            logger.warning(f"VLM model {selected_vlm} not available")
    except Exception as e:
        logger.warning(f"VLM service not available: {e}")

    # Check LLM availability
    try:
        llm_service = get_llm_service(
            ollama_host=settings.ollama_host,
            model=settings.llm_model,
        )
        if llm_service.is_available:
            logger.info(f"LLM service ready: {llm_service.model_name}")
        else:
            logger.warning(f"LLM model {settings.llm_model} not available")
    except Exception as e:
        logger.warning(f"LLM service not available: {e}")

    yield

    logger.info("Shutting down VLM-LLM service...")


app = FastAPI(
    title="VLM-LLM Service",
    description="Two-stage image parsing: VLM for vision, LLM for structuring",
    version="2.0.0",
    lifespan=lifespan,
)


# =============================================================================
# Endpoints
# =============================================================================

async def check_ollama_gpu() -> bool:
    """
    Check if Ollama is running with GPU support.

    Uses multiple detection methods:
    1. Check /api/ps for loaded models with VRAM
    2. Check /api/show for model GPU layer info
    3. Fallback: assume GPU if Ollama is running (let actual inference determine)
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Method 1: Check if any model is currently loaded with VRAM
            response = await client.get(f"{settings.ollama_host}/api/ps")
            if response.status_code == 200:
                data = response.json()
                for model in data.get("models", []):
                    if model.get("size_vram", 0) > 0:
                        logger.info("GPU detected via /api/ps (model loaded with VRAM)")
                        return True

            # Method 2: Check model info for GPU layers capability
            # This works even if no model is currently loaded
            try:
                show_response = await client.post(
                    f"{settings.ollama_host}/api/show",
                    json={"name": settings.vlm_model}
                )
                if show_response.status_code == 200:
                    show_data = show_response.json()
                    # Check modelinfo for GPU-related fields
                    model_info = show_data.get("model_info", {})
                    # If model exists and Ollama can serve it, assume GPU is available
                    # The actual GPU usage will be determined at inference time
                    if show_data.get("modelfile"):
                        logger.info(f"GPU assumed available (model {settings.vlm_model} exists)")
                        return True
            except Exception as e:
                logger.debug(f"Model show check failed: {e}")

            # Method 3: Check NVIDIA GPU availability via environment
            # Ollama with GPU typically has CUDA visible
            import os
            if os.path.exists("/dev/nvidia0") or os.environ.get("CUDA_VISIBLE_DEVICES"):
                logger.info("GPU detected via NVIDIA device/env")
                return True

            return False
    except Exception as e:
        logger.debug(f"GPU check failed: {e}")
        return False


async def check_gpu_for_request() -> bool:
    """
    Quick GPU check for per-request decisions.
    Checks if any model currently has VRAM allocated.
    """
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{settings.ollama_host}/api/ps")
            if response.status_code == 200:
                data = response.json()
                for model in data.get("models", []):
                    if model.get("size_vram", 0) > 0:
                        return True
        return False
    except:
        return False


@app.get("/health", response_model=HealthResponse)
async def health_check(request: Request):
    """
    Check the health of the VLM and LLM services.

    Returns availability and model info for both stages, plus GPU status
    and expected processing time estimate.
    """
    vlm_available = False
    vlm_model = None
    llm_available = False
    llm_model = None

    # Use the selected VLM model from app.state (set at startup based on GPU)
    selected_vlm = getattr(request.app.state, 'vlm_model', settings.vlm_model)

    # Re-check GPU status on each health check (it may change after models load)
    gpu_available = await check_ollama_gpu()
    # Update cached value for other endpoints
    request.app.state.gpu_available = gpu_available

    try:
        vlm_service = get_vlm_service(
            ollama_host=settings.ollama_host,
            model=selected_vlm,
        )
        vlm_available = vlm_service.is_available
        vlm_model = vlm_service.model_name if vlm_available else None
    except Exception as e:
        logger.debug(f"VLM service check failed: {e}")

    try:
        llm_service = get_llm_service(
            ollama_host=settings.ollama_host,
            model=settings.llm_model,
        )
        llm_available = llm_service.is_available
        llm_model = llm_service.model_name if llm_available else None
    except Exception as e:
        logger.debug(f"LLM service check failed: {e}")

    # Estimate processing time based on GPU/CPU mode
    # GPU: ~45 seconds, CPU (llava:7b): ~6-10 minutes
    expected_processing_ms = 45000 if gpu_available else 480000

    # Service is functional if VLM is available (LLM is optional but recommended)
    status = "ok" if vlm_available else "degraded"
    if vlm_available and not llm_available:
        status = "partial"  # VLM works but no structuring

    return HealthResponse(
        status=status,
        vlm_available=vlm_available,
        vlm_model=vlm_model,
        llm_available=llm_available,
        llm_model=llm_model,
        gpu_available=gpu_available,
        expected_processing_ms=expected_processing_ms,
    )


# =============================================================================
# Ingredient Parsing (CRF-based NLP)
# =============================================================================

class ParseIngredientsRequest(BaseModel):
    """Request for ingredient parsing endpoint."""
    ingredients: list[str] = Field(..., description="List of ingredient lines to parse")


class ParsedIngredientResult(BaseModel):
    """A single parsed ingredient."""
    name: str
    quantity: float | None = None
    unit: str | None = None
    notes: str | None = None
    confidence: float = 1.0


class ParseIngredientsResponse(BaseModel):
    """Response from ingredient parsing."""
    results: list[ParsedIngredientResult]
    parser: str = "crf"
    processing_time_ms: int


@app.post("/parse/ingredients", response_model=ParseIngredientsResponse)
async def parse_ingredients(body: ParseIngredientsRequest):
    """
    Parse ingredient lines using CRF-based NLP model.

    Uses the ingredient-parser-nlp library (trained on 81K+ labeled sentences)
    to extract structured data from ingredient strings.
    """
    start_time = time.time()
    results: list[ParsedIngredientResult] = []

    try:
        from ingredient_parser import parse_ingredient
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="ingredient-parser-nlp not installed. Run: pip install ingredient-parser-nlp"
        )

    for line in body.ingredients:
        try:
            parsed = parse_ingredient(line)

            # Extract quantity
            quantity = None
            if parsed.amount and parsed.amount[0].quantity is not None:
                try:
                    quantity = float(parsed.amount[0].quantity)
                except (ValueError, TypeError):
                    pass

            # Extract unit
            unit = None
            if parsed.amount and parsed.amount[0].unit:
                unit = str(parsed.amount[0].unit)

            # Extract name — may be a list of IngredientText objects
            name = line  # fallback
            if parsed.name:
                if isinstance(parsed.name, list):
                    name = ", ".join(item.text if hasattr(item, 'text') else str(item) for item in parsed.name)
                elif hasattr(parsed.name, 'text'):
                    name = parsed.name.text
                else:
                    name = str(parsed.name)

            # Extract notes/preparation/comment
            notes_parts = []
            if parsed.preparation:
                prep_text = parsed.preparation.text if hasattr(parsed.preparation, 'text') else str(parsed.preparation)
                notes_parts.append(prep_text)
            if parsed.comment:
                comment_text = parsed.comment.text if hasattr(parsed.comment, 'text') else str(parsed.comment)
                notes_parts.append(comment_text)
            notes = ", ".join(notes_parts) if notes_parts else None

            # Confidence — average of name confidence
            confidence = 0.9
            if parsed.name:
                if isinstance(parsed.name, list) and len(parsed.name) > 0:
                    confs = [item.confidence for item in parsed.name if hasattr(item, 'confidence')]
                    if confs:
                        confidence = sum(confs) / len(confs)
                elif hasattr(parsed.name, 'confidence'):
                    confidence = parsed.name.confidence

            results.append(ParsedIngredientResult(
                name=name.strip(),
                quantity=round(quantity, 3) if quantity is not None else None,
                unit=unit,
                notes=notes,
                confidence=round(confidence, 4),
            ))
        except Exception as e:
            logger.warning(f"Failed to parse ingredient '{line}': {e}")
            results.append(ParsedIngredientResult(name=line.strip()))

    processing_time_ms = int((time.time() - start_time) * 1000)

    return ParseIngredientsResponse(
        results=results,
        parser="crf",
        processing_time_ms=processing_time_ms,
    )


@app.post("/vlm/describe", response_model=VLMDescribeResponse)
async def vlm_describe(request: Request, body: VLMDescribeRequest):
    """
    Stage 1 only: Extract raw text from image using VLM.

    Useful for debugging or when you want to handle structuring separately.
    """
    try:
        # Use the selected VLM model from app.state (set at startup based on GPU)
        selected_vlm = getattr(request.app.state, 'vlm_model', settings.vlm_model)

        vlm_service = get_vlm_service(
            ollama_host=settings.ollama_host,
            model=selected_vlm,
        )

        if not vlm_service.is_available:
            raise HTTPException(
                status_code=503,
                detail=f"VLM service not available. Model {selected_vlm} may not be pulled."
            )

        result = vlm_service.describe_image(
            image_base64=body.image_data,
            prompt=body.prompt,
        )

        return VLMDescribeResponse(
            raw_text=result.raw_text,
            model=result.model,
            processing_time_ms=result.processing_time_ms,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"VLM describe failed: {e}")
        raise HTTPException(status_code=500, detail=f"VLM processing failed: {str(e)}")


@app.post("/llm/structure", response_model=LLMStructureResponse)
async def llm_structure(request: LLMStructureRequest):
    """
    Stage 2 only: Structure raw text into JSON using LLM.

    Useful for debugging or when you already have raw text.
    """
    try:
        llm_service = get_llm_service(
            ollama_host=settings.ollama_host,
            model=settings.llm_model,
        )

        if not llm_service.is_available:
            raise HTTPException(
                status_code=503,
                detail=f"LLM service not available. Model {settings.llm_model} may not be pulled."
            )

        start_time = time.time()

        # Detect content type
        detected_type, confidence, reasoning = detect_content_type(request.raw_text)
        logger.info(f"Type detection: {detected_type} ({confidence:.2f}) - {reasoning}")

        # Build prompt and get structured output
        prompt = build_llm_structuring_prompt(
            detected_type=detected_type,
            raw_text=request.raw_text,
            hint_type=request.hint_type,
        )

        structured = llm_service.extract_json(prompt)
        processing_time_ms = int((time.time() - start_time) * 1000)

        return LLMStructureResponse(
            structured=structured,
            detected_type=request.hint_type or detected_type,
            model=llm_service.model_name,
            processing_time_ms=processing_time_ms,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"LLM structure failed: {e}")
        raise HTTPException(status_code=500, detail=f"LLM processing failed: {str(e)}")


@app.post("/extract/base64", response_model=ExtractResponse)
async def extract_from_base64(request: Request, body: ExtractBase64Request):
    """
    Full VLM + LLM pipeline with accuracy enhancement modes.

    Stage 1: Optional image preprocessing (deskew, contrast, resize)
    Stage 2: VLM reads the image and extracts raw text (optionally multi-pass)
    Stage 3: Optional verification and self-correction loop
    Stage 4: LLM normalizes and structures the text into JSON

    Extraction modes:
    - fast: Single pass, no preprocessing (~20s GPU, ~8min CPU)
    - accurate: Preprocessing + verification (~60s GPU, ~12min CPU)
    - thorough: Preprocessing + multi-pass + verification (~120s GPU, ~20min CPU)
    """
    try:
        start_time = time.time()

        # Determine settings based on extraction mode
        mode = body.extraction_mode
        do_preprocessing = body.enable_preprocessing and mode in ("accurate", "thorough")
        do_verification = body.enable_verification and mode in ("accurate", "thorough")
        do_multi_pass = mode == "thorough"
        num_passes = 3 if mode == "thorough" else (2 if mode == "accurate" else 1)

        logger.info(f"Extraction mode: {mode} (preprocess={do_preprocessing}, verify={do_verification}, passes={num_passes})")

        # Use the selected VLM model from app.state (set at startup based on GPU)
        selected_vlm = getattr(request.app.state, 'vlm_model', settings.vlm_model)

        # Get VLM service
        vlm_service = get_vlm_service(
            ollama_host=settings.ollama_host,
            model=selected_vlm,
        )

        if not vlm_service.is_available:
            raise HTTPException(
                status_code=503,
                detail=f"VLM service not available. Model {selected_vlm} may not be pulled."
            )

        # Track processing times and metadata
        preprocessing_ms = 0
        preprocessing_applied = False
        verification_corrections = 0
        verification_applied = False
        pass_count = 1

        # Working image data
        image_data = body.image_data

        # =====================================================================
        # Stage 1: Image Preprocessing (optional)
        # =====================================================================
        if do_preprocessing:
            try:
                logger.info("Applying image preprocessing...")
                preprocess_result = preprocess_image(
                    image_b64=image_data,
                    enable_deskew=True,
                    enable_contrast=True,
                    enable_resize=True,
                    enable_sharpen=False,  # Can blur text
                    enable_denoise=False,  # Can blur text
                    target_size=1024,
                )
                image_data = preprocess_result.image_b64
                preprocessing_ms = preprocess_result.preprocessing_time_ms
                preprocessing_applied = True
                logger.info(
                    f"Preprocessing complete: {preprocess_result.original_size} -> {preprocess_result.processed_size}, "
                    f"deskew={preprocess_result.deskew_angle:.1f}°, time={preprocessing_ms}ms"
                )
            except Exception as e:
                logger.warning(f"Preprocessing failed, continuing with original image: {e}")

        # =====================================================================
        # Stage 2: VLM Extraction (single or multi-pass)
        # =====================================================================
        vlm_processing_ms = 0
        raw_text = ""

        if do_multi_pass and num_passes > 1:
            # Multi-pass extraction with voting
            logger.info(f"Running multi-pass extraction ({num_passes} passes)...")
            multi_result = extract_multi_pass_sync(
                image_b64=image_data,
                vlm_service=vlm_service,
                num_passes=num_passes,
            )
            raw_text = multi_result.merged_text
            vlm_processing_ms = multi_result.total_processing_ms
            pass_count = multi_result.pass_count
            logger.info(f"Multi-pass extraction complete: {len(raw_text)} chars from {pass_count} passes")
        else:
            # Single-pass extraction
            vlm_result = vlm_service.describe_image(
                image_base64=image_data,
                prompt=VLM_TEXT_EXTRACTION_PROMPT,
            )
            raw_text = vlm_result.raw_text
            vlm_processing_ms = vlm_result.processing_time_ms
            pass_count = 1
            logger.info(f"VLM extracted {len(raw_text)} chars in {vlm_processing_ms}ms")

        # =====================================================================
        # Stage 3: Verification Loop (optional)
        # =====================================================================
        if do_verification and raw_text:
            try:
                logger.info("Running verification pass...")
                verification_prompt = VLM_VERIFICATION_PROMPT.format(
                    extracted_text=raw_text[:2000]  # Limit to avoid context overflow
                )

                verify_result = vlm_service.describe_image(
                    image_base64=image_data,
                    prompt=verification_prompt,
                )
                vlm_processing_ms += verify_result.processing_time_ms

                is_verified, corrections = parse_verification_response(verify_result.raw_text)
                verification_applied = True

                if not is_verified and corrections:
                    logger.info(f"Verification found {len(corrections)} corrections")
                    raw_text = apply_text_corrections(raw_text, corrections)
                    verification_corrections = len(corrections)
                else:
                    logger.info("Verification: no corrections needed")

            except Exception as e:
                logger.warning(f"Verification failed, continuing with original extraction: {e}")

        # =====================================================================
        # Stage 4: Content Type Detection
        # =====================================================================
        detected_type, type_confidence, reasoning = detect_content_type(raw_text)
        logger.info(f"Type detection: {detected_type} ({type_confidence:.2f}) - {reasoning}")

        # =====================================================================
        # Stage 5: LLM Structuring
        # =====================================================================
        llm_processing_ms = 0
        structured = None
        confidence = type_confidence

        try:
            llm_service = get_llm_service(
                ollama_host=settings.ollama_host,
                model=settings.llm_model,
            )

            if llm_service.is_available:
                llm_start = time.time()

                # Build structuring prompt
                prompt = build_llm_structuring_prompt(
                    detected_type=detected_type,
                    raw_text=raw_text,
                    hint_type=body.hint_type,
                )

                # Get structured output
                structured = llm_service.extract_json(prompt)

                # Validate structure - recipes should return an object with ingredients, not an array
                if detected_type == "recipe" and isinstance(structured, list):
                    logger.warning("LLM returned array instead of recipe object, retrying with stricter prompt")
                    # Retry with explicit instruction
                    retry_prompt = f"""IMPORTANT: Return a JSON OBJECT (starting with {'{'}), not an array.

{prompt}

Remember: Start your response with {'{'}"""
                    structured = llm_service.extract_json(retry_prompt)

                    # If still an array, wrap it in a recipe object with extracted metadata
                    if isinstance(structured, list):
                        logger.warning("LLM still returned array, wrapping as ingredients with extracted metadata")
                        title, instructions = extract_title_and_instructions(raw_text)
                        structured = {
                            "type": "recipe",
                            "confidence": 0.7,
                            "title": title,
                            "ingredients": structured,
                            "instructions": instructions
                        }

                llm_processing_ms = int((time.time() - llm_start) * 1000)

                logger.info(f"LLM structured in {llm_processing_ms}ms")

                # Update confidence from LLM result if available
                if structured and isinstance(structured, dict) and "confidence" in structured:
                    confidence = structured["confidence"]

                # Boost confidence if we used accuracy enhancements
                if preprocessing_applied or verification_applied or pass_count > 1:
                    confidence = min(0.95, confidence + 0.05)

            else:
                logger.warning("LLM not available, returning VLM output only")

        except Exception as e:
            logger.warning(f"LLM structuring failed, returning VLM output only: {e}")

        total_processing_ms = int((time.time() - start_time) * 1000)

        return ExtractResponse(
            raw_text=raw_text,
            detected_type=body.hint_type or detected_type,
            structured=structured,
            confidence=confidence,
            vlm_processing_ms=vlm_processing_ms,
            llm_processing_ms=llm_processing_ms,
            total_processing_ms=total_processing_ms,
            extraction_mode=mode,
            preprocessing_applied=preprocessing_applied,
            preprocessing_ms=preprocessing_ms,
            verification_applied=verification_applied,
            verification_corrections=verification_corrections,
            pass_count=pass_count,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Extraction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")


# Legacy endpoint alias for backward compatibility
@app.post("/extract", response_model=ExtractResponse)
async def extract_from_image_legacy(request: Request, body: ExtractBase64Request):
    """Legacy endpoint - redirects to /extract/base64."""
    return await extract_from_base64(request, body)


# =============================================================================
# Debug/Testing Endpoints
# =============================================================================

class PreprocessRequest(BaseModel):
    """Request for preprocessing-only endpoint."""
    image_data: str = Field(..., description="Base64-encoded image data")
    enable_deskew: bool = Field(default=True)
    enable_contrast: bool = Field(default=True)
    enable_resize: bool = Field(default=True)
    target_size: int = Field(default=1024)


class PreprocessResponse(BaseModel):
    """Response from preprocessing endpoint."""
    image_data: str
    original_size: tuple[int, int]
    processed_size: tuple[int, int]
    deskew_angle: float
    processing_time_ms: int


@app.post("/preprocess", response_model=PreprocessResponse)
async def preprocess_only(body: PreprocessRequest):
    """
    Preprocessing-only endpoint for debugging.

    Applies image preprocessing steps without VLM/LLM extraction.
    """
    try:
        result = preprocess_image(
            image_b64=body.image_data,
            enable_deskew=body.enable_deskew,
            enable_contrast=body.enable_contrast,
            enable_resize=body.enable_resize,
            target_size=body.target_size,
        )

        return PreprocessResponse(
            image_data=result.image_b64,
            original_size=result.original_size,
            processed_size=result.processed_size,
            deskew_angle=result.deskew_angle,
            processing_time_ms=result.preprocessing_time_ms,
        )
    except Exception as e:
        logger.error(f"Preprocessing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Preprocessing failed: {str(e)}")


# =============================================================================
# Counsel Mode Endpoint (SSE)
# =============================================================================

class CounselRequest(BaseModel):
    """Request for counsel mode extraction."""
    image_data: str = Field(..., description="Base64-encoded image data")
    num_vlm_passes: int = Field(default=5, ge=1, le=10, description="Number of VLM passes")


@app.post("/extract/counsel")
async def extract_counsel_mode(request: Request, body: CounselRequest):
    """
    Counsel Mode: 10 AI personas debate and vote on recipe interpretations.

    This endpoint streams Server-Sent Events (SSE) as the counsel processes:
    1. VLM extraction (multiple passes)
    2. Each persona interprets the recipe
    3. Disagreements are identified
    4. Personas debate contentious points
    5. Votes resolve each disagreement
    6. Final structured recipe is output

    Event types:
    - vlm_complete: VLM extraction finished
    - stage: Processing stage change
    - persona_thinking: A persona is analyzing
    - persona_interpretation: A persona's interpretation
    - disagreement: A point of disagreement found
    - consensus: No disagreements (rare)
    - discussion_topic: Starting debate on a topic
    - discussion: A discussion message from a persona
    - vote: Vote result for a topic
    - final_result: The final structured recipe
    - error: An error occurred
    """
    from counsel_mode import counsel_mode_generator

    try:
        # Use the selected VLM model from app.state
        selected_vlm = getattr(request.app.state, 'vlm_model', settings.vlm_model)

        vlm_service = get_vlm_service(
            ollama_host=settings.ollama_host,
            model=selected_vlm,
        )

        if not vlm_service.is_available:
            raise HTTPException(
                status_code=503,
                detail=f"VLM service not available. Model {selected_vlm} may not be pulled."
            )

        llm_service = get_llm_service(
            ollama_host=settings.ollama_host,
            model=settings.llm_model,
        )

        if not llm_service.is_available:
            raise HTTPException(
                status_code=503,
                detail=f"LLM service not available. Model {settings.llm_model} may not be pulled."
            )

        # Handle data URL format if present
        image_data = body.image_data
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]

        async def event_generator():
            async for event in counsel_mode_generator(
                image_b64=image_data,
                vlm_service=vlm_service,
                llm_service=llm_service,
                num_vlm_passes=body.num_vlm_passes,
            ):
                yield event

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Counsel mode failed: {e}")
        raise HTTPException(status_code=500, detail=f"Counsel mode failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

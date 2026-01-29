"""
FastAPI application for VLM + LLM two-stage image parsing service.

Stage 1 (VLM): Vision model reads images (handles handwriting, stylized fonts)
Stage 2 (LLM): Text model normalizes and structures output into JSON

Provides endpoints:
- GET /health - Service availability
- POST /extract/base64 - Full VLM+LLM pipeline
- POST /vlm/describe - VLM-only (for debugging)
- POST /llm/structure - LLM-only (for debugging)
"""

import base64
import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
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
    build_llm_structuring_prompt,
    detect_content_type,
    ContentType,
)


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


class ExtractResponse(BaseModel):
    """Response from full VLM+LLM pipeline."""
    raw_text: str
    detected_type: ContentType
    structured: dict | list | None
    confidence: float
    vlm_processing_ms: int
    llm_processing_ms: int
    total_processing_ms: int


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

    Queries Ollama's /api/ps endpoint to check if any model has VRAM allocated,
    which indicates GPU acceleration is available and in use.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{settings.ollama_host}/api/ps")
            if response.status_code != 200:
                return False

            data = response.json()
            # Check if any model has GPU layers loaded (size_vram > 0)
            for model in data.get("models", []):
                if model.get("size_vram", 0) > 0:
                    return True

            # If no models are currently loaded, check via /api/show for GPU capability
            # by trying to get info about one of our models
            return False
    except Exception as e:
        logger.debug(f"GPU check failed: {e}")
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
    gpu_available = getattr(request.app.state, 'gpu_available', False)

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
    Full VLM + LLM pipeline.

    Stage 1: VLM reads the image and extracts raw text
    Stage 2: LLM normalizes and structures the text into JSON

    Falls back to VLM-only with heuristic type detection if LLM is unavailable.
    """
    try:
        start_time = time.time()

        # Use the selected VLM model from app.state (set at startup based on GPU)
        selected_vlm = getattr(request.app.state, 'vlm_model', settings.vlm_model)

        # Stage 1: VLM - Extract raw text from image
        vlm_service = get_vlm_service(
            ollama_host=settings.ollama_host,
            model=selected_vlm,
        )

        if not vlm_service.is_available:
            raise HTTPException(
                status_code=503,
                detail=f"VLM service not available. Model {selected_vlm} may not be pulled."
            )

        vlm_result = vlm_service.describe_image(
            image_base64=body.image_data,
            prompt=VLM_TEXT_EXTRACTION_PROMPT,
        )
        vlm_processing_ms = vlm_result.processing_time_ms

        logger.info(f"VLM extracted {len(vlm_result.raw_text)} chars in {vlm_processing_ms}ms")

        # Detect content type from raw text
        detected_type, type_confidence, reasoning = detect_content_type(vlm_result.raw_text)
        logger.info(f"Type detection: {detected_type} ({type_confidence:.2f}) - {reasoning}")

        # Stage 2: LLM - Structure the raw text
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
                    raw_text=vlm_result.raw_text,
                    hint_type=body.hint_type,
                )

                # Get structured output
                structured = llm_service.extract_json(prompt)
                llm_processing_ms = int((time.time() - llm_start) * 1000)

                logger.info(f"LLM structured in {llm_processing_ms}ms")

                # Update confidence from LLM result if available
                if structured and isinstance(structured, dict) and "confidence" in structured:
                    confidence = structured["confidence"]
            else:
                logger.warning("LLM not available, returning VLM output only")

        except Exception as e:
            logger.warning(f"LLM structuring failed, returning VLM output only: {e}")

        total_processing_ms = int((time.time() - start_time) * 1000)

        return ExtractResponse(
            raw_text=vlm_result.raw_text,
            detected_type=body.hint_type or detected_type,
            structured=structured,
            confidence=confidence,
            vlm_processing_ms=vlm_processing_ms,
            llm_processing_ms=llm_processing_ms,
            total_processing_ms=total_processing_ms,
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

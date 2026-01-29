"""
VLM (Vision Language Model) service using Ollama with llava.
Handles image-to-text extraction via vision models.
"""

import base64
import logging
import os
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass
class VLMResponse:
    """Response from the VLM."""
    raw_text: str
    model: str
    processing_time_ms: int
    tokens_generated: int


class VLMService:
    """
    VLM service using Ollama with llava for vision-based text extraction.

    Stage 1 of the pipeline: reads images and extracts raw text.
    Handles handwriting, stylized fonts, and photos of text that OCR struggles with.
    """

    def __init__(
        self,
        ollama_host: str | None = None,
        model: str | None = None,
        timeout: int = 600,  # 10 minutes for CPU/swap mode
    ):
        """
        Initialize the VLM service.

        Args:
            ollama_host: Ollama API URL (default: http://ollama:11434 for Docker)
            model: Vision model to use (default: llava:7b)
            timeout: Request timeout in seconds
        """
        self.ollama_host = ollama_host or os.environ.get(
            'OLLAMA_HOST',
            'http://ollama:11434'
        )
        self.model = model or os.environ.get('VLM_MODEL', 'llava:7b')
        self.timeout = timeout
        self._available: bool | None = None

    @property
    def is_available(self) -> bool:
        """Check if the VLM service is available."""
        if self._available is not None:
            return self._available

        try:
            with httpx.Client(timeout=5) as client:
                response = client.get(f"{self.ollama_host}/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    models = [m.get('name', '') for m in data.get('models', [])]
                    # Check if our model is available
                    self._available = any(
                        self.model in m or m.startswith(self.model.split(':')[0])
                        for m in models
                    )
                    if not self._available:
                        logger.warning(f"VLM model {self.model} not found. Available: {models}")
                    return self._available
        except Exception as e:
            logger.debug(f"Ollama VLM not available: {e}")
            self._available = False

        return False

    @property
    def model_name(self) -> str:
        """Get the model name."""
        return self.model

    def describe_image(
        self,
        image_base64: str,
        prompt: str | None = None,
    ) -> VLMResponse:
        """
        Extract text from an image using the vision model.

        Args:
            image_base64: Base64-encoded image data
            prompt: Custom prompt (optional, uses default text extraction prompt)

        Returns:
            VLMResponse with extracted raw text
        """
        start_time = time.time()

        # Default prompt for text extraction
        if prompt is None:
            prompt = """Extract all text from this image exactly as written.
Include every word, number, and symbol you can see.
Preserve the original formatting and layout as much as possible.
Do not interpret or restructure - just transcribe what you see.
If the text appears to be a list, recipe, or calendar, maintain its structure."""

        # Handle data URL format if present
        if "," in image_base64:
            image_base64 = image_base64.split(",", 1)[1]

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                f"{self.ollama_host}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "images": [image_base64],
                    "stream": False,
                    "options": {
                        "temperature": 0.1,  # Low temperature for accurate extraction
                        "num_predict": 2048,
                    }
                }
            )
            response.raise_for_status()
            data = response.json()

        processing_time_ms = int((time.time() - start_time) * 1000)

        raw_text = data.get("response", "").strip()
        eval_count = data.get("eval_count", 0)

        logger.info(
            f"VLM extraction completed: {len(raw_text)} chars, "
            f"{eval_count} tokens, {processing_time_ms}ms"
        )

        return VLMResponse(
            raw_text=raw_text,
            model=self.model,
            processing_time_ms=processing_time_ms,
            tokens_generated=eval_count,
        )


# Singleton instance
_vlm_service: VLMService | None = None


def get_vlm_service(
    ollama_host: str | None = None,
    model: str | None = None,
) -> VLMService:
    """Get or create the VLM service singleton.

    Note: If the model changes, a new service instance will be created.
    """
    global _vlm_service

    # If model is specified and differs from current, reset singleton
    if _vlm_service is not None and model is not None:
        if _vlm_service.model != model:
            logger.info(f"VLM model changed from {_vlm_service.model} to {model}, recreating service")
            _vlm_service = None

    if _vlm_service is None:
        _vlm_service = VLMService(
            ollama_host=ollama_host,
            model=model,
        )
    return _vlm_service

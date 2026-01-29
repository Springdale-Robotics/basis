"""
LLM service using Ollama HTTP API for text structuring.
Stage 2 of the pipeline: normalizes and structures VLM output into JSON.
"""

import json
import logging
import os
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass
class LLMResponse:
    """Response from the LLM."""
    content: str
    model: str
    processing_time_ms: int
    tokens_generated: int
    tokens_per_second: float


class LLMService:
    """
    LLM service using Ollama HTTP API for text structuring.

    Stage 2 of the pipeline: takes raw text from VLM and structures it
    into clean JSON with normalized units and formatting.
    """

    def __init__(
        self,
        ollama_host: str | None = None,
        model: str | None = None,
        timeout: int = 600,  # 10 minutes for CPU/swap mode
    ):
        """
        Initialize the LLM service.

        Args:
            ollama_host: Ollama API URL (default: http://ollama:11434 for Docker)
            model: Model to use for structuring (default: qwen2.5:7b)
            timeout: Request timeout in seconds
        """
        self.ollama_host = ollama_host or os.environ.get(
            'OLLAMA_HOST',
            'http://ollama:11434'
        )
        self.model = model or os.environ.get('LLM_MODEL', 'qwen2.5:7b')
        self.timeout = timeout
        self._available: bool | None = None

    @property
    def is_available(self) -> bool:
        """Check if the LLM service is available."""
        if self._available is not None:
            return self._available

        try:
            with httpx.Client(timeout=5) as client:
                response = client.get(f"{self.ollama_host}/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    models = [m.get('name', '') for m in data.get('models', [])]
                    self._available = any(
                        self.model in m or m.startswith(self.model.split(':')[0])
                        for m in models
                    )
                    if not self._available:
                        logger.warning(f"LLM model {self.model} not found. Available: {models}")
                    return self._available
        except Exception as e:
            logger.debug(f"Ollama LLM not available: {e}")
            self._available = False

        return False

    @property
    def model_name(self) -> str:
        """Get the model name."""
        return self.model

    @property
    def gpu_available(self) -> bool:
        """GPU status is managed by Ollama."""
        return False  # We don't know from here

    def complete(
        self,
        prompt: str,
        max_tokens: int = 2048,
        temperature: float = 0.1,
        stop: list[str] | None = None,
    ) -> LLMResponse:
        """
        Generate a completion for the given prompt.

        Args:
            prompt: The input prompt
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature (lower = more deterministic)
            stop: Optional stop sequences

        Returns:
            LLMResponse with the generated text
        """
        start_time = time.time()

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                f"{self.ollama_host}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                        "stop": stop or [],
                    }
                }
            )
            response.raise_for_status()
            data = response.json()

        processing_time_ms = int((time.time() - start_time) * 1000)

        content = data.get("response", "")
        eval_count = data.get("eval_count", 0)
        tokens_per_second = (
            eval_count / (processing_time_ms / 1000)
            if processing_time_ms > 0 and eval_count > 0
            else 0.0
        )

        return LLMResponse(
            content=content,
            model=self.model,
            processing_time_ms=processing_time_ms,
            tokens_generated=eval_count,
            tokens_per_second=tokens_per_second,
        )

    def extract_json(self, prompt: str, max_tokens: int = 2048) -> dict | list | None:
        """
        Generate a completion and attempt to parse it as JSON.

        Args:
            prompt: The input prompt (should request JSON output)
            max_tokens: Maximum tokens to generate

        Returns:
            Parsed JSON object/array or None if parsing fails
        """
        response = self.complete(
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=0.1,
        )

        content = response.content.strip()

        # Try to extract JSON from the response
        if content.startswith("```json"):
            content = content[7:]
        elif content.startswith("```"):
            content = content[3:]

        if content.endswith("```"):
            content = content[:-3]

        content = content.strip()

        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON: {e}")

            # Try to find JSON object or array in the content
            for start_char, end_char in [('{', '}'), ('[', ']')]:
                start_idx = content.find(start_char)
                if start_idx != -1:
                    depth = 0
                    for i, char in enumerate(content[start_idx:], start_idx):
                        if char == start_char:
                            depth += 1
                        elif char == end_char:
                            depth -= 1
                            if depth == 0:
                                try:
                                    return json.loads(content[start_idx:i+1])
                                except json.JSONDecodeError:
                                    break

            return None


# Singleton instance
_llm_service: LLMService | None = None


def get_llm_service(
    ollama_host: str | None = None,
    model: str | None = None,
) -> LLMService:
    """Get or create the LLM service singleton."""
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService(
            ollama_host=ollama_host,
            model=model,
        )
    return _llm_service

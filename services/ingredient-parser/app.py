"""
Basis ingredient parser sidecar.

A tiny FastAPI service that turns raw ingredient lines ("2 cups flour, sifted")
into structured {name, quantity, unit, notes} via the CRF-based
ingredient-parser-nlp library. The Node backend calls this over HTTP at
VLM_LLM_SERVICE_URL (default http://localhost:8010) — see
backend/src/services/crf-ingredient-parser.ts.

This is deliberately separate from services/vlm-llm: that service also does
image/VLM work and pulls in opencv + Ollama, which are far too heavy for the
native (Docker-free) install. The CRF endpoint needs none of that, so we run
just this in its own venv as basis-ingredient-parser.service.

The parsing logic mirrors services/vlm-llm/main.py so both paths behave
identically.
"""

import time

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Basis Ingredient Parser", version="1.0.0")


class ParseIngredientsRequest(BaseModel):
    ingredients: list[str] = Field(..., description="Raw ingredient lines to parse")


class ParsedIngredientResult(BaseModel):
    name: str
    quantity: float | None = None
    unit: str | None = None
    notes: str | None = None
    confidence: float = 1.0


class ParseIngredientsResponse(BaseModel):
    results: list[ParsedIngredientResult]
    parser: str = "crf"
    processing_time_ms: int


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/parse/ingredients", response_model=ParseIngredientsResponse)
async def parse_ingredients(body: ParseIngredientsRequest):
    """Parse ingredient lines using the CRF-based NLP model."""
    start_time = time.time()
    results: list[ParsedIngredientResult] = []

    # Imported lazily so a missing/broken dependency surfaces as a clear 500
    # per request rather than crashing the whole service at startup.
    from ingredient_parser import parse_ingredient

    for line in body.ingredients:
        try:
            parsed = parse_ingredient(line)

            quantity = None
            if parsed.amount and parsed.amount[0].quantity is not None:
                try:
                    quantity = float(parsed.amount[0].quantity)
                except (ValueError, TypeError):
                    pass

            unit = None
            if parsed.amount and parsed.amount[0].unit:
                unit = str(parsed.amount[0].unit)

            # name may be a single IngredientText or a list of them.
            name = line  # fallback to the raw line
            if parsed.name:
                if isinstance(parsed.name, list):
                    name = ", ".join(
                        item.text if hasattr(item, "text") else str(item)
                        for item in parsed.name
                    )
                elif hasattr(parsed.name, "text"):
                    name = parsed.name.text
                else:
                    name = str(parsed.name)

            notes_parts = []
            if parsed.preparation:
                notes_parts.append(
                    parsed.preparation.text
                    if hasattr(parsed.preparation, "text")
                    else str(parsed.preparation)
                )
            if parsed.comment:
                notes_parts.append(
                    parsed.comment.text
                    if hasattr(parsed.comment, "text")
                    else str(parsed.comment)
                )
            notes = ", ".join(notes_parts) if notes_parts else None

            confidence = 0.9
            if parsed.name:
                if isinstance(parsed.name, list) and len(parsed.name) > 0:
                    confs = [
                        item.confidence
                        for item in parsed.name
                        if hasattr(item, "confidence")
                    ]
                    if confs:
                        confidence = sum(confs) / len(confs)
                elif hasattr(parsed.name, "confidence"):
                    confidence = parsed.name.confidence

            results.append(
                ParsedIngredientResult(
                    name=name.strip(),
                    quantity=round(quantity, 3) if quantity is not None else None,
                    unit=unit,
                    notes=notes,
                    confidence=round(confidence, 4),
                )
            )
        except Exception:
            # One unparseable line shouldn't fail the batch — fall back to the
            # raw line as the name, matching the backend's degraded behaviour.
            results.append(ParsedIngredientResult(name=line.strip()))

    return ParseIngredientsResponse(
        results=results,
        parser="crf",
        processing_time_ms=int((time.time() - start_time) * 1000),
    )

import { config } from '../../../config/index.js';
import { logger } from '../../../lib/logger.js';
import type { VisionProvider, VisionResult } from './index.js';

/**
 * HandwritingOCR API response for document upload
 */
interface UploadResponse {
  id: string;
  status: string;
}

/**
 * HandwritingOCR API response for document download
 */
interface DocumentResponse {
  id: string;
  file_name: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  results?: Array<{
    page_number: number;
    transcript: string;
  }>;
}

/**
 * CRF parse result from VLM-LLM service
 */
interface CRFIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  confidence: number;
}

/**
 * Vision provider using the HandwritingOCR API (handwritingocr.com) for
 * accurate transcription of handwritten recipe cards, combined with
 * CRF ingredient parsing and LLM structuring from the VLM-LLM service.
 *
 * Pipeline:
 * 1. HandwritingOCR API → raw transcript (accurate character-level OCR)
 * 2. CRF parser → structured ingredients (quantity/unit/name)
 * 3. LLM → full recipe JSON (title, instructions, temperature)
 */
export class HandwritingOcrProvider implements VisionProvider {
  name = 'handwriting-ocr';
  private apiKey: string;
  private apiUrl: string;
  private vlmLlmUrl: string;
  private timeout: number;

  constructor() {
    this.apiKey = config.HANDWRITING_OCR_API_KEY || '';
    this.apiUrl = config.HANDWRITING_OCR_API_URL;
    this.vlmLlmUrl = config.VLM_LLM_SERVICE_URL;
    this.timeout = config.IMAGE_PARSE_TIMEOUT_MS;
  }

  getModel(): string {
    return 'handwriting-ocr-api';
  }

  isLightweightModel(): boolean {
    return false;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/v3/users/me`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async parseImage(
    imageBuffer: Buffer,
    mimeType: string,
    _prompt: string,
  ): Promise<VisionResult> {
    const startTime = Date.now();

    // Step 1: Upload image to HandwritingOCR API
    const documentId = await this.uploadImage(imageBuffer, mimeType);
    logger.info({ documentId }, 'HandwritingOCR: document uploaded');

    // Step 2: Poll until transcription is complete
    const transcript = await this.pollForResult(documentId);
    const ocrTimeMs = Date.now() - startTime;
    logger.info(
      { documentId, transcriptLength: transcript.length, ocrTimeMs },
      'HandwritingOCR: transcription complete'
    );

    // Step 3: Feed through CRF + LLM for structuring
    const structured = await this.structureTranscript(transcript);

    const totalTimeMs = Date.now() - startTime;
    logger.info({ totalTimeMs }, 'HandwritingOCR: full pipeline complete');

    const result: VisionResult = {
      rawText: transcript,
      processingTimeMs: totalTimeMs,
    };

    if (structured) {
      result.structured = {
        type: (structured.type as string || 'recipe') as 'recipe' | 'list' | 'calendar_event' | 'mixed' | 'unknown',
        confidence: Number(structured.confidence) || 0.85,
        data: structured,
      };
    }

    return result;
  }

  /**
   * Upload an image to the HandwritingOCR API for transcription.
   */
  private async uploadImage(imageBuffer: Buffer, mimeType: string): Promise<string> {
    const ext = mimeType.includes('png') ? 'png'
      : mimeType.includes('gif') ? 'gif'
      : mimeType.includes('webp') ? 'png' // Convert webp to png for API compatibility
      : 'jpg';

    const formData = new FormData();
    formData.append('action', 'transcribe');
    formData.append('file', new Blob([new Uint8Array(imageBuffer)], { type: mimeType }), `recipe.${ext}`);

    const response = await fetch(`${this.apiUrl}/api/v3/documents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error('HandwritingOCR: invalid API key');
      }
      if (response.status === 403) {
        throw new Error('HandwritingOCR: insufficient credits or access denied');
      }
      if (response.status === 429) {
        throw new Error('HandwritingOCR: rate limited, try again shortly');
      }
      throw new Error(`HandwritingOCR upload failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as UploadResponse;
    return data.id;
  }

  /**
   * Poll the HandwritingOCR API until the document is processed.
   * Uses exponential backoff: 1s, 2s, 4s, 8s, 8s, 8s...
   */
  private async pollForResult(documentId: string): Promise<string> {
    const maxWaitMs = this.timeout;
    const startTime = Date.now();
    let delay = 1000;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, delay));

      const response = await fetch(`${this.apiUrl}/api/v3/documents/${documentId}.json`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 202) {
        // Still processing
        delay = Math.min(delay * 2, 8000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HandwritingOCR poll failed (${response.status})`);
      }

      const data = (await response.json()) as DocumentResponse;

      if (data.status === 'done' && data.results) {
        // Combine all pages into a single transcript
        return data.results
          .sort((a, b) => a.page_number - b.page_number)
          .map(r => r.transcript)
          .join('\n\n');
      }

      if (data.status === 'failed') {
        throw new Error('HandwritingOCR: document processing failed');
      }

      // Still pending/processing
      delay = Math.min(delay * 2, 8000);
    }

    throw new Error(`HandwritingOCR: timed out after ${maxWaitMs}ms`);
  }

  /**
   * Use the VLM-LLM service's CRF parser and LLM to structure the raw transcript.
   */
  private async structureTranscript(transcript: string): Promise<Record<string, unknown> | null> {
    try {
      // Step 1: Extract ingredient lines and parse with CRF
      const ingredientLines = this.extractIngredientLines(transcript);
      let crfIngredients: CRFIngredient[] = [];

      if (ingredientLines.length > 0) {
        try {
          const crfResponse = await fetch(`${this.vlmLlmUrl}/parse/ingredients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredients: ingredientLines }),
            signal: AbortSignal.timeout(10000),
          });

          if (crfResponse.ok) {
            const crfData = await crfResponse.json() as { results: CRFIngredient[] };
            crfIngredients = crfData.results;
            logger.info(
              { count: crfIngredients.length },
              'HandwritingOCR: CRF parsed ingredients'
            );
          }
        } catch (e) {
          logger.warn({ error: e }, 'HandwritingOCR: CRF parsing failed, continuing without');
        }
      }

      // Step 2: Use LLM to structure the full recipe
      const crfSection = crfIngredients.length > 0
        ? '\n\nPre-parsed ingredients (use these quantities as reference):\n' +
          crfIngredients.map(i => {
            const parts = [];
            if (i.quantity != null) parts.push(String(i.quantity));
            if (i.unit) parts.push(i.unit);
            parts.push(i.name);
            if (i.notes) parts.push(`(${i.notes})`);
            return `- ${parts.join(' ')}`;
          }).join('\n')
        : '';

      const llmResponse = await fetch(`${this.vlmLlmUrl}/llm/structure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_text: transcript + crfSection,
          hint_type: 'recipe',
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!llmResponse.ok) {
        logger.warn('HandwritingOCR: LLM structuring failed');
        return null;
      }

      const llmData = await llmResponse.json() as { structured: Record<string, unknown> };
      const structured = llmData.structured;

      // Inject CRF confidence into structured ingredients
      if (structured && Array.isArray(structured.ingredients) && crfIngredients.length > 0) {
        for (let i = 0; i < structured.ingredients.length && i < crfIngredients.length; i++) {
          const ing = structured.ingredients[i] as Record<string, unknown>;
          ing.confidence = crfIngredients[i].confidence;
          ing.needs_review = crfIngredients[i].confidence < 0.7;
        }
      }

      return structured;
    } catch (e) {
      logger.warn({ error: e }, 'HandwritingOCR: structuring failed');
      return null;
    }
  }

  /**
   * Extract lines that look like ingredients from raw transcript text.
   */
  private extractIngredientLines(text: string): string[] {
    const lines: string[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/^[-•*]\s*/, '').trim();
      if (!trimmed) continue;
      // Match lines starting with a number/fraction
      if (/^\d|^[½¼¾⅓⅔⅛]/.test(trimmed)) {
        lines.push(trimmed);
      }
      // Match lines with embedded quantities
      else if (/\d+\s*\/\s*\d+|(?:\d+\s+)?(?:cup|tsp|tbsp|c\.|T\.|t\.|oz|lb)/i.test(trimmed)) {
        lines.push(trimmed);
      }
    }
    return lines;
  }
}

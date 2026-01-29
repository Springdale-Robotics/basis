import { config } from '../../../config/index.js';
import { logger } from '../../../lib/logger.js';
import type { VisionProvider, VisionResult } from './index.js';

/**
 * OCR data structure from the Python service
 */
interface OCRBlock {
  text: string;
  lines: Array<{
    text: string;
    confidence: number;
    bbox: [number, number, number, number];
  }>;
  confidence: number;
  bbox: [number, number, number, number];
}

interface OCRResponse {
  full_text: string;
  blocks: OCRBlock[];
  confidence: number;
  processing_time_ms: number;
  image_width: number;
  image_height: number;
  detected_type: 'list' | 'recipe' | 'calendar_event' | 'mixed' | 'unknown';
  type_confidence: number;
  type_reasoning: string;
}

interface HealthResponse {
  status: string;
  ocr_available: boolean;
  ocr_gpu: boolean;
  llm_available: boolean;
  llm_gpu: boolean;
  llm_model: string | null;
}

interface ExtractResponse {
  raw_text: string;
  detected_type: 'list' | 'recipe' | 'calendar_event' | 'mixed' | 'unknown';
  structured: unknown;
  confidence: number;
  ocr_processing_ms: number;
  llm_processing_ms: number;
  total_processing_ms: number;
}

/**
 * Vision provider using the OCR + LLM Python microservice.
 *
 * This provider uses a two-stage pipeline:
 * 1. OCR with docTR/OnnxTR for text extraction with bounding boxes
 * 2. Local LLM (llama-cpp-python) for structured data extraction
 *
 * Falls back gracefully:
 * - If LLM unavailable: OCR-only with heuristic parsers
 * - If service unavailable: Returns null from factory
 */
export class OcrLlmProvider implements VisionProvider {
  name = 'ocr-llm';
  private serviceUrl: string;
  private timeout: number;
  private cachedHealth: { health: HealthResponse; checkedAt: number } | null = null;
  private healthCacheTtl = 30000; // 30 seconds

  constructor() {
    this.serviceUrl = config.OCR_LLM_SERVICE_URL;
    this.timeout = config.OCR_LLM_TIMEOUT_MS;
  }

  getModel(): string {
    // Return the LLM model name if available, otherwise indicate OCR-only
    if (this.cachedHealth?.health.llm_model) {
      return `ocr+${this.cachedHealth.health.llm_model}`;
    }
    return 'ocr-only';
  }

  /**
   * This provider uses a capable LLM (Qwen 7B), so detailed prompts work well.
   * Returns false to use the detailed extraction prompts.
   */
  isLightweightModel(): boolean {
    // If LLM is not available, we'll use heuristic parsing which works
    // better with simple text output
    if (!this.cachedHealth?.health.llm_available) {
      return true;
    }
    return false;
  }

  async isAvailable(): Promise<boolean> {
    // Return cached result if fresh
    if (
      this.cachedHealth &&
      Date.now() - this.cachedHealth.checkedAt < this.healthCacheTtl
    ) {
      // Service is available if OCR works (LLM is optional)
      return this.cachedHealth.health.ocr_available;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.serviceUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.cachedHealth = null;
        return false;
      }

      const health = (await response.json()) as HealthResponse;
      this.cachedHealth = { health, checkedAt: Date.now() };

      // Log service status
      logger.info(
        {
          ocrAvailable: health.ocr_available,
          ocrGpu: health.ocr_gpu,
          llmAvailable: health.llm_available,
          llmGpu: health.llm_gpu,
          llmModel: health.llm_model,
        },
        'OCR-LLM service health check'
      );

      return health.ocr_available;
    } catch (error) {
      logger.debug({ error }, 'OCR-LLM service not available');
      this.cachedHealth = null;
      return false;
    }
  }

  /**
   * Check if the LLM component is available for structured extraction.
   */
  async isLlmAvailable(): Promise<boolean> {
    await this.isAvailable(); // Refresh health cache
    return this.cachedHealth?.health.llm_available ?? false;
  }

  async parseImage(
    imageBuffer: Buffer,
    _mimeType: string,
    _prompt: string
  ): Promise<VisionResult> {
    const startTime = Date.now();

    logger.info(
      { serviceUrl: this.serviceUrl, bufferSize: imageBuffer.length },
      'Starting OCR-LLM parseImage'
    );

    // Convert image to base64
    const imageBase64 = imageBuffer.toString('base64');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeout);

      // Use the combined /extract/base64 endpoint for full pipeline
      const response = await fetch(`${this.serviceUrl}/extract/base64`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_data: imageBase64,
          hint_type: null, // Let the service auto-detect
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OCR-LLM service error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as ExtractResponse;
      const processingTimeMs = Date.now() - startTime;

      logger.info(
        {
          detectedType: data.detected_type,
          confidence: data.confidence,
          ocrMs: data.ocr_processing_ms,
          llmMs: data.llm_processing_ms,
          totalMs: data.total_processing_ms,
          hasStructured: !!data.structured,
        },
        'OCR-LLM parsing completed'
      );

      // If we got structured data from the LLM, return it
      if (data.structured) {
        return {
          rawText: data.raw_text,
          structured: this.normalizeStructuredContent(data.structured, data.detected_type),
          processingTimeMs,
        };
      }

      // Otherwise return raw text for heuristic parsing
      return {
        rawText: data.raw_text,
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OCR-LLM parsing timed out after ${this.timeout}ms`);
      }

      const err = error as Error;
      logger.error(
        {
          message: err.message,
          stack: err.stack,
          name: err.name,
          processingTimeMs,
          serviceUrl: this.serviceUrl,
        },
        'OCR-LLM parsing failed'
      );
      throw error;
    }
  }

  /**
   * OCR-only mode: Get raw text without LLM interpretation.
   * Useful as a fallback when LLM is unavailable.
   */
  async ocrOnly(imageBuffer: Buffer): Promise<{
    text: string;
    confidence: number;
    detectedType: string;
    processingTimeMs: number;
  }> {
    const imageBase64 = imageBuffer.toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s for OCR only

    try {
      const response = await fetch(`${this.serviceUrl}/ocr/base64/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_data: imageBase64,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OCR service error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as OCRResponse;

      return {
        text: data.full_text,
        confidence: data.confidence,
        detectedType: data.detected_type,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private normalizeStructuredContent(
    parsed: unknown,
    detectedType: string
  ): VisionResult['structured'] | undefined {
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    const obj = parsed as Record<string, unknown>;

    // Use the type from the parsed data if available, otherwise use detected type
    const contentType = (obj.type as string) || detectedType;
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0.8;

    // Validate and normalize based on content type
    switch (contentType) {
      case 'list':
        if ('items' in obj && Array.isArray(obj.items)) {
          return { type: 'list', confidence, data: obj };
        }
        break;

      case 'recipe':
        if ('ingredients' in obj && Array.isArray(obj.ingredients)) {
          return { type: 'recipe', confidence, data: obj };
        }
        break;

      case 'calendar_event':
        if ('events' in obj && Array.isArray(obj.events)) {
          return { type: 'calendar_event', confidence, data: obj };
        }
        break;

      case 'mixed':
        return { type: 'mixed', confidence, data: obj };

      case 'unknown':
      default:
        return { type: 'unknown', confidence, data: obj };
    }

    // If structure doesn't match expected format, return as unknown
    return { type: 'unknown', confidence: 0.5, data: obj };
  }
}

import { config } from '../../../config/index.js';
import { logger } from '../../../lib/logger.js';
import type { VisionProvider, VisionResult } from './index.js';

/**
 * Health response from VLM-LLM service
 */
interface HealthResponse {
  status: string;
  vlm_available: boolean;
  vlm_model: string | null;
  llm_available: boolean;
  llm_model: string | null;
  gpu_available: boolean;
  expected_processing_ms: number;
}

/**
 * Extract response from VLM-LLM service
 */
interface ExtractResponse {
  raw_text: string;
  detected_type: 'list' | 'recipe' | 'calendar_event' | 'mixed' | 'unknown';
  structured: unknown;
  confidence: number;
  vlm_processing_ms: number;
  llm_processing_ms: number;
  total_processing_ms: number;
}

/**
 * Vision provider using the VLM + LLM two-stage Python microservice.
 *
 * This provider uses a two-stage pipeline:
 * 1. VLM (llava:7b via Ollama) for vision - reads images including handwriting
 * 2. LLM (qwen2.5:7b via Ollama) for structuring - normalizes and formats as JSON
 *
 * Falls back gracefully:
 * - If LLM unavailable: VLM-only with heuristic parsers
 * - If service unavailable: Returns null from factory
 */
export class VlmLlmProvider implements VisionProvider {
  name = 'vlm-llm';
  private serviceUrl: string;
  private timeout: number;
  private cachedHealth: { health: HealthResponse; checkedAt: number } | null = null;
  private healthCacheTtl = 30000; // 30 seconds

  constructor() {
    this.serviceUrl = config.VLM_LLM_SERVICE_URL;
    this.timeout = config.VLM_LLM_TIMEOUT_MS;
  }

  getModel(): string {
    // Return the VLM + LLM model names if available
    if (this.cachedHealth?.health.vlm_model && this.cachedHealth?.health.llm_model) {
      return `${this.cachedHealth.health.vlm_model}+${this.cachedHealth.health.llm_model}`;
    }
    if (this.cachedHealth?.health.vlm_model) {
      return `${this.cachedHealth.health.vlm_model} (vlm-only)`;
    }
    return 'vlm-llm';
  }

  /**
   * This provider uses capable models (llava:7b + qwen2.5:7b), so detailed prompts work well.
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
      // Service is available if VLM works (LLM is optional)
      return this.cachedHealth.health.vlm_available;
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
          vlmAvailable: health.vlm_available,
          vlmModel: health.vlm_model,
          llmAvailable: health.llm_available,
          llmModel: health.llm_model,
          gpuAvailable: health.gpu_available,
          expectedProcessingMs: health.expected_processing_ms,
        },
        'VLM-LLM service health check'
      );

      return health.vlm_available;
    } catch (error) {
      logger.debug({ error }, 'VLM-LLM service not available');
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

  /**
   * Check if GPU acceleration is available.
   */
  async isGpuAvailable(): Promise<boolean> {
    await this.isAvailable(); // Refresh health cache
    return this.cachedHealth?.health.gpu_available ?? false;
  }

  /**
   * Get expected processing time in milliseconds based on GPU/CPU mode.
   * GPU: ~45 seconds, CPU: ~150 seconds (2.5 minutes)
   */
  async getExpectedProcessingMs(): Promise<number> {
    await this.isAvailable(); // Refresh health cache
    return this.cachedHealth?.health.expected_processing_ms ?? 150000;
  }

  async parseImage(
    imageBuffer: Buffer,
    _mimeType: string,
    _prompt: string
  ): Promise<VisionResult> {
    const startTime = Date.now();

    logger.info(
      { serviceUrl: this.serviceUrl, bufferSize: imageBuffer.length },
      'Starting VLM-LLM parseImage'
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
        throw new Error(`VLM-LLM service error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as ExtractResponse;
      const processingTimeMs = Date.now() - startTime;

      logger.info(
        {
          detectedType: data.detected_type,
          confidence: data.confidence,
          vlmMs: data.vlm_processing_ms,
          llmMs: data.llm_processing_ms,
          totalMs: data.total_processing_ms,
          hasStructured: !!data.structured,
        },
        'VLM-LLM parsing completed'
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
        throw new Error(`VLM-LLM parsing timed out after ${this.timeout}ms`);
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
        'VLM-LLM parsing failed'
      );
      throw error;
    }
  }

  /**
   * VLM-only mode: Get raw text without LLM structuring.
   * Useful for debugging or when LLM is unavailable.
   */
  async vlmOnly(imageBuffer: Buffer): Promise<{
    text: string;
    model: string;
    processingTimeMs: number;
  }> {
    const imageBase64 = imageBuffer.toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000); // 10min for CPU mode

    try {
      const response = await fetch(`${this.serviceUrl}/vlm/describe`, {
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
        throw new Error(`VLM service error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        raw_text: string;
        model: string;
        processing_time_ms: number;
      };

      return {
        text: data.raw_text,
        model: data.model,
        processingTimeMs: data.processing_time_ms,
      };
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * LLM-only mode: Structure raw text without VLM.
   * Used for the second stage after VLM extracts text.
   */
  async llmOnly(rawText: string, hintType?: string): Promise<{
    structured: unknown;
    detectedType: string;
    model: string;
    processingTimeMs: number;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000); // 10min for CPU mode

    try {
      const response = await fetch(`${this.serviceUrl}/llm/structure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw_text: rawText,
          hint_type: hintType || null,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM service error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        structured: unknown;
        detected_type: string;
        model: string;
        processing_time_ms: number;
      };

      return {
        structured: data.structured,
        detectedType: data.detected_type,
        model: data.model,
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

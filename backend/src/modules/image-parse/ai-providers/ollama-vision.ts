import { config } from '../../../config/index.js';
import { logger } from '../../../lib/logger.js';
import type { VisionProvider, VisionResult } from './index.js';

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
  }>;
}

export class OllamaVisionProvider implements VisionProvider {
  name = 'ollama';
  private host: string;
  private model: string;
  private cachedAvailability: { available: boolean; checkedAt: number } | null = null;
  private availabilityCacheTtl = 30000; // 30 seconds

  constructor() {
    this.host = config.OLLAMA_HOST;
    this.model = config.OLLAMA_VISION_MODEL;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Check if the model is a lightweight model that needs simpler prompts.
   * Moondream and similar small models work better with direct, simple instructions.
   */
  isLightweightModel(): boolean {
    const lightweightModels = ['moondream', 'bakllava', 'nanollava'];
    const modelBase = this.model.split(':')[0].toLowerCase();
    return lightweightModels.some((m) => modelBase.includes(m));
  }

  async isAvailable(): Promise<boolean> {
    // Return cached result if fresh
    if (
      this.cachedAvailability &&
      Date.now() - this.cachedAvailability.checkedAt < this.availabilityCacheTtl
    ) {
      return this.cachedAvailability.available;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.host}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.cachedAvailability = { available: false, checkedAt: Date.now() };
        return false;
      }

      const data = (await response.json()) as OllamaTagsResponse;

      // Check if our configured model is available
      const modelAvailable = data.models?.some(
        (m) => m.name === this.model || m.name.startsWith(this.model.split(':')[0])
      );

      this.cachedAvailability = { available: modelAvailable, checkedAt: Date.now() };

      if (!modelAvailable) {
        logger.warn(
          { model: this.model, availableModels: data.models?.map((m) => m.name) },
          'Ollama vision model not found'
        );
      }

      return modelAvailable;
    } catch (error) {
      logger.debug({ error }, 'Ollama not available');
      this.cachedAvailability = { available: false, checkedAt: Date.now() };
      return false;
    }
  }

  async parseImage(
    imageBuffer: Buffer,
    _mimeType: string,
    prompt: string
  ): Promise<VisionResult> {
    const startTime = Date.now();

    logger.info({ host: this.host, model: this.model, bufferSize: imageBuffer.length }, 'Starting Ollama parseImage');

    // Convert image to base64
    const imageBase64 = imageBuffer.toString('base64');

    logger.info({ base64Length: imageBase64.length }, 'Image converted to base64, calling Ollama API');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.IMAGE_PARSE_TIMEOUT_MS);

      logger.info({ url: `${this.host}/api/generate` }, 'Fetching from Ollama');

      const response = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          images: [imageBase64],
          stream: false,
          options: {
            temperature: 0.1, // Low temperature for more consistent extraction
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      const processingTimeMs = Date.now() - startTime;

      logger.info(
        {
          model: this.model,
          processingTimeMs,
          totalDuration: data.total_duration,
          evalCount: data.eval_count,
        },
        'Ollama image parsing completed'
      );

      // Try to parse structured JSON from the response
      const structured = this.extractStructuredContent(data.response);

      return {
        rawText: data.response,
        structured,
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Image parsing timed out after ${config.IMAGE_PARSE_TIMEOUT_MS}ms`);
      }

      const err = error as Error;
      logger.error({
        message: err.message,
        stack: err.stack,
        name: err.name,
        processingTimeMs,
        host: this.host,
        model: this.model,
      }, 'Ollama image parsing failed');
      throw error;
    }
  }

  private extractStructuredContent(
    rawResponse: string
  ): VisionResult['structured'] | undefined {
    try {
      // Try to find JSON in the response
      const jsonMatch = rawResponse.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return this.normalizeStructuredContent(parsed);
      }

      // Try to parse the whole response as JSON
      const parsed = JSON.parse(rawResponse);
      return this.normalizeStructuredContent(parsed);
    } catch {
      // If no valid JSON, return undefined
      return undefined;
    }
  }

  private normalizeStructuredContent(
    parsed: unknown
  ): VisionResult['structured'] | undefined {
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    const obj = parsed as Record<string, unknown>;

    // Determine content type from parsed data
    if ('items' in obj && Array.isArray(obj.items)) {
      return {
        type: 'list',
        confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.8,
        data: obj,
      };
    }

    if ('ingredients' in obj && Array.isArray(obj.ingredients)) {
      return {
        type: 'recipe',
        confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.8,
        data: obj,
      };
    }

    if ('events' in obj && Array.isArray(obj.events)) {
      return {
        type: 'calendar_event',
        confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.8,
        data: obj,
      };
    }

    if ('type' in obj) {
      return {
        type: obj.type as 'list' | 'recipe' | 'calendar_event' | 'mixed' | 'unknown',
        confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.7,
        data: obj,
      };
    }

    return undefined;
  }
}

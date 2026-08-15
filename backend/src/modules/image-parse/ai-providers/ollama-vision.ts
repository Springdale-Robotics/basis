import { config } from '../../../config/index.js';
import { logger } from '../../../lib/logger.js';
import { loadSharp } from '../../../lib/sharp.js';
import { getVisionModel } from '../../llm/llm-settings.js';
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

/**
 * Longest edge, in pixels, of the image actually sent to the model.
 *
 * A phone photo is ~3MB and 12MP. Handed to a 7B vision model whole, it
 * expands into enough image tokens to exhaust an 8GB card: Ollama returns
 * "CUDA error: out of memory" — sometimes as a 500, sometimes as a 200 with an
 * empty completion — and the import silently produced no text at all.
 *
 * The same photo at 1024px transcribed a handwritten index card correctly in
 * 11.8s where the full-size version had burned 23.7s and returned nothing.
 * Text stays legible well below phone resolution; the tokens do not.
 *
 * The vlm-llm sidecar does its own preprocessing (deskew, contrast, resize)
 * inside /extract/base64, which is why this only ever bit the Ollama path —
 * the backstop that every box without the sidecar falls back to.
 */
const MAX_INFERENCE_EDGE_PX = 1024;
const INFERENCE_JPEG_QUALITY = 85;

/**
 * Ollama answers a generate request with HTTP 200 and an EMPTY completion when
 * the model is not resident yet — it does not queue behind the load. Loading a
 * 5.5GB vision model off disk takes around two minutes, and OLLAMA_KEEP_ALIVE
 * evicts it after five idle minutes. So for a household scanning one card a
 * day, the cold load is the normal case, not an edge: the scan lands mid-load
 * and comes back with nothing.
 *
 * Rather than guess a backoff, wait for the condition — poll until the model
 * reports resident, then try once more.
 */
const MODEL_READY_POLL_MS = 3000;

/** True once Ollama reports the model loaded and holding VRAM. */
async function isModelResident(host: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    // /api/ps reports the fully qualified tag, so `moondream` shows as
    // `moondream:latest` — compare on the bare name.
    const bare = (tag: string) => tag.split(':')[0];
    return (data.models ?? []).some((m) => bare(m.name) === bare(model));
  } catch {
    return false;
  }
}

/**
 * Block until the model is loaded, or until we have waited longer than a cold
 * load plausibly takes. Returns whether it became ready.
 */
async function waitForModel(host: string, model: string): Promise<boolean> {
  const deadline = Date.now() + config.OLLAMA_MODEL_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isModelResident(host, model)) return true;
    await new Promise((resolve) => setTimeout(resolve, MODEL_READY_POLL_MS));
  }
  return isModelResident(host, model);
}

/**
 * Shrink an image to something a local vision model can actually hold.
 * Best-effort: if sharp is unavailable or the buffer isn't decodable we send
 * the original rather than failing the import outright.
 */
async function downscaleForInference(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const sharp = await loadSharp();
    const image = sharp(imageBuffer, { failOn: 'none' });
    const { width, height } = await image.metadata();

    if (!width || !height) return imageBuffer;
    if (Math.max(width, height) <= MAX_INFERENCE_EDGE_PX) return imageBuffer;

    const resized = await image
      .rotate() // honour EXIF orientation before we drop the metadata
      .resize(MAX_INFERENCE_EDGE_PX, MAX_INFERENCE_EDGE_PX, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: INFERENCE_JPEG_QUALITY })
      .toBuffer();

    logger.info(
      {
        fromBytes: imageBuffer.length,
        toBytes: resized.length,
        fromDimensions: `${width}x${height}`,
        maxEdge: MAX_INFERENCE_EDGE_PX,
      },
      'Downscaled image for vision inference'
    );
    return resized;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Could not downscale image for inference — sending the original'
    );
    return imageBuffer;
  }
}

export class OllamaVisionProvider implements VisionProvider {
  name = 'ollama';
  private host: string;
  /**
   * Last model name resolved from settings. Seeded with the env default so
   * getModel()/isLightweightModel() have a sane answer before the first
   * call, then kept current by resolveModel() on every call path so a
   * selection change takes effect without a restart.
   */
  private model: string;
  private cachedAvailability: { available: boolean; checkedAt: number } | null = null;
  private availabilityCacheTtl = 30000; // 30 seconds

  constructor() {
    this.host = config.OLLAMA_HOST;
    this.model = config.OLLAMA_VLM_MODEL;
  }

  /** Resolves the current selection and caches it in `this.model` for getModel()/isLightweightModel(). */
  private async resolveModel(): Promise<string> {
    this.model = await getVisionModel();
    return this.model;
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
      const model = await this.resolveModel();
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
        (m) => m.name === model || m.name.startsWith(model.split(':')[0])
      );

      this.cachedAvailability = { available: modelAvailable, checkedAt: Date.now() };

      if (!modelAvailable) {
        logger.warn(
          { model, availableModels: data.models?.map((m) => m.name) },
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
    const model = await this.resolveModel();

    logger.info({ host: this.host, model, bufferSize: imageBuffer.length }, 'Starting Ollama parseImage');

    const forInference = await downscaleForInference(imageBuffer);

    // Convert image to base64
    const imageBase64 = forInference.toString('base64');

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
          model,
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

      let data = (await response.json()) as OllamaGenerateResponse;

      // Empty completion means the model was not ready, not that the image was
      // unreadable — Ollama returns 200 immediately rather than queueing behind
      // the load. Wait for it to finish loading and ask once more.
      if (!data.response || !data.response.trim()) {
        logger.info({ model }, 'Empty completion — waiting for the model to finish loading');
        const ready = await waitForModel(this.host, model);
        if (ready) {
          // Its own budget: the original controller was disarmed by the
          // clearTimeout above, so reusing its signal would leave the retry
          // unbounded.
          const retryController = new AbortController();
          const retryTimeout = setTimeout(
            () => retryController.abort(),
            config.IMAGE_PARSE_TIMEOUT_MS
          );
          const retry = await fetch(`${this.host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt,
              images: [imageBase64],
              stream: false,
              options: { temperature: 0.1 },
            }),
            signal: retryController.signal,
          }).finally(() => clearTimeout(retryTimeout));
          if (retry.ok) {
            data = (await retry.json()) as OllamaGenerateResponse;
            logger.info({ model }, 'Retried after model load');
          }
        }
      }

      const processingTimeMs = Date.now() - startTime;

      logger.info(
        {
          model,
          processingTimeMs,
          totalDuration: data.total_duration,
          evalCount: data.eval_count,
        },
        'Ollama image parsing completed'
      );

      // Still empty after waiting for the load — a genuine failure now.
      if (!data.response || !data.response.trim()) {
        throw new Error(
          `${model} returned no text. The AI model may still be starting up — this can take a couple of minutes after the box has been idle. Try again shortly.`
        );
      }

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

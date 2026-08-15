import { config } from '../../../config/index.js';
import { logger } from '../../../lib/logger.js';
import { loadSharp } from '../../../lib/sharp.js';
import { getVisionModel } from '../../llm/llm-settings.js';
import type { VisionProvider, VisionResult } from './index.js';

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  /** 'stop' for a real answer; 'load' when the request only warmed the model. */
  done_reason?: string;
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
 * What we ask the model to do when the caller doesn't say.
 *
 * This is load-bearing, not a nicety. `/api/generate` treats an EMPTY prompt as
 * "load this model into memory and return" — it answers 200 in ~250ms with
 * `{"response":"","done_reason":"load"}` and never looks at the image. The one
 * caller in image-parse.service.ts passes '' (correct for the other three
 * providers, which run their own pipelines and ignore the argument), so every
 * scan that fell through to this backstop asked Ollama to warm up and reported
 * the resulting silence as a failed read.
 *
 * Verified on the box against the photo from a failed session: this prompt
 * transcribes a handwritten index card in ~4s, while '' returns
 * done_reason 'load' in 248ms. Same image, same warm model.
 */
const DEFAULT_TRANSCRIPTION_PROMPT =
  'Transcribe every word of text in this image exactly as written, preserving ' +
  'line breaks. Include the title, all ingredients with their quantities, and ' +
  'all instructions. Output only the transcribed text.';

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
    // An empty prompt is a load request to Ollama, not a question — see
    // DEFAULT_TRANSCRIPTION_PROMPT.
    const effectivePrompt = prompt.trim() ? prompt : DEFAULT_TRANSCRIPTION_PROMPT;

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
          prompt: effectivePrompt,
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
          model,
          processingTimeMs,
          totalDuration: data.total_duration,
          evalCount: data.eval_count,
          doneReason: data.done_reason,
        },
        'Ollama image parsing completed'
      );

      if (!data.response || !data.response.trim()) {
        // Log the fields whose absence hid this for so long: an empty answer
        // is only ever explicable through done_reason and eval_count.
        logger.error(
          {
            model,
            doneReason: data.done_reason,
            evalCount: data.eval_count,
            promptEvalCount: data.prompt_eval_count,
            promptLength: effectivePrompt.length,
          },
          'Ollama returned an empty completion'
        );

        // 'load' means Ollama read the request as "warm this model up" and
        // never ran inference — it only does that for an empty prompt, so
        // this is our bug, not the model's, and retrying would just warm it
        // up again. Out-of-VRAM, by contrast, comes back as a 500 with an
        // explicit error body and is handled above.
        if (data.done_reason === 'load') {
          throw new Error(
            `Ollama treated the request as a model load and never read the image ` +
              `(done_reason=load, prompt length ${effectivePrompt.length}). This is a bug in Basis, not a problem with your photo.`
          );
        }

        throw new Error(
          `${model} read the image but produced no text (done_reason=${data.done_reason ?? 'unknown'}).`
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

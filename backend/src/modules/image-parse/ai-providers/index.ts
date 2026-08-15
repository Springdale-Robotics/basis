// Vision AI provider interface and factory

import { config } from '../../../config/index.js';
import { logger } from '../../../lib/logger.js';
import { isReachable } from '../../llm/ollama-client.js';
import { getVisionModel } from '../../llm/llm-settings.js';

export interface VisionResult {
  rawText: string;
  structured?: {
    type: 'list' | 'recipe' | 'calendar_event' | 'mixed' | 'unknown';
    confidence: number;
    data: unknown;
  };
  processingTimeMs: number;
}

export interface VisionProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  parseImage(
    imageBuffer: Buffer,
    mimeType: string,
    prompt: string
  ): Promise<VisionResult>;
  getModel(): string;
  isLightweightModel(): boolean;
}

export interface VisionProviderStatus {
  available: boolean;
  name: string;
  model?: string;
  gpuAccelerated?: boolean;
  llmAvailable?: boolean;
  expectedProcessingMs?: number;
  error?: string;
}

export interface AllProvidersStatus {
  primary: VisionProviderStatus | null;
  fallback: VisionProviderStatus | null;
  activeProvider: string | null;
}

/**
 * Factory function to get the configured vision provider.
 *
 * Provider selection logic:
 * - 'handwriting-ocr': Use HandwritingOCR API only
 * - 'vlm-llm': Use VLM+LLM two-stage service only
 * - 'ollama-vision': Use Ollama directly only
 * - 'auto' (default): HandwritingOCR (if API key configured) -> VLM-LLM (if the
 *   two-stage service is up) -> Ollama vision (if Ollama itself is reachable).
 *   Ollama is the backstop: on a self-hosted install it is the piece most
 *   likely to actually be present, even when the separate vlm-llm service
 *   is not deployed.
 *
 * Returns null if no provider is available.
 */
export async function getVisionProvider(): Promise<VisionProvider | null> {
  const providerConfig = config.IMAGE_PARSE_PROVIDER;

  // HandwritingOCR provider (explicit or auto with API key)
  if (providerConfig === 'handwriting-ocr' || providerConfig === 'auto') {
    if (config.HANDWRITING_OCR_API_KEY) {
      try {
        const { HandwritingOcrProvider } = await import('./handwriting-ocr-provider.js');
        const ocrProvider = new HandwritingOcrProvider();

        if (await ocrProvider.isAvailable()) {
          logger.info({ provider: 'handwriting-ocr' }, 'Using HandwritingOCR API provider');
          return ocrProvider;
        }
      } catch (error) {
        logger.debug({ error }, 'HandwritingOCR provider not available');
      }

      if (providerConfig === 'handwriting-ocr') {
        logger.warn('HandwritingOCR provider configured but not available');
        return null;
      }
    }
  }

  // VLM-LLM provider (explicit or auto fallback)
  if (providerConfig === 'vlm-llm' || providerConfig === 'auto') {
    try {
      const { VlmLlmProvider } = await import('./vlm-llm-provider.js');
      const vlmLlmProvider = new VlmLlmProvider();

      if (await vlmLlmProvider.isAvailable()) {
        const gpuAvailable = await vlmLlmProvider.isGpuAvailable();
        const expectedMs = await vlmLlmProvider.getExpectedProcessingMs();
        logger.info(
          {
            provider: 'vlm-llm',
            model: vlmLlmProvider.getModel(),
            gpuAvailable,
            expectedProcessingMs: expectedMs,
          },
          `Using VLM-LLM provider (${gpuAvailable ? 'GPU' : 'CPU'} mode)`
        );
        return vlmLlmProvider;
      }
    } catch (error) {
      logger.debug({ error }, 'VLM-LLM provider not available');
    }
  }

  // Ollama vision provider (explicit or auto backstop). Gated on host
  // reachability rather than the provider's own isAvailable() — that check
  // also requires the specific selected model to already be pulled, which is
  // too strict a bar for "is this usable as a backstop at all."
  if (providerConfig === 'ollama-vision' || providerConfig === 'auto') {
    try {
      const { OllamaVisionProvider } = await import('./ollama-vision.js');

      if (await isReachable()) {
        const ollamaProvider = new OllamaVisionProvider();
        logger.info({ provider: 'ollama-vision' }, 'Using Ollama vision provider');
        return ollamaProvider;
      }
    } catch (error) {
      logger.debug({ error }, 'Ollama vision provider not available');
    }
  }

  logger.warn('No vision provider available');
  return null;
}

/**
 * Get detailed status of the vision provider.
 */
export async function getVisionProviderStatus(): Promise<VisionProviderStatus> {
  const provider = await getVisionProvider();

  if (!provider) {
    return {
      available: false,
      name: 'none',
      error: 'VLM-LLM service not available. Ensure the service is running and Ollama has the required models.',
    };
  }

  if (provider.name === 'handwriting-ocr') {
    return {
      available: true,
      name: provider.name,
      model: provider.getModel(),
      expectedProcessingMs: 15000, // ~15s for API transcription + LLM structuring
    };
  }

  if (provider.name === 'vlm-llm') {
    const { VlmLlmProvider } = await import('./vlm-llm-provider.js');
    const vlmLlmProvider = provider as InstanceType<typeof VlmLlmProvider>;

    const gpuAvailable = await vlmLlmProvider.isGpuAvailable();
    const expectedProcessingMs = await vlmLlmProvider.getExpectedProcessingMs();

    return {
      available: true,
      name: provider.name,
      model: provider.getModel(),
      gpuAccelerated: gpuAvailable,
      llmAvailable: await vlmLlmProvider.isLlmAvailable(),
      expectedProcessingMs,
    };
  }

  if (provider.name === 'ollama') {
    // Read from settings rather than provider.getModel(). The auto path above
    // gates the Ollama backstop on isReachable() rather than isAvailable(), so
    // resolveModel() has never run on this instance and getModel() would still
    // be echoing the OLLAMA_VLM_MODEL env default — reporting llava:7b on a
    // box where an admin selected qwen2.5vl:7b.
    const model = await getVisionModel();

    // Reachable is enough to *pick* Ollama as a backstop, but not enough to
    // call image parsing ready: install.sh now installs Ollama on every box,
    // so "running, no vision model pulled" is the state of every fresh
    // install until an admin visits this settings page. Reporting available
    // there sends the user to a scan that fails on Ollama's 404, where before
    // they got a clear "no provider available" up front.
    // isAvailable() resolves the selected model and checks it against
    // /api/tags — the same strict check getAllProvidersStatus already uses for
    // this provider, so the two no longer disagree about the same box.
    const modelPresent = await provider.isAvailable();

    return {
      available: modelPresent,
      name: provider.name,
      model,
      expectedProcessingMs: 150000, // Default CPU estimate
      error: modelPresent
        ? undefined
        : `Ollama is running but the ${model} vision model isn't installed yet. Install it under Settings → AI Models.`,
    };
  }

  // Fallback for a provider with no branch of its own above. Unreachable for
  // the three that exist today; kept so adding a fourth degrades to a vague
  // status rather than to nothing.
  return {
    available: true,
    name: provider.name,
    model: provider.getModel(),
    expectedProcessingMs: 150000, // Default CPU estimate
  };
}

/**
 * Get status of all vision providers.
 * Useful for debugging and monitoring.
 */
export async function getAllProvidersStatus(): Promise<AllProvidersStatus> {
  let primaryStatus: VisionProviderStatus | null = null;
  let fallbackStatus: VisionProviderStatus | null = null;
  let activeProvider: string | null = null;

  // Check HandwritingOCR provider
  if (config.HANDWRITING_OCR_API_KEY) {
    try {
      const { HandwritingOcrProvider } = await import('./handwriting-ocr-provider.js');
      const ocrProvider = new HandwritingOcrProvider();
      const available = await ocrProvider.isAvailable();

      const ocrStatus: VisionProviderStatus = {
        available,
        name: 'handwriting-ocr',
        model: 'handwriting-ocr-api',
        expectedProcessingMs: 15000,
        error: available ? undefined : 'HandwritingOCR API not reachable or invalid key',
      };

      if (available && !activeProvider) {
        primaryStatus = ocrStatus;
        activeProvider = 'handwriting-ocr';
      } else {
        fallbackStatus = ocrStatus;
      }
    } catch {
      // HandwritingOCR not available
    }
  }

  // Check VLM-LLM provider
  try {
    const { VlmLlmProvider } = await import('./vlm-llm-provider.js');
    const vlmLlmProvider = new VlmLlmProvider();
    const available = await vlmLlmProvider.isAvailable();

    let gpuAvailable = false;
    let expectedProcessingMs: number | undefined;

    if (available) {
      gpuAvailable = await vlmLlmProvider.isGpuAvailable();
      expectedProcessingMs = await vlmLlmProvider.getExpectedProcessingMs();
    }

    const vlmStatus: VisionProviderStatus = {
      available,
      name: 'vlm-llm',
      model: available ? vlmLlmProvider.getModel() : undefined,
      gpuAccelerated: gpuAvailable,
      llmAvailable: available ? await vlmLlmProvider.isLlmAvailable() : false,
      expectedProcessingMs,
      error: available ? undefined : 'VLM-LLM service not available',
    };

    if (!primaryStatus) {
      primaryStatus = vlmStatus;
      if (available) activeProvider = 'vlm-llm';
    } else {
      fallbackStatus = vlmStatus;
      if (available && !activeProvider) activeProvider = 'vlm-llm';
    }
  } catch {
    const vlmError: VisionProviderStatus = {
      available: false,
      name: 'vlm-llm',
      error: 'VLM-LLM provider module not loaded',
    };
    if (!primaryStatus) primaryStatus = vlmError;
    else fallbackStatus = vlmError;
  }

  // Check Ollama vision provider
  try {
    const { OllamaVisionProvider } = await import('./ollama-vision.js');
    const ollamaProvider = new OllamaVisionProvider();
    const available = await ollamaProvider.isAvailable();

    const ollamaStatus: VisionProviderStatus = {
      available,
      name: 'ollama',
      model: available ? ollamaProvider.getModel() : undefined,
      expectedProcessingMs: 150000, // Default CPU estimate
      error: available ? undefined : 'Ollama not reachable, or the selected model is not pulled',
    };

    if (!primaryStatus) {
      primaryStatus = ollamaStatus;
      if (available) activeProvider = 'ollama';
    } else if (!fallbackStatus) {
      // Guarded like the primary slot above. Without this, a box with
      // HandwritingOCR configured reports ocr as primary, vlm-llm as fallback,
      // and then Ollama silently overwrites the vlm-llm entry — so the status
      // endpoint never mentions the two-stage service and the UI can't warn
      // that it's down.
      fallbackStatus = ollamaStatus;
      if (available && !activeProvider) activeProvider = 'ollama';
    } else if (available && !activeProvider) {
      activeProvider = 'ollama';
    }
  } catch {
    const ollamaError: VisionProviderStatus = {
      available: false,
      name: 'ollama',
      error: 'Ollama vision provider module not loaded',
    };
    if (!primaryStatus) primaryStatus = ollamaError;
    else fallbackStatus = ollamaError;
  }

  return {
    primary: primaryStatus,
    fallback: fallbackStatus,
    activeProvider,
  };
}

// Vision AI provider interface and factory

import { config } from '../../../config/index.js';
import { logger } from '../../../lib/logger.js';

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
 * - 'auto' (default): Try HandwritingOCR first (if API key configured), fall back to VLM-LLM
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

  // Fallback for unknown provider (shouldn't happen)
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

  return {
    primary: primaryStatus,
    fallback: fallbackStatus,
    activeProvider,
  };
}

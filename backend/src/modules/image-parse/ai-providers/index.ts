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
 * - 'vlm-llm': Use VLM+LLM two-stage service only (preferred)
 * - 'auto' (default): Use VLM-LLM service
 *
 * The VLM-LLM service supports both GPU and CPU modes:
 * - GPU mode: ~45 seconds processing time
 * - CPU mode: ~150 seconds (2.5 minutes) processing time
 *
 * Returns null if no provider is available.
 */
export async function getVisionProvider(): Promise<VisionProvider | null> {
  const providerConfig = config.IMAGE_PARSE_PROVIDER;

  // Try VLM-LLM provider (only provider now)
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

    logger.warn('VLM-LLM provider not available - no fallback available');
    return null;
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

  // VLM-LLM provider (only provider now)
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
 * Get status of the VLM-LLM provider.
 * Useful for debugging and monitoring.
 */
export async function getAllProvidersStatus(): Promise<AllProvidersStatus> {
  let primaryStatus: VisionProviderStatus | null = null;
  let activeProvider: string | null = null;

  // Check VLM-LLM provider (only provider)
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

    primaryStatus = {
      available,
      name: 'vlm-llm',
      model: available ? vlmLlmProvider.getModel() : undefined,
      gpuAccelerated: gpuAvailable,
      llmAvailable: available ? await vlmLlmProvider.isLlmAvailable() : false,
      expectedProcessingMs,
      error: available ? undefined : 'VLM-LLM service not available',
    };

    if (available) {
      activeProvider = 'vlm-llm';
    }
  } catch {
    primaryStatus = {
      available: false,
      name: 'vlm-llm',
      error: 'VLM-LLM provider module not loaded',
    };
  }

  return {
    primary: primaryStatus,
    fallback: null, // No fallback provider
    activeProvider,
  };
}

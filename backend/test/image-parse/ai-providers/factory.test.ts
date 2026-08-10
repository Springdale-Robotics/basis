import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/config/index.js';

const mocks = vi.hoisted(() => ({
  isReachable: vi.fn(),
  vlmIsAvailable: vi.fn(),
}));

vi.mock('../../../src/modules/llm/ollama-client.js', () => ({
  isReachable: mocks.isReachable,
}));

// vlm-llm talks to a separate Python microservice; stub it out entirely so
// these tests never make a network call and can drive its availability
// per-case.
vi.mock('../../../src/modules/image-parse/ai-providers/vlm-llm-provider.js', () => ({
  VlmLlmProvider: vi.fn().mockImplementation(() => ({
    name: 'vlm-llm',
    isAvailable: mocks.vlmIsAvailable,
    isGpuAvailable: vi.fn().mockResolvedValue(false),
    getExpectedProcessingMs: vi.fn().mockResolvedValue(150000),
    getModel: vi.fn().mockReturnValue('mock-vlm-model'),
    isLlmAvailable: vi.fn().mockResolvedValue(false),
    isLightweightModel: vi.fn().mockReturnValue(false),
    parseImage: vi.fn(),
  })),
}));

const { getVisionProvider } = await import('../../../src/modules/image-parse/ai-providers/index.js');
const { OllamaVisionProvider } = await import('../../../src/modules/image-parse/ai-providers/ollama-vision.js');

describe('vision provider factory', () => {
  const originalProviderConfig = config.IMAGE_PARSE_PROVIDER;
  const originalApiKey = config.HANDWRITING_OCR_API_KEY;

  afterEach(() => {
    config.IMAGE_PARSE_PROVIDER = originalProviderConfig;
    config.HANDWRITING_OCR_API_KEY = originalApiKey;
    mocks.isReachable.mockReset();
    mocks.vlmIsAvailable.mockReset();
  });

  it("returns OllamaVisionProvider when IMAGE_PARSE_PROVIDER is explicitly 'ollama-vision'", async () => {
    config.IMAGE_PARSE_PROVIDER = 'ollama-vision';
    config.HANDWRITING_OCR_API_KEY = undefined;
    mocks.isReachable.mockResolvedValue(true);

    const provider = await getVisionProvider();

    expect(provider).toBeInstanceOf(OllamaVisionProvider);
  });

  it('auto: falls back to Ollama when vlm-llm is unavailable and Ollama is reachable (the production-box case)', async () => {
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = undefined;
    mocks.vlmIsAvailable.mockResolvedValue(false);
    mocks.isReachable.mockResolvedValue(true);

    const provider = await getVisionProvider();

    expect(provider).toBeInstanceOf(OllamaVisionProvider);
  });

  it('auto: vlm-llm wins over Ollama when vlm-llm is available (fallback stays a fallback, not a takeover)', async () => {
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = undefined;
    mocks.vlmIsAvailable.mockResolvedValue(true);
    mocks.isReachable.mockResolvedValue(true);

    const provider = await getVisionProvider();

    expect(provider?.name).toBe('vlm-llm');
    expect(provider).not.toBeInstanceOf(OllamaVisionProvider);
  });

  it('auto: returns null when nothing is available', async () => {
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = undefined;
    mocks.vlmIsAvailable.mockResolvedValue(false);
    mocks.isReachable.mockResolvedValue(false);

    const provider = await getVisionProvider();

    expect(provider).toBeNull();
  });
});

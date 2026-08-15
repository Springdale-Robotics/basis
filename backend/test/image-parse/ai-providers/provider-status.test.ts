import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/config/index.js';

const mocks = vi.hoisted(() => ({
  isReachable: vi.fn(),
  vlmIsAvailable: vi.fn(),
  ollamaIsAvailable: vi.fn(),
  getVisionModel: vi.fn(),
}));

vi.mock('../../../src/modules/llm/ollama-client.js', () => ({
  isReachable: mocks.isReachable,
}));

vi.mock('../../../src/modules/llm/llm-settings.js', () => ({
  getVisionModel: mocks.getVisionModel,
}));

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

vi.mock('../../../src/modules/image-parse/ai-providers/ollama-vision.js', () => ({
  OllamaVisionProvider: vi.fn().mockImplementation(() => ({
    name: 'ollama',
    isAvailable: mocks.ollamaIsAvailable,
    getModel: vi.fn().mockReturnValue('llava:7b'),
    parseImage: vi.fn(),
  })),
}));

const { getVisionProviderStatus, getAllProvidersStatus } = await import(
  '../../../src/modules/image-parse/ai-providers/index.js'
);

describe('vision provider status', () => {
  const originalProviderConfig = config.IMAGE_PARSE_PROVIDER;
  const originalApiKey = config.HANDWRITING_OCR_API_KEY;

  afterEach(() => {
    config.IMAGE_PARSE_PROVIDER = originalProviderConfig;
    config.HANDWRITING_OCR_API_KEY = originalApiKey;
    vi.clearAllMocks();
  });

  it('does not call image parsing ready when Ollama is up but the model is not pulled', async () => {
    // The state of every fresh box: install.sh installs Ollama, and no vision
    // model exists until an admin visits the settings page. Reporting
    // available here sent the user into a scan that fails on Ollama's 404.
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = undefined;
    mocks.vlmIsAvailable.mockResolvedValue(false);
    mocks.isReachable.mockResolvedValue(true);
    mocks.ollamaIsAvailable.mockResolvedValue(false);
    mocks.getVisionModel.mockResolvedValue('qwen2.5vl:7b');

    const status = await getVisionProviderStatus();

    expect(status.name).toBe('ollama');
    expect(status.available).toBe(false);
    expect(status.error).toMatch(/qwen2\.5vl:7b/);
  });

  it('reports ready once the selected model is installed', async () => {
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = undefined;
    mocks.vlmIsAvailable.mockResolvedValue(false);
    mocks.isReachable.mockResolvedValue(true);
    mocks.ollamaIsAvailable.mockResolvedValue(true);
    mocks.getVisionModel.mockResolvedValue('qwen2.5vl:7b');

    const status = await getVisionProviderStatus();

    expect(status).toMatchObject({ name: 'ollama', available: true, model: 'qwen2.5vl:7b' });
    expect(status.error).toBeUndefined();
  });

  it('reports the model an admin selected, not the env default', async () => {
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = undefined;
    mocks.vlmIsAvailable.mockResolvedValue(false);
    mocks.isReachable.mockResolvedValue(true);
    mocks.ollamaIsAvailable.mockResolvedValue(true);
    mocks.getVisionModel.mockResolvedValue('qwen2.5vl:7b');

    const status = await getVisionProviderStatus();

    // getModel() would still echo llava:7b — the auto path never ran
    // resolveModel() on that instance.
    expect(status.model).toBe('qwen2.5vl:7b');
  });
});

describe('getAllProvidersStatus', () => {
  const originalProviderConfig = config.IMAGE_PARSE_PROVIDER;
  const originalApiKey = config.HANDWRITING_OCR_API_KEY;

  afterEach(() => {
    config.IMAGE_PARSE_PROVIDER = originalProviderConfig;
    config.HANDWRITING_OCR_API_KEY = originalApiKey;
    vi.clearAllMocks();
  });

  it('keeps the vlm-llm entry when Ollama is also present', async () => {
    // Ollama used to overwrite the fallback slot unconditionally, so a box
    // with HandwritingOCR configured never reported vlm-llm at all and the UI
    // could not warn that the two-stage service was down.
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = 'set';
    mocks.vlmIsAvailable.mockResolvedValue(true);
    mocks.isReachable.mockResolvedValue(true);
    mocks.ollamaIsAvailable.mockResolvedValue(true);
    mocks.getVisionModel.mockResolvedValue('qwen2.5vl:7b');

    const status = await getAllProvidersStatus();

    const names = [status.primary?.name, status.fallback?.name];
    expect(names).toContain('handwriting-ocr');
    expect(names).toContain('vlm-llm');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/config/index.js';
import { loadSharp } from '../../../src/lib/sharp.js';

const mocks = vi.hoisted(() => ({
  isReachable: vi.fn(),
  vlmIsAvailable: vi.fn(),
  backend: null as 'local' | 'claude' | null,
  keyState: 'none' as 'none' | 'set' | 'unreadable',
}));

// The AI backend switch lives in system_settings; drive it per-case instead.
vi.mock('../../../src/modules/llm/claude/ai-backend.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/modules/llm/claude/ai-backend.js')>()),
  getAiBackend: async () => mocks.backend,
  getClaudeKeyStatus: async () => ({ state: mocks.keyState, hint: null }),
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
const { ClaudeVisionProvider } = await import('../../../src/modules/image-parse/ai-providers/claude-vision.js');
const { CLAUDE_ERROR_MESSAGES } = await import('../../../src/modules/llm/claude/claude-call.js');

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

describe('vision provider factory under the AI backend switch', () => {
  const originalProviderConfig = config.IMAGE_PARSE_PROVIDER;
  const originalApiKey = config.HANDWRITING_OCR_API_KEY;
  let fetched: string[];

  beforeEach(() => {
    fetched = [];
    // Record every outbound request. HandwritingOCR's availability probe is a
    // real fetch to its API, so "never contacted" is checked here.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        fetched.push(String(url));
        return new Response('{}', { status: 200 });
      })
    );
  });

  afterEach(() => {
    config.IMAGE_PARSE_PROVIDER = originalProviderConfig;
    config.HANDWRITING_OCR_API_KEY = originalApiKey;
    mocks.backend = null;
    mocks.keyState = 'none';
    mocks.isReachable.mockReset();
    mocks.vlmIsAvailable.mockReset();
    vi.unstubAllGlobals();
  });

  it('local: never contacts HandwritingOCR even with its key set, and uses Ollama', async () => {
    mocks.backend = 'local';
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = 'hw-key';
    mocks.vlmIsAvailable.mockResolvedValue(false);
    mocks.isReachable.mockResolvedValue(true);

    const provider = await getVisionProvider();

    expect(provider).toBeInstanceOf(OllamaVisionProvider);
    expect(fetched.filter((u) => u.includes('handwritingocr'))).toEqual([]);
  });

  it("local: an explicit 'handwriting-ocr' provider setting yields no provider rather than an upload", async () => {
    mocks.backend = 'local';
    config.IMAGE_PARSE_PROVIDER = 'handwriting-ocr';
    config.HANDWRITING_OCR_API_KEY = 'hw-key';

    expect(await getVisionProvider()).toBeNull();
    expect(fetched).toEqual([]);
  });

  it('claude: returns the Claude provider and contacts nothing local or third-party', async () => {
    mocks.backend = 'claude';
    mocks.keyState = 'set';
    config.IMAGE_PARSE_PROVIDER = 'auto';
    config.HANDWRITING_OCR_API_KEY = 'hw-key';
    mocks.vlmIsAvailable.mockResolvedValue(true);
    mocks.isReachable.mockResolvedValue(true);

    const provider = await getVisionProvider();

    expect(provider).toBeInstanceOf(ClaudeVisionProvider);
    expect(fetched).toEqual([]);
    expect(mocks.vlmIsAvailable).not.toHaveBeenCalled();
    expect(mocks.isReachable).not.toHaveBeenCalled();
  });

  it('claude without a key: still the Claude provider, so the scan fails with the no-key message', async () => {
    mocks.backend = 'claude';
    mocks.keyState = 'none';
    mocks.isReachable.mockResolvedValue(true);

    const provider = await getVisionProvider();

    expect(provider).toBeInstanceOf(ClaudeVisionProvider);
    const sharp = await loadSharp();
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await expect(provider!.parseImage(photo, 'image/jpeg', '')).rejects.toThrow(CLAUDE_ERROR_MESSAGES.no_key);
    await expect(provider!.isAvailable()).resolves.toBe(false);
  });
});

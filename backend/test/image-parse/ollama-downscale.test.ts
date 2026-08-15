import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSharp } from '../../src/lib/sharp.js';

const mocks = vi.hoisted(() => ({
  getVisionModel: vi.fn().mockResolvedValue('qwen2.5vl:7b'),
}));

vi.mock('../../src/modules/llm/llm-settings.js', () => ({
  getVisionModel: mocks.getVisionModel,
}));

const { OllamaVisionProvider } = await import(
  '../../src/modules/image-parse/ai-providers/ollama-vision.js'
);

/**
 * A phone photo handed to a 7B vision model whole expands into enough image
 * tokens to exhaust an 8GB card. Ollama answers "CUDA error: out of memory" —
 * sometimes a 500, sometimes a 200 with an empty completion — and the import
 * produced no text at all after a 24-second wait.
 *
 * Preprocessing (deskew, contrast, resize) lives inside the vlm-llm sidecar's
 * /extract/base64, so this only ever bit the Ollama path: the backstop every
 * box without that sidecar falls back to.
 */

const originalFetch = globalThis.fetch;
let sentPayloads: Array<{ images: string[] }> = [];

function mockOllama(response: string) {
  sentPayloads = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sentPayloads.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ response }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** A photo-sized JPEG — bigger on the long edge than we're willing to send. */
async function bigPhoto(): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp({
    create: { width: 3024, height: 4032, channels: 3, background: { r: 200, g: 180, b: 190 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVisionModel.mockResolvedValue('qwen2.5vl:7b');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Ollama vision provider: image size sent for inference', () => {
  it('downscales a phone-sized photo before sending it to the model', async () => {
    const original = await bigPhoto();
    mockOllama('Spoon Bread\n2 eggs');

    const provider = new OllamaVisionProvider();
    await provider.parseImage(original, 'image/jpeg', 'transcribe');

    expect(sentPayloads).toHaveLength(1);
    const sentBytes = Buffer.from(sentPayloads[0].images[0], 'base64').length;
    expect(sentBytes).toBeLessThan(original.length);

    // And it really is a smaller image, not just a re-encode.
    const sharp = await loadSharp();
    const meta = await sharp(Buffer.from(sentPayloads[0].images[0], 'base64')).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1024);
  }, 30000);

  it('leaves an already-small image alone', async () => {
    const sharp = await loadSharp();
    const small = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .jpeg()
      .toBuffer();
    mockOllama('some text');

    const provider = new OllamaVisionProvider();
    await provider.parseImage(small, 'image/jpeg', 'transcribe');

    const sentBytes = Buffer.from(sentPayloads[0].images[0], 'base64').length;
    expect(sentBytes).toBe(small.length);
  }, 30000);

  it('treats an empty completion as a failure rather than an empty success', async () => {
    // Ollama returns 200 with an empty response when the model cannot run.
    // Reporting that as success walked the user to a blank review box with no
    // explanation, after a 24-second wait.
    const small = await bigPhoto();
    mockOllama('');

    const provider = new OllamaVisionProvider();
    await expect(provider.parseImage(small, 'image/jpeg', 'transcribe')).rejects.toThrow(
      /returned no text/i
    );
  }, 30000);
});

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
 * tokens to exhaust an 8GB card, so we downscale before inference.
 * Preprocessing (deskew, contrast, resize) lives inside the vlm-llm sidecar's
 * /extract/base64, so this only ever mattered on the Ollama path: the backstop
 * every box without that sidecar falls back to.
 *
 * The prompt tests below cover the separate reason that backstop never
 * produced any text at all — see DEFAULT_TRANSCRIPTION_PROMPT.
 */

const originalFetch = globalThis.fetch;
let sentPayloads: Array<{ images: string[]; prompt: string }> = [];

/** Mock /api/generate with an arbitrary response body. */
function mockOllama(body: Record<string, unknown>) {
  sentPayloads = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sentPayloads.push(JSON.parse(init.body));
    return { ok: true, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** Mock /api/generate failing the way an out-of-VRAM run actually fails. */
function mockOllamaError(status: number, errorBody: string) {
  sentPayloads = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sentPayloads.push(JSON.parse(init.body));
    return { ok: false, status, text: async () => errorBody } as unknown as Response;
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
    mockOllama({ response: 'Spoon Bread\n2 eggs', done_reason: 'stop' });

    const provider = new OllamaVisionProvider();
    await provider.parseImage(original, 'image/jpeg', '');

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
    mockOllama({ response: 'some text', done_reason: 'stop' });

    const provider = new OllamaVisionProvider();
    await provider.parseImage(small, 'image/jpeg', '');

    const sentBytes = Buffer.from(sentPayloads[0].images[0], 'base64').length;
    expect(sentBytes).toBe(small.length);
  }, 30000);
});

describe('Ollama vision provider: the prompt actually sent', () => {
  /**
   * The whole bug in one assertion. image-parse.service.ts passes '' — right
   * for the three providers that run their own pipelines, fatal here, because
   * Ollama reads an empty prompt as "load the model and return" and never
   * looks at the image.
   *
   * The previous version of this suite passed 'transcribe' on every call,
   * which is exactly why it went on passing while every real scan failed.
   */
  it('asks the model to do something when the caller supplies no prompt', async () => {
    const photo = await bigPhoto();
    mockOllama({ response: 'Spoon Bread', done_reason: 'stop' });

    const provider = new OllamaVisionProvider();
    await provider.parseImage(photo, 'image/jpeg', '');

    expect(sentPayloads[0].prompt.trim()).not.toBe('');
    expect(sentPayloads[0].prompt).toMatch(/transcribe/i);
  }, 30000);

  it('passes a caller-supplied prompt through unchanged', async () => {
    const photo = await bigPhoto();
    mockOllama({ response: 'a list', done_reason: 'stop' });

    const provider = new OllamaVisionProvider();
    await provider.parseImage(photo, 'image/jpeg', 'List the ingredients only.');

    expect(sentPayloads[0].prompt).toBe('List the ingredients only.');
  }, 30000);
});

describe('Ollama vision provider: empty and failed completions', () => {
  it('reports done_reason=load as our bug rather than a bad photo', async () => {
    // Observed verbatim on the box: 200 in 248ms, no inference at all.
    const photo = await bigPhoto();
    mockOllama({ response: '', done: true, done_reason: 'load' });

    const provider = new OllamaVisionProvider();
    await expect(provider.parseImage(photo, 'image/jpeg', '')).rejects.toThrow(
      /bug in Basis, not a problem with your photo/i
    );
  }, 30000);

  it('does not blame the photo when the model simply returned nothing', async () => {
    const photo = await bigPhoto();
    mockOllama({ response: '', done: true, done_reason: 'stop' });

    const provider = new OllamaVisionProvider();
    await expect(provider.parseImage(photo, 'image/jpeg', '')).rejects.toThrow(
      /produced no text \(done_reason=stop\)/i
    );
  }, 30000);

  it('surfaces the real reason when the model runs out of VRAM', async () => {
    // A genuine out-of-memory run is a 500 with an explicit body, NOT an
    // empty 200 — which is what makes done_reason=load unambiguous above.
    const photo = await bigPhoto();
    mockOllamaError(
      500,
      '{"error":"an error was encountered while running the model: CUDA error\\nCUDA error: out of memory"}'
    );

    const provider = new OllamaVisionProvider();
    await expect(provider.parseImage(photo, 'image/jpeg', '')).rejects.toThrow(/out of memory/i);
  }, 30000);
});

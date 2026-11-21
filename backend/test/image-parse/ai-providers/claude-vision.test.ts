import { afterEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { loadSharp } from '../../../src/lib/sharp.js';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../../../src/modules/llm/claude/ai-backend.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/modules/llm/claude/ai-backend.js')>()),
  getClaudeKeyStatus: async () => ({ state: 'set', hint: '••••1234' }),
  getClaudeClient: async () => ({ messages: { create: mocks.create } }),
}));
vi.mock('../../../src/modules/llm/claude/claude-model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/modules/llm/claude/claude-model.js')>()),
  getClaudeModel: async () => ({ id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', resolvedAt: null }),
}));

const { ClaudeVisionProvider } = await import('../../../src/modules/image-parse/ai-providers/claude-vision.js');
const { DEFAULT_TRANSCRIPTION_PROMPT } = await import('../../../src/modules/image-parse/ai-providers/ollama-vision.js');
const { CLAUDE_ERROR_MESSAGES } = await import('../../../src/modules/llm/claude/claude-call.js');

afterEach(() => mocks.create.mockReset());

async function bigPng(): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .png()
    .toBuffer();
}

function sentBlocks() {
  return mocks.create.mock.calls[0][0].messages[0].content as Array<Record<string, any>>;
}

describe('ClaudeVisionProvider', () => {
  it('sends a large PNG as a JPEG no longer than 1568px on its long edge', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'Pancakes' }], stop_reason: 'end_turn' });

    const result = await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');

    expect(result.rawText).toBe('Pancakes');
    expect(result.structured).toBeUndefined();
    const image = sentBlocks()[0];
    expect(image.type).toBe('image');
    expect(image.source.media_type).toBe('image/jpeg');
    const sharp = await loadSharp();
    const meta = await sharp(Buffer.from(image.source.data, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1568);
  });

  it('re-encodes even a small image so the declared type is always right', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' });
    const sharp = await loadSharp();
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).webp().toBuffer();

    await new ClaudeVisionProvider().parseImage(small, 'image/webp', '');

    const meta = await sharp(Buffer.from(sentBlocks()[0].source.data, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('uses the default transcription prompt when the caller passes none', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' });
    await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '  ');
    expect(sentBlocks()[1]).toEqual({ type: 'text', text: DEFAULT_TRANSCRIPTION_PROMPT });
  });

  it('leaves room for thinking and a long transcription (max_tokens 16000)', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' });
    await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');
    expect(mocks.create.mock.calls[0][0].max_tokens).toBe(16000);
  });

  it('a real iPhone HEIC photo fails with the clear message, not a raw API error', async () => {
    const heic = await readFile(new URL('../../receipts/fixtures/sample-receipt.heic', import.meta.url));
    const result = await new ClaudeVisionProvider().parseImage(heic, 'image/heic', '').then(
      () => 'sent',
      (e: Error) => e.message
    );
    // sharp here has no HEVC decoder; if a future build gains one the photo is
    // simply sent as a JPEG, which is also fine.
    if (result !== 'sent') expect(result).toBe("This photo couldn't be read. Try a JPEG or PNG.");
    else expect(sentBlocks()[0].source.media_type).toBe('image/jpeg');
  });

  it('refuses an image it cannot decode instead of sending it', async () => {
    await expect(
      new ClaudeVisionProvider().parseImage(Buffer.from('definitely not an image'), 'image/heic', '')
    ).rejects.toThrow("This photo couldn't be read. Try a JPEG or PNG.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reports a revoked key with the key-rejected message', async () => {
    mocks.create.mockRejectedValue(
      new Anthropic.AuthenticationError(401, { error: { message: 'invalid x-api-key' } }, 'invalid', new Headers())
    );
    await expect(new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '')).rejects.toThrow(
      CLAUDE_ERROR_MESSAGES.auth
    );
  });
});

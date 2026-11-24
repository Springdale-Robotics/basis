import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  backend: 'claude' as 'local' | 'claude' | null,
  keyState: 'set' as 'none' | 'set' | 'unreadable',
}));

vi.mock('../../src/modules/llm/claude/ai-backend.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/llm/claude/ai-backend.js')>()),
  getAiBackend: async () => mocks.backend,
  getClaudeKeyStatus: async () => ({ state: mocks.keyState, hint: null }),
  getClaudeClient: async () => (mocks.keyState === 'set' ? { messages: { create: mocks.create } } : null),
}));
vi.mock('../../src/modules/llm/claude/claude-model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/llm/claude/claude-model.js')>()),
  getClaudeModel: async () => ({ id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', resolvedAt: null }),
}));

const { structureReceipt, isStructurerAvailable } = await import('../../src/modules/receipts/receipt-structurer.js');
const { CLAUDE_ERROR_MESSAGES } = await import('../../src/modules/llm/claude/claude-call.js');

let fetched: string[];

beforeEach(() => {
  mocks.backend = 'claude';
  mocks.keyState = 'set';
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      fetched.push(String(url));
      return new Response('{"models":[]}', { status: 200 });
    })
  );
});
afterEach(() => {
  mocks.create.mockReset();
  vi.unstubAllGlobals();
});

describe('receipt structuring with Claude selected', () => {
  it('sends the transcription to Claude with the structuring prompt and parses the reply', async () => {
    mocks.create.mockResolvedValue({
      content: [{ type: 'text', text: '{"merchant":"Costco","lines":[{"raw_text":"MILK"}]}' }],
      stop_reason: 'end_turn',
    });

    const result = await structureReceipt('MILK 3.50');

    expect(result.merchant).toBe('Costco');
    expect(result.lines.map((l) => l.rawText)).toEqual(['MILK']);
    const prompt = mocks.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt.startsWith('You are parsing a supermarket receipt')).toBe(true);
    expect(prompt.endsWith('MILK 3.50')).toBe(true);
    expect(mocks.create.mock.calls[0][0].max_tokens).toBe(16000);
    expect(fetched).toEqual([]);
  });

  it('is available with a key and never asks Ollama', async () => {
    expect(await isStructurerAvailable()).toBe(true);
    expect(fetched).toEqual([]);
  });

  it('explains why structuring is unavailable when Claude has no usable key', async () => {
    const { structurerUnavailableReason } = await import('../../src/modules/receipts/receipt-structurer.js');
    mocks.keyState = 'none';
    expect(await structurerUnavailableReason()).toBe(CLAUDE_ERROR_MESSAGES.no_key);
    mocks.keyState = 'unreadable';
    expect(await structurerUnavailableReason()).toBe(CLAUDE_ERROR_MESSAGES.key_unreadable);
    mocks.keyState = 'set';
    expect(await structurerUnavailableReason()).toBeNull();
  });

  it('is unavailable without a usable key', async () => {
    mocks.keyState = 'none';
    expect(await isStructurerAvailable()).toBe(false);
    mocks.keyState = 'unreadable';
    expect(await isStructurerAvailable()).toBe(false);
  });

  it('reports a cut-off answer for a long receipt instead of a JSON error', async () => {
    mocks.create.mockResolvedValue({
      content: [{ type: 'text', text: '{"lines":[{"raw_text":"MI' }],
      stop_reason: 'max_tokens',
    });
    await expect(structureReceipt('MILK 3.50')).rejects.toThrow(CLAUDE_ERROR_MESSAGES.truncated);
  });

  it('reports a revoked key with the key-rejected message', async () => {
    mocks.create.mockRejectedValue(
      new Anthropic.AuthenticationError(401, { error: { message: 'invalid' } }, 'invalid', new Headers())
    );
    await expect(structureReceipt('MILK 3.50')).rejects.toThrow(CLAUDE_ERROR_MESSAGES.auth);
  });
});

describe('receipt structuring with Claude not selected', () => {
  it('local: uses Ollama and never Claude', async () => {
    mocks.backend = 'local';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        fetched.push(String(url));
        return new Response(JSON.stringify({ response: '{"lines":[{"raw_text":"MILK"}]}' }), { status: 200 });
      })
    );

    await structureReceipt('MILK 3.50');

    expect(mocks.create).not.toHaveBeenCalled();
    expect(fetched.some((u) => u.endsWith('/api/generate'))).toBe(true);
  });
});

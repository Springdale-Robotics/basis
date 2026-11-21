import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  keyState: 'set' as 'none' | 'set' | 'unreadable',
  getClaudeModel: vi.fn(),
}));

vi.mock('../../src/modules/llm/claude/ai-backend.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/llm/claude/ai-backend.js')>()),
  getClaudeKeyStatus: async () => ({ state: mocks.keyState, hint: mocks.keyState === 'none' ? null : '••••1234' }),
  getClaudeClient: async () => (mocks.keyState === 'set' ? { messages: { create: mocks.create } } : null),
}));
vi.mock('../../src/modules/llm/claude/claude-model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/llm/claude/claude-model.js')>()),
  getClaudeModel: mocks.getClaudeModel,
}));

const { claudeComplete, ClaudeError, CLAUDE_ERROR_MESSAGES } = await import(
  '../../src/modules/llm/claude/claude-call.js'
);

const SECRET = 'sk-ant-test-1234';

function reply(text: string, stop_reason = 'end_turn') {
  return { content: [{ type: 'text', text }], stop_reason };
}

function apiError(Cls: new (...a: never[]) => Error, status: number, message: string): Error {
  return new (Cls as unknown as typeof Anthropic.APIError)(
    status,
    { type: 'error', error: { type: 'x', message } },
    message,
    new Headers()
  );
}

beforeEach(() => {
  mocks.keyState = 'set';
  mocks.getClaudeModel.mockResolvedValue({ id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', resolvedAt: null });
});
afterEach(() => {
  mocks.create.mockReset();
  mocks.getClaudeModel.mockReset();
});

describe('claudeComplete request', () => {
  it('sends only model, max_tokens, messages and system — never sampling or thinking params', async () => {
    mocks.create.mockResolvedValue(reply('hello'));
    const text = await claudeComplete({ system: 'Be terse.', content: 'Hi', maxTokens: 100 });

    expect(text).toBe('hello');
    const body = mocks.create.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('omits system when none is given', async () => {
    mocks.create.mockResolvedValue(reply('ok'));
    await claudeComplete({ content: 'Hi', maxTokens: 100 });
    expect(Object.keys(mocks.create.mock.calls[0][0]).sort()).toEqual(['max_tokens', 'messages', 'model']);
  });

  it('joins multiple text blocks', async () => {
    mocks.create.mockResolvedValue({
      content: [{ type: 'text', text: 'a' }, { type: 'thinking', thinking: '' }, { type: 'text', text: 'b' }],
      stop_reason: 'end_turn',
    });
    expect(await claudeComplete({ content: 'Hi', maxTokens: 100 })).toBe('ab');
  });
});

describe('claudeComplete key state', () => {
  it('fails with no_key and makes no call when no key is saved', async () => {
    mocks.keyState = 'none';
    await expect(claudeComplete({ content: 'Hi', maxTokens: 10 })).rejects.toThrow(CLAUDE_ERROR_MESSAGES.no_key);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('fails with key_unreadable and makes no call when the key cannot be decrypted', async () => {
    mocks.keyState = 'unreadable';
    await expect(claudeComplete({ content: 'Hi', maxTokens: 10 })).rejects.toThrow(
      CLAUDE_ERROR_MESSAGES.key_unreadable
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('claudeComplete error mapping', () => {
  const cases: Array<[string, () => Error, keyof typeof CLAUDE_ERROR_MESSAGES]> = [
    ['401', () => apiError(Anthropic.AuthenticationError, 401, `invalid x-api-key ${SECRET}`), 'auth'],
    ['403', () => apiError(Anthropic.PermissionDeniedError, 403, 'forbidden'), 'auth'],
    ['429', () => apiError(Anthropic.RateLimitError, 429, 'slow down'), 'rate_limit'],
    ['network', () => new Anthropic.APIConnectionError({ message: 'ECONNRESET' }), 'network'],
  ];

  for (const [label, makeError, kind] of cases) {
    it(`maps ${label} to ${kind} without leaking the key`, async () => {
      mocks.create.mockRejectedValue(makeError());
      const err = await claudeComplete({ content: 'Hi', maxTokens: 10 }).catch((e) => e);
      expect(err).toBeInstanceOf(ClaudeError);
      expect(err.kind).toBe(kind);
      expect(err.message).toBe(CLAUDE_ERROR_MESSAGES[kind]);
      expect(err.message).not.toContain(SECRET);
    });
  }

  it('maps other API errors to api with the status', async () => {
    mocks.create.mockRejectedValue(apiError(Anthropic.InternalServerError, 529, 'overloaded'));
    const err = await claudeComplete({ content: 'Hi', maxTokens: 10 }).catch((e) => e);
    expect(err.kind).toBe('api');
    expect(err.message).toBe(`${CLAUDE_ERROR_MESSAGES.api} (HTTP 529).`);
  });

  it('maps a refusal stop reason to refusal', async () => {
    mocks.create.mockResolvedValue(reply('', 'refusal'));
    await expect(claudeComplete({ content: 'Hi', maxTokens: 10 })).rejects.toThrow(CLAUDE_ERROR_MESSAGES.refusal);
  });

  it('maps a max_tokens stop reason to truncated', async () => {
    mocks.create.mockResolvedValue(reply('{"lines": [', 'max_tokens'));
    await expect(claudeComplete({ content: 'Hi', maxTokens: 10 })).rejects.toThrow(
      CLAUDE_ERROR_MESSAGES.truncated
    );
  });
});

describe('claudeComplete when the model is retired', () => {
  it('re-resolves the model and retries once with the new id', async () => {
    mocks.getClaudeModel
      .mockResolvedValueOnce({ id: 'claude-haiku-5-5', displayName: 'x', resolvedAt: null })
      .mockResolvedValueOnce({ id: 'claude-haiku-6', displayName: 'y', resolvedAt: 'now' });
    mocks.create
      .mockRejectedValueOnce(apiError(Anthropic.NotFoundError, 404, 'model: claude-haiku-5-5'))
      .mockResolvedValueOnce(reply('ok'));

    expect(await claudeComplete({ content: 'Hi', maxTokens: 10 })).toBe('ok');
    expect(mocks.getClaudeModel).toHaveBeenLastCalledWith({ force: true });
    expect(mocks.create.mock.calls[1][0].model).toBe('claude-haiku-6');
  });

  it('gives up with api after the retry also 404s', async () => {
    mocks.create.mockRejectedValue(apiError(Anthropic.NotFoundError, 404, 'model: gone'));
    const err = await claudeComplete({ content: 'Hi', maxTokens: 10 }).catch((e) => e);
    expect(err.kind).toBe('api');
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
});

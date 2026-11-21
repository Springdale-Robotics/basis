import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../src/config/index.js';

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

const { getLLMProvider } = await import('../../src/services/llm-provider.js');
const { parseRecipeWithLLM, llmFailureWarning, LLM_PARSE_WARNING } = await import(
  '../../src/services/llm-recipe-parser.js'
);
const { tryLLMFallback } = await import('../../src/modules/recipes/recipe-import.service.js');
const { CLAUDE_ERROR_MESSAGES } = await import('../../src/modules/llm/claude/claude-call.js');

const VALID_RECIPE = JSON.stringify({
  title: 'Pancakes',
  ingredientGroups: [{ name: null, ingredients: [{ name: 'flour', quantity: 1, unit: 'cup' }] }],
  instructions: ['Mix and cook.'],
});

const authError = () =>
  new Anthropic.AuthenticationError(401, { error: { message: 'invalid' } }, 'invalid', new Headers());
const rateLimitError = () =>
  new Anthropic.RateLimitError(429, { error: { message: 'slow' } }, 'slow', new Headers());

const originalEnvKey = config.ANTHROPIC_API_KEY;

beforeEach(() => {
  mocks.backend = 'claude';
  mocks.keyState = 'set';
});
afterEach(() => {
  mocks.create.mockReset();
  config.ANTHROPIC_API_KEY = originalEnvKey;
  vi.restoreAllMocks();
});

describe('getLLMProvider under the AI backend switch', () => {
  it('claude: returns the Claude provider', async () => {
    expect((await getLLMProvider())?.name).toBe('claude');
  });

  it('claude without a key: still the Claude provider, so the failure is visible', async () => {
    mocks.keyState = 'none';
    expect((await getLLMProvider())?.name).toBe('claude');
  });

  it('local: never Anthropic, even with the env key set', async () => {
    mocks.backend = 'local';
    config.ANTHROPIC_API_KEY = 'sk-ant-env';
    expect((await getLLMProvider())?.name).not.toBe('anthropic');
  });

  it('not chosen: the env key keeps working as before', async () => {
    mocks.backend = null;
    config.ANTHROPIC_API_KEY = 'sk-ant-env';
    expect((await getLLMProvider())?.name).toBe('anthropic');
  });

  it('not chosen: the legacy Anthropic call sends no sampling params', async () => {
    mocks.backend = null;
    config.ANTHROPIC_API_KEY = 'sk-ant-env';
    const spy = vi
      .spyOn(Anthropic.Messages.prototype, 'create')
      .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } as never);

    await (await getLLMProvider())!.complete('hi', { systemPrompt: 's', maxTokens: 10 });

    const body = spy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
  });

  it('claude: the request carries no sampling params', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: VALID_RECIPE }], stop_reason: 'end_turn' });
    await parseRecipeWithLLM('Pancakes\n1 cup flour\nMix and cook.');
    expect(Object.keys(mocks.create.mock.calls[0][0]).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
  });
});

describe('parseRecipeWithLLM outcome', () => {
  it('ok with the parsed recipe', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: VALID_RECIPE }], stop_reason: 'end_turn' });
    const outcome = await parseRecipeWithLLM('Pancakes');
    expect(outcome.ok).toBe(true);
  });

  it('provider_error carrying the mapped message when Claude fails', async () => {
    mocks.create.mockRejectedValue(authError());
    expect(await parseRecipeWithLLM('Pancakes')).toEqual({
      ok: false,
      reason: 'provider_error',
      userMessage: CLAUDE_ERROR_MESSAGES.auth,
    });
  });

  it('unparseable when Claude answers with something that is not a recipe', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'no idea' }], stop_reason: 'end_turn' });
    expect(await parseRecipeWithLLM('Pancakes')).toEqual({ ok: false, reason: 'unparseable' });
  });
});

describe('tryLLMFallback (used by both the text and URL import paths)', () => {
  it('on success returns the converted recipe and the usual LLM warning', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: VALID_RECIPE }], stop_reason: 'end_turn' });
    const result = await tryLLMFallback('Pancakes');
    expect(result.recipe?.title).toBe('Pancakes');
    expect(result.warnings).toEqual([LLM_PARSE_WARNING]);
  });

  it('on a Claude failure keeps no recipe and adds a visible warning with the reason', async () => {
    mocks.create.mockRejectedValue(authError());
    const result = await tryLLMFallback('Pancakes');
    expect(result.recipe).toBeNull();
    expect(result.warnings).toEqual([llmFailureWarning(CLAUDE_ERROR_MESSAGES.auth)]);
    expect(result.warnings[0]).toBe(
      `Claude couldn't help with this recipe: ${CLAUDE_ERROR_MESSAGES.auth} Used basic parsing instead.`
    );
  });

  it('stays silent when the AI simply could not parse the text', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'no idea' }], stop_reason: 'end_turn' });
    expect(await tryLLMFallback('Pancakes')).toEqual({ recipe: null, warnings: [] });
  });
});

describe('POST /recipes/import/:sessionId/reparse-llm', () => {
  let ctx: Awaited<ReturnType<typeof import('../helpers/route-harness.js').setupRouteTest>>;

  beforeAll(async () => {
    const { setupRouteTest } = await import('../helpers/route-harness.js');
    ctx = await setupRouteTest();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('returns the mapped Claude message when Claude is rate limited', async () => {
    const { db } = await import('../../src/config/database.js');
    const { recipeImportSessions } = await import('../../src/db/schema/index.js');
    const householdId = await ctx.createHousehold('LLM Reparse');
    const user = await ctx.createUser(householdId, 'member');
    const [session] = await db
      .insert(recipeImportSessions)
      .values({
        householdId,
        userId: user.id,
        sourceType: 'text',
        sourceData: 'Pancakes\n1 cup flour',
        status: 'pending_review',
        expiresAt: new Date(Date.now() + 3_600_000),
      } as never)
      .returning();

    mocks.create.mockRejectedValue(rateLimitError());
    const res = await user.fetch(`/api/v1/recipes/import/${session.id}/reparse-llm`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe(CLAUDE_ERROR_MESSAGES.rate_limit);
  });
});

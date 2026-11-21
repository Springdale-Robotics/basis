import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';

const getClaudeClient = vi.fn();
vi.mock('../../src/modules/llm/claude/ai-backend.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/llm/claude/ai-backend.js')>()),
  getClaudeClient: () => getClaudeClient(),
}));

const { CLAUDE_MODEL_KEY, FALLBACK_CLAUDE_MODEL, getClaudeModel, pickNewestHaiku } = await import(
  '../../src/modules/llm/claude/claude-model.js'
);

type ModelInfo = Anthropic.ModelInfo;

function model(id: string, createdAt: string, imageInput: boolean | null = true): ModelInfo {
  return {
    id,
    display_name: id.replace('claude-', 'Claude ').replace(/-/g, ' '),
    created_at: createdAt,
    type: 'model',
    capabilities: imageInput === null ? null : ({ image_input: { supported: imageInput } } as never),
  } as unknown as ModelInfo;
}

function clientListing(models: ModelInfo[] | Error) {
  const list = vi.fn(() => {
    if (models instanceof Error) {
      // Mirror the SDK: the page promise rejects when iterated.
      return {
        async *[Symbol.asyncIterator]() {
          throw models;
        },
      };
    }
    return {
      async *[Symbol.asyncIterator]() {
        yield* models;
      },
    };
  });
  getClaudeClient.mockResolvedValue({ models: { list } });
  return list;
}

const clear = async (): Promise<void> => {
  await db.delete(systemSettings).where(inArray(systemSettings.key, [CLAUDE_MODEL_KEY]));
};
beforeAll(clear);
afterEach(async () => {
  await clear();
  getClaudeClient.mockReset();
});

async function storeResolved(id: string, ageHours: number): Promise<void> {
  const value = { id, displayName: id, resolvedAt: new Date(Date.now() - ageHours * 3_600_000).toISOString() };
  await db.insert(systemSettings).values({ key: CLAUDE_MODEL_KEY, value });
}

describe('pickNewestHaiku', () => {
  it('picks the most recently created Haiku', () => {
    const picked = pickNewestHaiku([
      model('claude-haiku-5-5', '2026-06-01T00:00:00Z'),
      model('claude-haiku-6', '2027-03-01T00:00:00Z'),
    ]);
    expect(picked?.id).toBe('claude-haiku-6');
  });

  it('ignores non-Haiku models even when newer', () => {
    const picked = pickNewestHaiku([
      model('claude-haiku-5-5', '2026-06-01T00:00:00Z'),
      model('claude-sonnet-5-5', '2026-09-01T00:00:00Z'),
    ]);
    expect(picked?.id).toBe('claude-haiku-5-5');
  });

  it('skips a Haiku that does not take images', () => {
    const picked = pickNewestHaiku([
      model('claude-haiku-5-5', '2026-06-01T00:00:00Z'),
      model('claude-haiku-6', '2027-03-01T00:00:00Z', false),
    ]);
    expect(picked?.id).toBe('claude-haiku-5-5');
  });

  it('treats unreported capabilities as eligible', () => {
    expect(pickNewestHaiku([model('claude-haiku-6', '2027-03-01T00:00:00Z', null)])?.id).toBe('claude-haiku-6');
  });

  it('returns null when there is no Haiku', () => {
    expect(pickNewestHaiku([])).toBeNull();
  });
});

describe('getClaudeModel', () => {
  it('resolves the newest Haiku and stores it', async () => {
    clientListing([model('claude-haiku-5-5', '2026-06-01T00:00:00Z'), model('claude-haiku-6', '2027-03-01T00:00:00Z')]);
    const resolved = await getClaudeModel();
    expect(resolved.id).toBe('claude-haiku-6');
    expect(resolved.resolvedAt).not.toBeNull();

    const row = await db.query.systemSettings.findFirst({ where: (t, { eq }) => eq(t.key, CLAUDE_MODEL_KEY) });
    expect((row?.value as { id: string }).id).toBe('claude-haiku-6');
  });

  it('uses a fresh stored choice without asking the Models API', async () => {
    await storeResolved('claude-haiku-5-5', 1);
    const list = clientListing([model('claude-haiku-6', '2027-03-01T00:00:00Z')]);
    expect((await getClaudeModel()).id).toBe('claude-haiku-5-5');
    expect(list).not.toHaveBeenCalled();
  });

  it('re-resolves a choice older than 24 hours', async () => {
    await storeResolved('claude-haiku-5-5', 25);
    const list = clientListing([model('claude-haiku-6', '2027-03-01T00:00:00Z')]);
    expect((await getClaudeModel()).id).toBe('claude-haiku-6');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('always re-resolves with force', async () => {
    await storeResolved('claude-haiku-5-5', 1);
    const list = clientListing([model('claude-haiku-6', '2027-03-01T00:00:00Z')]);
    expect((await getClaudeModel({ force: true })).id).toBe('claude-haiku-6');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored choice when listing fails', async () => {
    await storeResolved('claude-haiku-5-5', 25);
    clientListing(new Error('network down'));
    expect((await getClaudeModel()).id).toBe('claude-haiku-5-5');
  });

  it('falls back to the constant when listing fails and nothing was ever resolved', async () => {
    clientListing(new Error('network down'));
    expect(await getClaudeModel()).toEqual({ ...FALLBACK_CLAUDE_MODEL, resolvedAt: null });
  });

  it('falls back to the constant when there is no client (no key)', async () => {
    getClaudeClient.mockResolvedValue(null);
    expect((await getClaudeModel()).id).toBe(FALLBACK_CLAUDE_MODEL.id);
  });

  it('asks the Models API once for many concurrent callers with a stale cache', async () => {
    const list = clientListing([model('claude-haiku-6', '2027-03-01T00:00:00Z')]);
    const results = await Promise.all(Array.from({ length: 5 }, () => getClaudeModel()));
    expect(results.every((r) => r.id === 'claude-haiku-6')).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';
import {
  AI_BACKEND_KEY,
  CLAUDE_API_KEY_KEY,
  clearClaudeKey,
  getAiBackend,
  getClaudeClient,
  getClaudeKey,
  getClaudeKeyStatus,
  saveClaudeKey,
  setAiBackend,
  __resetClaudeClientForTests,
} from '../../src/modules/llm/claude/ai-backend.js';

// system_settings is box-global, shared by every file that touches ai.* —
// clear on the way in and out (vitest runs files sequentially here).
const clearAi = async (): Promise<void> => {
  await db
    .delete(systemSettings)
    .where(inArray(systemSettings.key, [AI_BACKEND_KEY, CLAUDE_API_KEY_KEY, 'ai.claudeModel']));
  __resetClaudeClientForTests();
};

beforeAll(clearAi);
afterEach(clearAi);

async function storeRaw(key: string, value: unknown): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value } });
}

describe('getAiBackend', () => {
  it('is null when nothing is stored (legacy behaviour)', async () => {
    expect(await getAiBackend()).toBeNull();
  });

  it('returns local after setAiBackend("local")', async () => {
    await setAiBackend('local');
    expect(await getAiBackend()).toBe('local');
  });

  it('treats an unknown stored value as not chosen', async () => {
    await storeRaw(AI_BACKEND_KEY, 'banana');
    expect(await getAiBackend()).toBeNull();
  });
});

describe('setAiBackend("claude")', () => {
  it('is refused while no key is stored', async () => {
    await expect(setAiBackend('claude')).rejects.toThrow('Add a Claude API key before choosing Claude.');
    expect(await getAiBackend()).toBeNull();
  });

  it('succeeds once a key is saved', async () => {
    await saveClaudeKey('sk-ant-test-1234');
    await setAiBackend('claude');
    expect(await getAiBackend()).toBe('claude');
  });
});

describe('saveClaudeKey', () => {
  it('trims whitespace and newlines from a pasted key', async () => {
    await saveClaudeKey('  sk-ant-test-1234\n');
    expect(await getClaudeKey()).toBe('sk-ant-test-1234');
    expect(await getClaudeKeyStatus()).toEqual({ state: 'set', hint: '••••1234' });
  });

  it('never stores the key in plain text', async () => {
    await saveClaudeKey('sk-ant-test-1234');
    const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, CLAUDE_API_KEY_KEY) });
    expect(JSON.stringify(row?.value)).not.toContain('sk-ant-test-1234');
  });
});

describe('getClaudeKeyStatus', () => {
  it('is none with nothing stored', async () => {
    expect(await getClaudeKeyStatus()).toEqual({ state: 'none', hint: null });
    expect(await getClaudeKey()).toBeNull();
  });

  it('reports unreadable for a ciphertext that will not decrypt, and keeps Claude selected', async () => {
    await saveClaudeKey('sk-ant-test-1234');
    await setAiBackend('claude');
    await storeRaw(CLAUDE_API_KEY_KEY, { ciphertext: 'not-real-ciphertext', hint: '••••1234' });

    expect(await getClaudeKeyStatus()).toEqual({ state: 'unreadable', hint: '••••1234' });
    expect(await getClaudeKey()).toBeNull();
    expect(await getAiBackend()).toBe('claude');
  });
});

describe('clearClaudeKey', () => {
  it('switches Claude back to local in the same step', async () => {
    await saveClaudeKey('sk-ant-test-1234');
    await setAiBackend('claude');
    await clearClaudeKey();
    expect(await getAiBackend()).toBe('local');
    expect((await getClaudeKeyStatus()).state).toBe('none');
  });

  it('leaves local as local', async () => {
    await saveClaudeKey('sk-ant-test-1234');
    await setAiBackend('local');
    await clearClaudeKey();
    expect(await getAiBackend()).toBe('local');
  });

  it('leaves an unchosen backend unchosen', async () => {
    await saveClaudeKey('sk-ant-test-1234');
    await clearClaudeKey();
    expect(await getAiBackend()).toBeNull();
  });
});

describe('getClaudeClient', () => {
  it('is null with no key', async () => {
    expect(await getClaudeClient()).toBeNull();
  });

  it('reuses one client per key and rebuilds when the key changes', async () => {
    await saveClaudeKey('sk-ant-test-1111');
    const first = await getClaudeClient();
    expect(first).not.toBeNull();
    expect(await getClaudeClient()).toBe(first);

    await saveClaudeKey('sk-ant-test-2222');
    const second = await getClaudeClient();
    expect(second).not.toBe(first);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import Anthropic from '@anthropic-ai/sdk';
import { inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

// Never reach Anthropic: the candidate-key check goes through createClaudeClient,
// and model resolution is stubbed.
vi.mock('../../src/modules/llm/claude/ai-backend.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/llm/claude/ai-backend.js')>()),
  createClaudeClient: () => ({ models: { list: mocks.list } }),
}));
vi.mock('../../src/modules/llm/claude/claude-model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/llm/claude/claude-model.js')>()),
  getClaudeModel: async () => ({ id: 'claude-haiku-6', displayName: 'Claude Haiku 6', resolvedAt: 'now' }),
}));

const { CLAUDE_ERROR_MESSAGES } = await import('../../src/modules/llm/claude/claude-call.js');
const { REDACT_PATHS } = await import('../../src/lib/logger.js');

const AI_KEYS = ['ai.backend', 'ai.claudeApiKey', 'ai.claudeModel'];
const clearAi = () => db.delete(systemSettings).where(inArray(systemSettings.key, AI_KEYS));

let ctx: RouteTestContext;
let admin: TestUser;
let member: TestUser;

beforeAll(async () => {
  await clearAi();
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  admin = await ctx.createUser(householdId, 'admin');
  member = await ctx.createUser(householdId, 'member');
});
afterEach(async () => {
  await clearAi();
  mocks.list.mockReset();
});
afterAll(async () => {
  await clearAi();
  await ctx.close();
});

const listOk = () =>
  mocks.list.mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { id: 'claude-haiku-6' };
    },
  });

async function call(user: TestUser, method: string, path: string, body?: unknown) {
  const res = await user.fetch(`/api/v1/llm${path}`, {
    method,
    // The harness sets the JSON content type itself.
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

describe('admin gating', () => {
  it('refuses a non-admin on every AI backend route', async () => {
    expect((await call(member, 'GET', '/backend')).status).toBe(403);
    expect((await call(member, 'PUT', '/backend', { backend: 'local' })).status).toBe(403);
    expect((await call(member, 'PUT', '/claude-key', { apiKey: 'sk-ant-valid-1234567890' })).status).toBe(403);
    expect((await call(member, 'DELETE', '/claude-key')).status).toBe(403);
  });
});

describe('GET /backend', () => {
  it('reports nothing chosen and no key on a fresh box', async () => {
    const res = await call(admin, 'GET', '/backend');
    expect(res.json.data).toEqual({ backend: null, keyState: 'none', keyHint: null, model: null });
  });

  it('reports an unreadable key distinctly, with no model', async () => {
    await db.insert(systemSettings).values({ key: 'ai.claudeApiKey', value: { ciphertext: 'junk', hint: '••••1234' } });
    const res = await call(admin, 'GET', '/backend');
    expect(res.json.data).toMatchObject({ keyState: 'unreadable', keyHint: '••••1234', model: null });
  });
});

describe('PUT /claude-key', () => {
  it('accepts a pasted key with whitespace, stores it, and never echoes it', async () => {
    listOk();
    const res = await call(admin, 'PUT', '/claude-key', { apiKey: '  sk-ant-valid-1234567890\n' });

    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({
      backend: null,
      keyState: 'set',
      keyHint: '••••7890',
      model: { id: 'claude-haiku-6', displayName: 'Claude Haiku 6' },
    });
    expect(res.text).not.toContain('sk-ant-valid-1234567890');
    expect((await call(admin, 'GET', '/backend')).text).not.toContain('sk-ant-valid-1234567890');
  });

  it('rejects a key Anthropic refuses, with the mapped message, and stores nothing', async () => {
    mocks.list.mockImplementation(() => {
      throw new Anthropic.AuthenticationError(401, { error: { message: 'invalid' } }, 'invalid', new Headers());
    });
    const res = await call(admin, 'PUT', '/claude-key', { apiKey: 'sk-ant-wrong-1234567890' });

    expect(res.status).toBe(400);
    // Worded for the moment of saving: "replace it in Settings" makes no sense there.
    expect(res.json.error.message).toBe('Anthropic rejected this key. Check it and try again.');
    expect((await call(admin, 'GET', '/backend')).json.data.keyState).toBe('none');
  });

  it('rejects an empty key', async () => {
    expect((await call(admin, 'PUT', '/claude-key', { apiKey: '   ' })).status).toBe(400);
  });
});

describe('PUT /backend', () => {
  it('refuses Claude without a key', async () => {
    const res = await call(admin, 'PUT', '/backend', { backend: 'claude' });
    expect(res.status).toBe(400);
  });

  it('switches to Claude once a key is saved', async () => {
    listOk();
    await call(admin, 'PUT', '/claude-key', { apiKey: 'sk-ant-valid-1234567890' });
    const res = await call(admin, 'PUT', '/backend', { backend: 'claude' });
    expect(res.status).toBe(200);
    expect(res.json.data.backend).toBe('claude');
  });

  it('rejects an unknown backend', async () => {
    expect((await call(admin, 'PUT', '/backend', { backend: 'cloud' })).status).toBe(400);
  });
});

describe('DELETE /claude-key', () => {
  it('removes the key and switches Claude back to this server', async () => {
    listOk();
    await call(admin, 'PUT', '/claude-key', { apiKey: 'sk-ant-valid-1234567890' });
    await call(admin, 'PUT', '/backend', { backend: 'claude' });

    const res = await call(admin, 'DELETE', '/claude-key');

    expect(res.json.data).toMatchObject({ backend: 'local', keyState: 'none', keyHint: null });
  });
});

describe('GET /status', () => {
  it('includes the AI backend', async () => {
    await call(admin, 'PUT', '/backend', { backend: 'local' });
    expect((await call(admin, 'GET', '/status')).json.data.backend).toBe('local');
  });
});

describe('log redaction', () => {
  it('drops the API key from logged objects', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, remove: true } }, sink);

    log.info({ apiKey: 'sk-ant-x1', body: { apiKey: 'sk-ant-x2' }, claudeApiKey: 'sk-ant-x3' }, 'saving');
    log.info({ req: { body: { apiKey: 'sk-ant-x4' } } }, 'request');

    const out = lines.join('');
    for (const secret of ['sk-ant-x1', 'sk-ant-x2', 'sk-ant-x3', 'sk-ant-x4']) {
      expect(out).not.toContain(secret);
    }
  });
});

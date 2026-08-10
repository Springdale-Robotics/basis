import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

vi.mock('../../src/modules/llm/ollama-client.js', () => ({
  isReachable: vi.fn().mockResolvedValue(true),
  listInstalledTags: vi.fn().mockResolvedValue(['qwen2.5:7b']),
  pullModel: vi.fn().mockResolvedValue(undefined),
  deleteModel: vi.fn().mockResolvedValue(undefined),
}));

let ctx: RouteTestContext;
let admin: TestUser;
let member: TestUser;

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  admin = await ctx.createUser(householdId, 'admin');
  member = await ctx.createUser(householdId, 'member');
});

afterAll(async () => {
  await db.delete(systemSettings).where(inArray(systemSettings.key, ['llm.textModel', 'llm.visionModel']));
  await ctx.close();
});

describe('admin gating', () => {
  it('refuses a non-admin on every read route', async () => {
    // These expose host internals — GPU, RAM, what is installed.
    for (const path of ['/api/v1/llm/hardware', '/api/v1/llm/catalog', '/api/v1/llm/status']) {
      expect((await member.fetch(path)).status).toBe(403);
    }
    expect((await admin.fetch('/api/v1/llm/hardware')).status).toBe(200);
  });

  it('refuses a non-admin on settings', async () => {
    const res = await member.fetch('/api/v1/llm/settings', {
      method: 'PUT',
      body: JSON.stringify({ textModel: 'qwen2.5:7b' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/llm/catalog', () => {
  it('returns every entry with a fit verdict', async () => {
    const body = await (await admin.fetch('/api/v1/llm/catalog')).json();
    expect(body.data.models.length).toBeGreaterThan(0);
    for (const m of body.data.models) {
      expect(['recommended', 'fits', 'cpu-only', 'too-large']).toContain(m.fit);
    }
  });
});

describe('GET /api/v1/llm/status', () => {
  it('reports reachability, installed tags and selections', async () => {
    const body = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(body.data.reachable).toBe(true);
    expect(body.data.installed).toContain('qwen2.5:7b');
    expect(body.data.selected.text).toBeTruthy();
  });

  it('flags a selection whose model is not installed', async () => {
    // Deleting the active model otherwise turns every scan into a failure
    // with no visible cause.
    const body = await (await admin.fetch('/api/v1/llm/status')).json();
    // The default vision model is not in the mocked installed list.
    expect(body.data.missing.vision).toBe(true);
    expect(body.data.missing.text).toBe(false);
  });
});

describe('PUT /api/v1/llm/settings', () => {
  it('accepts an installed tag and persists it', async () => {
    const res = await admin.fetch('/api/v1/llm/settings', {
      method: 'PUT',
      body: JSON.stringify({ textModel: 'qwen2.5:7b' }),
    });
    expect(res.status).toBe(200);

    const status = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(status.data.selected.text).toBe('qwen2.5:7b');
  });

  it('rejects a tag that is not installed, and does not persist it', async () => {
    const res = await admin.fetch('/api/v1/llm/settings', {
      method: 'PUT',
      body: JSON.stringify({ textModel: 'not-pulled:7b' }),
    });
    expect(res.status).toBe(400);

    const status = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(status.data.selected.text).not.toBe('not-pulled:7b');
  });
});

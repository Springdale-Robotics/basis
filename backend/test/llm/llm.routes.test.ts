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

// Imported after the mock so per-test overrides (mockResolvedValueOnce) can
// reach the same mock instances the routes call.
const { isReachable, listInstalledTags } = await import('../../src/modules/llm/ollama-client.js');

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

  it('does not report models missing when Ollama is unreachable', async () => {
    // An unreachable Ollama also makes listInstalledTags() return []. Without
    // the `reachable &&` guard on `missing`, every selection would flip to
    // "missing" and the settings page would read as "every model needs
    // reinstalling" instead of the actual problem, "Ollama is not running".
    vi.mocked(isReachable).mockResolvedValueOnce(false);
    vi.mocked(listInstalledTags).mockResolvedValueOnce([]);

    const body = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(body.data.reachable).toBe(false);
    expect(body.data.missing.text).toBe(false);
    expect(body.data.missing.vision).toBe(false);
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

  it('persists nothing when one of two submitted tags is not installed', async () => {
    // Seed a baseline distinct from every tag this test submits, written
    // directly rather than through the route (bypassing the installed-tag
    // check). This makes the test self-contained rather than relying on
    // what an earlier test in this file happened to leave behind — and it
    // has to be distinct: if the baseline already equalled the valid tag
    // being submitted here ('qwen2.5:7b', which also happens to be the env
    // default), a regression that persists the valid field before
    // validating the second one would be invisible, since "before" and
    // "after" would look identical whether or not the write happened.
    await db
      .insert(systemSettings)
      .values({ key: 'llm.textModel', value: 'previous-tag' })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: 'previous-tag', updatedAt: new Date() },
      });

    const before = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(before.data.selected.text).toBe('previous-tag');

    const res = await admin.fetch('/api/v1/llm/settings', {
      method: 'PUT',
      body: JSON.stringify({ textModel: 'qwen2.5:7b', visionModel: 'not-pulled:7b' }),
    });
    expect(res.status).toBe(400);

    const after = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(after.data.selected.text).toBe('previous-tag');
    expect(after.data.selected.vision).toBe(before.data.selected.vision);
  });
});

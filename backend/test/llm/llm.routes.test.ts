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

// Wraps the real statfs so most tests hit the actual filesystem (plenty of
// space) while the disk-space test below can force a tiny-free-space return.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, statfs: vi.fn(actual.statfs) };
});

// Imported after the mock so per-test overrides (mockResolvedValueOnce) can
// reach the same mock instances the routes call.
const { isReachable, listInstalledTags, pullModel } = await import('../../src/modules/llm/ollama-client.js');
const { statfs } = await import('fs/promises');

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

describe('POST /api/v1/llm/models/pull', () => {
  it('refuses a non-admin', async () => {
    const res = await member.fetch('/api/v1/llm/models/pull', {
      method: 'POST',
      body: JSON.stringify({ tag: 'qwen2.5:3b' }),
    });
    expect(res.status).toBe(403);
  });

  it('starts a pull and returns a pullId when there is room on disk', async () => {
    // Mocked rather than relying on the real filesystem — the previous
    // version of this test called the real statfs against STORAGE_PATH,
    // which would false-fail on a disk-constrained CI runner.
    vi.mocked(statfs).mockResolvedValueOnce({
      bavail: 1_000_000_000_000,
      bsize: 1,
    } as Awaited<ReturnType<typeof statfs>>);

    const res = await admin.fetch('/api/v1/llm/models/pull', {
      method: 'POST',
      body: JSON.stringify({ tag: 'qwen2.5:3b' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.data.pullId).toBe('string');
    expect(body.data.pullId.length).toBeGreaterThan(0);
  });

  it('rejects a pull it can already tell will not fit, without ever calling pullModel', async () => {
    // Isolate from any pullModel calls earlier tests in this file made.
    pullModel.mockClear();
    // Free space reported as effectively zero — every catalog entry needs more.
    vi.mocked(statfs).mockResolvedValueOnce({ bavail: 1, bsize: 1 } as Awaited<
      ReturnType<typeof statfs>
    >);

    const res = await admin.fetch('/api/v1/llm/models/pull', {
      method: 'POST',
      body: JSON.stringify({ tag: 'qwen2.5vl:7b' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/not enough disk space/i);
    expect(body.error.message).toMatch(/Qwen 2\.5 VL 7B/);
    // The name of this test promises the disk check runs before the pull
    // starts — assert that, not just the response shape, so a regression
    // that reorders assertDiskSpaceFor() after startPull() (which would
    // still return 400, since the throw still propagates before the route
    // handler's return) is actually caught.
    expect(pullModel).not.toHaveBeenCalled();
  });

  it('does not block a pull for a tag outside the curated catalog', async () => {
    // The advanced free-text field lets an admin pull any tag; size is
    // unknowable for those, so the pre-check must not refuse them.
    vi.mocked(statfs).mockResolvedValueOnce({ bavail: 1, bsize: 1 } as Awaited<
      ReturnType<typeof statfs>
    >);

    const res = await admin.fetch('/api/v1/llm/models/pull', {
      method: 'POST',
      body: JSON.stringify({ tag: 'some-custom-tag:latest' }),
    });
    expect(res.status).toBe(200);
  });
});

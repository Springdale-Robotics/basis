import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  setupRouteTest,
  json,
  type RouteTestContext,
  type TestUser,
} from '../helpers/route-harness.js';
import { db } from '../../src/config/database.js';
import { inventoryItems } from '../../src/db/schema/index.js';

/**
 * The planning route: what an import would add to the inventory, before it
 * adds anything. Its sibling create-items inserts first and mentions
 * near-matches afterwards, which offers a decision about a row that already
 * exists — no use when founding an inventory, since the duplicates it makes
 * are permanent.
 */

let ctx: RouteTestContext;
let user: TestUser;
let householdId: string;

let neighbour: TestUser;
let neighbourHouseholdId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  householdId = await ctx.createHousehold('Planning');
  user = await ctx.createUser(householdId, 'admin');

  neighbourHouseholdId = await ctx.createHousehold('Next Door');
  neighbour = await ctx.createUser(neighbourHouseholdId, 'admin');
}, 60000);

afterAll(async () => {
  await ctx?.close();
});

const planItems = (names: string[]) =>
  user.fetch('/api/v1/recipes/ingredients/plan-items', {
    method: 'POST',
    body: JSON.stringify({ ingredients: names.map((name) => ({ name })) }),
  });

const catalogOf = (household: string) =>
  db.query.inventoryItems.findMany({ where: eq(inventoryItems.householdId, household) });

describe('POST /ingredients/plan-items', () => {
  it('creates nothing', async () => {
    const before = await catalogOf(householdId);

    const res = await planItems(['salt', 'table salt', 'cinnamon']);
    expect(res.status).toBe(200);

    const after = await catalogOf(householdId);
    expect(after).toHaveLength(before.length);
  });

  it('reports variants that arrived together as worth a decision', async () => {
    const res = await planItems(['salt', 'table salt']);
    const { data } = await json(res);

    expect(data.items).toHaveLength(2);
    expect(data.needingReview).toBe(2);
    // CRF title-cases the names it tidies, so match on meaning not spelling.
    const salt = data.items.find(
      (i: { canonicalName: string }) => i.canonicalName.toLowerCase() === 'salt'
    );
    expect(salt.similarPlanned[0].canonicalName.toLowerCase()).toBe('table salt');
  });

  it('leaves unrelated ingredients unflagged', async () => {
    const res = await planItems(['salt', 'flour', 'butter']);
    const { data } = await json(res);
    expect(data.needingReview).toBe(0);
  });
});

describe('POST /ingredients/plan-items: tenancy', () => {
  it('never suggests another household\'s items', async () => {
    // The neighbour stocks something a near-match would otherwise surface.
    await neighbour.fetch('/api/v1/recipes/ingredients/create-items', {
      method: 'POST',
      body: JSON.stringify({ ingredients: [{ name: 'Light Olive Oil' }] }),
    });
    const neighbourCatalog = await catalogOf(neighbourHouseholdId);
    expect(neighbourCatalog.length).toBeGreaterThan(0);

    const res = await planItems(['olive oil']);
    const { data } = await json(res);

    const suggestedIds = data.items.flatMap(
      (i: { similarExisting: Array<{ itemId: string }> }) => i.similarExisting.map((s) => s.itemId)
    );
    const neighbourIds = new Set(neighbourCatalog.map((i) => i.id));
    for (const id of suggestedIds) {
      expect(neighbourIds.has(id)).toBe(false);
    }

    // And it isn't passing merely because nothing was suggested at all: the
    // neighbour's item is a near-match by name, so a missing household filter
    // would surface it.
    const names = neighbourCatalog.map((i) => i.name).join(' ');
    expect(names.toLowerCase()).toContain('olive oil');
  });
});


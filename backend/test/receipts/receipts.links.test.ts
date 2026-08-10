import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import { inventoryItems, receiptLineLinks } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

let ctx: RouteTestContext;
let user: TestUser;
let oilId: string;
let spinachId: string;

async function seedLink(
  merchant: string,
  lineKey: string,
  itemId: string,
  opts: { lastRawText?: string | null } = {}
): Promise<string> {
  const [link] = await db
    .insert(receiptLineLinks)
    .values({
      householdId: user.householdId,
      merchant,
      lineKey,
      keyKind: 'code',
      itemId,
      unitsPerCount: '2000.000',
      lastRawText: opts.lastRawText ?? null,
    })
    .returning({ id: receiptLineLinks.id });
  return link.id;
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  user = await ctx.createUser(householdId);

  const [oil] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  oilId = oil.id;

  const [spinach] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Spinach', defaultUnit: 'g' })
    .returning({ id: inventoryItems.id });
  spinachId = spinach.id;
});

afterAll(async () => {
  await ctx.close();
});

describe('GET /api/v1/receipts/links', () => {
  it('lists links with the item name attached', async () => {
    await seedLink('costco', 'code-list-1', oilId);
    const res = await user.fetch('/api/v1/receipts/links');
    expect(res.status).toBe(200);

    const body = await res.json();
    const link = body.data.links.find((l: { lineKey: string }) => l.lineKey === 'code-list-1');
    expect(link.itemName).toBe('Olive Oil');
  });

  it('includes the last raw receipt text so a code-keyed link is recognizable', async () => {
    await seedLink('costco', 'code-list-3', oilId, { lastRawText: '1234567 KS ORG EVOO' });
    const res = await user.fetch('/api/v1/receipts/links');
    expect(res.status).toBe(200);

    const body = await res.json();
    const link = body.data.links.find((l: { lineKey: string }) => l.lineKey === 'code-list-3');
    expect(link.lastRawText).toBe('1234567 KS ORG EVOO');
  });

  it('filters by merchant, case-insensitively against the normalized stored value', async () => {
    await seedLink('safeway', 'code-list-2', spinachId);
    // Stored merchants are always lowercase (confirmScan normalizes them before
    // insert). A user filtering with mixed case must still match — prove that
    // by querying with a case that differs from what's stored.
    const res = await user.fetch('/api/v1/receipts/links?merchant=Safeway');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.links.length).toBeGreaterThan(0);
    expect(body.data.links.every((l: { merchant: string }) => l.merchant === 'safeway')).toBe(true);
    expect(
      body.data.links.some((l: { lineKey: string }) => l.lineKey === 'code-list-2')
    ).toBe(true);
  });
});

describe('PATCH /api/v1/receipts/links/:id', () => {
  it('repoints a link at a different item', async () => {
    const linkId = await seedLink('costco', 'code-patch-1', oilId);
    const res = await user.fetch(`/api/v1/receipts/links/${linkId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: spinachId, unitsPerCount: 150 }),
    });
    expect(res.status).toBe(200);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.id, linkId),
    });
    expect(link?.itemId).toBe(spinachId);
    expect(link?.unitsPerCount).toBe('150.000');
  });

  it('rejects an item from another household', async () => {
    const otherId = await ctx.createHousehold();
    const [foreign] = await db
      .insert(inventoryItems)
      .values({ householdId: otherId, name: 'Foreign', defaultUnit: 'g' })
      .returning({ id: inventoryItems.id });

    const linkId = await seedLink('costco', 'code-patch-2', oilId);
    const res = await user.fetch(`/api/v1/receipts/links/${linkId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: foreign.id }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/receipts/links/:id', () => {
  it('forgets the mapping', async () => {
    const linkId = await seedLink('costco', 'code-delete-1', oilId);
    const res = await user.fetch(`/api/v1/receipts/links/${linkId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.id, linkId),
    });
    expect(link).toBeUndefined();
  });

  it('404s for a link in another household', async () => {
    const otherId = await ctx.createHousehold();
    const otherUser = await ctx.createUser(otherId);
    const linkId = await seedLink('costco', 'code-delete-2', oilId);

    const res = await otherUser.fetch(`/api/v1/receipts/links/${linkId}`, { method: 'DELETE' });
    expect(res.status).toBe(404);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.id, linkId),
    });
    expect(link).toBeDefined();
  });
});

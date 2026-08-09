import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  inventoryAreas,
  inventoryItems,
  inventoryStock,
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
} from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';
import {
  matchReceiptLine,
  buildLineKey,
  normalizeMerchant,
} from '../../src/modules/receipts/receipt-line-matcher.js';

/**
 * Cross-household isolation for the receipts routes. A receipt scan carries a
 * household's purchase history and its learned mappings — a leak here would
 * expose what another household buys and let an attacker inject stock into
 * their inventory or repoint their learned mappings.
 *
 * Every mutation below is attempted by household A against household B's
 * data and must 404 without side effects, paired with a positive control
 * proving the same call works within the caller's own household — a 404
 * that would also happen for the caller's own resource proves nothing.
 */

// A 1x1 JPEG, just enough to exercise the image route's transport layer.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

/**
 * Hand-build a multipart/form-data body with an explicit boundary, mirroring
 * `receipts.routes.test.ts`'s helper of the same name. `route-harness.ts`'s
 * `fetch` wrapper unconditionally injects `content-type: application/json`
 * whenever a body is present, which would collide with the boundary-bearing
 * content-type a multipart body needs. Setting 'content-type' explicitly
 * (same lowercase key the harness uses) lets this cleanly overwrite the
 * default instead of folding into a duplicate header.
 */
function buildMultipart(
  parts: Array<
    | { type: 'file'; name: string; filename: string; contentType: string; data: Buffer }
    | { type: 'field'; name: string; value: string }
  >
): { body: Buffer; contentType: string } {
  const boundary = `testBoundary${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.type === 'file') {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`
        )
      );
      chunks.push(part.data);
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`)
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

let ctx: RouteTestContext;
let userA: TestUser;
let userB: TestUser;

// Household B fixtures (the victim)
let bScanId: string;
let bLineId: string;
let bLinkId: string;
let bItemId: string;
let bAreaId: string;

// Household A fixtures (positive controls / the attacker's own)
let aScanId: string;
let aLineId: string;
let aItemId: string;
let aAreaId: string;
let aLinkId: string;

async function seedHousehold(user: TestUser) {
  const [area] = await db
    .insert(inventoryAreas)
    .values({ householdId: user.householdId, name: 'Pantry' })
    .returning({ id: inventoryAreas.id });

  const [item] = await db
    .insert(inventoryItems)
    .values({ householdId: user.householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });

  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId: user.householdId,
      scannedBy: user.id,
      merchant: 'Costco',
      defaultAreaId: area.id,
      status: 'review',
    })
    .returning({ id: receiptScans.id });

  const [line] = await db
    .insert(receiptScanLines)
    .values({
      scanId: scan.id,
      householdId: user.householdId,
      lineIndex: 0,
      rawText: '1234567 KS ORG EVOO',
      merchantCode: '1234567',
      count: '1.000',
    })
    .returning({ id: receiptScanLines.id });

  const [link] = await db
    .insert(receiptLineLinks)
    .values({
      householdId: user.householdId,
      merchant: 'costco',
      lineKey: `code-${user.householdId.slice(0, 8)}`,
      keyKind: 'code',
      itemId: item.id,
      unitsPerCount: '2000.000',
    })
    .returning({ id: receiptLineLinks.id });

  return { areaId: area.id, itemId: item.id, scanId: scan.id, lineId: line.id, linkId: link.id };
}

beforeAll(async () => {
  ctx = await setupRouteTest();

  const householdA = await ctx.createHousehold('A');
  const householdB = await ctx.createHousehold('B');
  userA = await ctx.createUser(householdA);
  userB = await ctx.createUser(householdB);

  const a = await seedHousehold(userA);
  aScanId = a.scanId;
  aLineId = a.lineId;
  aItemId = a.itemId;
  aAreaId = a.areaId;
  aLinkId = a.linkId;

  const b = await seedHousehold(userB);
  bScanId = b.scanId;
  bLineId = b.lineId;
  bLinkId = b.linkId;
  bItemId = b.itemId;
  bAreaId = b.areaId;

  // Give BOTH scans a real stored image. A's image backs its positive
  // control (and lets reprocess, which refuses without a stored image, be
  // exercised positively too). B's image is what makes the "cannot read
  // another household's image" test meaningful at all: the image route 404s
  // both when the scan belongs to another household AND when the scan has
  // no stored image (`receipts.routes.ts:196-200`, the "pruned by the
  // retention sweep" case) — with only A imaged, a broken household filter
  // would still 404 on B's scan via that second branch, and the test would
  // pass for the wrong reason. Imaging B too forces the 404 to be reachable
  // only through the tenancy check.
  const dir = join(tmpdir(), 'basis-receipt-tenancy-test');
  await mkdir(dir, { recursive: true });

  const aImagePath = join(dir, `${aScanId}.jpg`);
  await writeFile(aImagePath, TINY_JPEG);
  await db
    .update(receiptScans)
    .set({ imagePath: aImagePath, imageMimeType: 'image/jpeg' })
    .where(eq(receiptScans.id, aScanId));

  const bImagePath = join(dir, `${bScanId}.jpg`);
  await writeFile(bImagePath, TINY_JPEG);
  await db
    .update(receiptScans)
    .set({ imagePath: bImagePath, imageMimeType: 'image/jpeg' })
    .where(eq(receiptScans.id, bScanId));
});

afterAll(async () => {
  await ctx.close();
});

describe('receipts tenancy — reads', () => {
  it('cannot read another household\'s scan', async () => {
    expect((await userA.fetch(`/api/v1/receipts/scans/${bScanId}`)).status).toBe(404);
    expect((await userA.fetch(`/api/v1/receipts/scans/${aScanId}`)).status).toBe(200);
  });

  it('cannot read another household\'s scan status', async () => {
    expect((await userA.fetch(`/api/v1/receipts/scans/${bScanId}/status`)).status).toBe(404);
    expect((await userA.fetch(`/api/v1/receipts/scans/${aScanId}/status`)).status).toBe(200);
  });

  it('cannot read another household\'s receipt image', async () => {
    // B's scan has a real stored image (see beforeAll) specifically so this
    // 404 can only come from the tenancy check, not from the route's other
    // 404 branch (no image stored).
    expect((await userA.fetch(`/api/v1/receipts/scans/${bScanId}/image`)).status).toBe(404);
  });

  it('can read its own household\'s receipt image', async () => {
    // Positive control for the image route: a 404 above means nothing if the
    // route 404s for everyone, including the caller's own scan.
    const res = await userA.fetch(`/api/v1/receipts/scans/${aScanId}/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBe(TINY_JPEG.length);
  });

  it('never lists another household\'s scans', async () => {
    const res = await userA.fetch('/api/v1/receipts/scans');
    const body = await res.json();
    expect(body.data.scans.some((s: { id: string }) => s.id === bScanId)).toBe(false);
    // Positive control: the caller's own scan is not also swept out by the filter.
    expect(body.data.scans.some((s: { id: string }) => s.id === aScanId)).toBe(true);
  });

  it('never lists another household\'s links', async () => {
    const res = await userA.fetch('/api/v1/receipts/links');
    const body = await res.json();
    expect(body.data.links.some((l: { id: string }) => l.id === bLinkId)).toBe(false);
    expect(body.data.links.some((l: { id: string }) => l.id === aLinkId)).toBe(true);
  });
});

describe('receipts tenancy — mutations', () => {
  it('cannot edit another household\'s scan', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${bScanId}`, {
      method: 'PATCH',
      body: JSON.stringify({ merchant: 'Hacked' }),
    });
    expect(res.status).toBe(404);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, bScanId) });
    expect(scan?.merchant).toBe('Costco');

    // Positive control.
    expect(
      (
        await userA.fetch(`/api/v1/receipts/scans/${aScanId}`, {
          method: 'PATCH',
          body: JSON.stringify({ merchant: 'Safeway' }),
        })
      ).status
    ).toBe(200);
  });

  it('cannot edit another household\'s line', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${bScanId}/lines/${bLineId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolution: 'ignore' }),
    });
    expect(res.status).toBe(404);

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, bLineId),
    });
    expect(line?.resolution).toBe('unresolved');
  });

  it('cannot link a line to another household\'s item', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${aScanId}/lines/${aLineId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolution: 'link', itemId: bItemId, unitsPerCount: 1 }),
    });
    expect(res.status).toBe(404);

    // No side effect: the line must not have been left half-updated.
    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, aLineId),
    });
    expect(line?.itemId).not.toBe(bItemId);
  });

  it('cannot create an item against another household\'s line', async () => {
    const res = await userA.fetch(
      `/api/v1/receipts/scans/${bScanId}/lines/${bLineId}/create-item`,
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Injected', unitsPerCount: 1 }),
      }
    );
    expect(res.status).toBe(404);

    const injected = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.name, 'Injected'),
    });
    expect(injected).toBeUndefined();
  });

  it('cannot confirm another household\'s scan', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${bScanId}/confirm`, { method: 'POST' });
    expect(res.status).toBe(404);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, bScanId) });
    expect(scan?.status).toBe('review');
  });

  it('cannot reprocess another household\'s scan', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${bScanId}/reprocess`, { method: 'POST' });
    expect(res.status).toBe(404);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, bScanId) });
    expect(scan?.status).toBe('review');
  });

  it('can reprocess its own scan', async () => {
    // Positive control: without this, the 404 above could just as easily mean
    // "this route is broken for everyone" as "tenancy is enforced."
    const res = await userA.fetch(`/api/v1/receipts/scans/${aScanId}/reprocess`, { method: 'POST' });
    expect(res.status).toBe(200);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, aScanId) });
    expect(scan?.status).toBe('processing');
  });

  it('cannot delete another household\'s scan', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${bScanId}`, { method: 'DELETE' });
    expect(res.status).toBe(404);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, bScanId) });
    expect(scan).toBeDefined();
  });

  it('can delete its own scan', async () => {
    const [scan] = await db
      .insert(receiptScans)
      .values({
        householdId: userA.householdId,
        scannedBy: userA.id,
        merchant: 'Deletable',
        status: 'review',
      })
      .returning({ id: receiptScans.id });

    const res = await userA.fetch(`/api/v1/receipts/scans/${scan.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const gone = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scan.id) });
    expect(gone).toBeUndefined();
  });

  it('cannot repoint another household\'s link', async () => {
    const res = await userA.fetch(`/api/v1/receipts/links/${bLinkId}`, {
      method: 'PATCH',
      body: JSON.stringify({ itemId: aItemId }),
    });
    expect(res.status).toBe(404);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.id, bLinkId),
    });
    expect(link?.itemId).toBe(bItemId);
  });

  it('cannot forget another household\'s link', async () => {
    const res = await userA.fetch(`/api/v1/receipts/links/${bLinkId}`, { method: 'DELETE' });
    expect(res.status).toBe(404);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.id, bLinkId),
    });
    expect(link).toBeDefined();
  });

  it('cannot send a receipt into another household\'s storage area', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${aScanId}/lines/${aLineId}`, {
      method: 'PATCH',
      body: JSON.stringify({ targetAreaId: bAreaId }),
    });
    expect(res.status).toBe(404);

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, aLineId),
    });
    expect(line?.targetAreaId).not.toBe(bAreaId);

    // Positive control with the caller's own area.
    expect(
      (
        await userA.fetch(`/api/v1/receipts/scans/${aScanId}/lines/${aLineId}`, {
          method: 'PATCH',
          body: JSON.stringify({ targetAreaId: aAreaId }),
        })
      ).status
    ).toBe(200);
  });
});

describe('receipts tenancy — body-level foreign ids on the caller\'s own resources', () => {
  // Every case above attacks a URL id belonging to household B. These attack
  // a *body* id while the URL id (scan, line, link) legitimately belongs to
  // the caller — the more easily missed variant, since a route that only
  // checks the URL id would let this through.

  it('cannot repoint its own link at another household\'s item', async () => {
    const res = await userA.fetch(`/api/v1/receipts/links/${aLinkId}`, {
      method: 'PATCH',
      body: JSON.stringify({ itemId: bItemId }),
    });
    expect(res.status).toBe(404);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.id, aLinkId),
    });
    expect(link?.itemId).toBe(aItemId);

    // Positive control: repointing at the caller's own item works.
    const [secondItem] = await db
      .insert(inventoryItems)
      .values({ householdId: userA.householdId, name: 'Second A Item', defaultUnit: 'g' })
      .returning({ id: inventoryItems.id });

    const own = await userA.fetch(`/api/v1/receipts/links/${aLinkId}`, {
      method: 'PATCH',
      body: JSON.stringify({ itemId: secondItem.id, unitsPerCount: 500 }),
    });
    expect(own.status).toBe(200);

    const updated = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.id, aLinkId),
    });
    expect(updated?.itemId).toBe(secondItem.id);
  });

  it('cannot set defaultAreaId to another household\'s area on its own scan', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${aScanId}`, {
      method: 'PATCH',
      body: JSON.stringify({ defaultAreaId: bAreaId }),
    });
    expect(res.status).toBe(404);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, aScanId) });
    expect(scan?.defaultAreaId).not.toBe(bAreaId);

    // Positive control with the caller's own area.
    const own = await userA.fetch(`/api/v1/receipts/scans/${aScanId}`, {
      method: 'PATCH',
      body: JSON.stringify({ defaultAreaId: aAreaId }),
    });
    expect(own.status).toBe(200);
  });

  it('cannot create an item with another household\'s defaultAreaId, even on its own line', async () => {
    const [freshLine] = await db
      .insert(receiptScanLines)
      .values({
        scanId: aScanId,
        householdId: userA.householdId,
        lineIndex: 500,
        rawText: 'FRESH LINE FOR CREATE-ITEM AREA GAP',
        count: '1.000',
      })
      .returning({ id: receiptScanLines.id });

    const res = await userA.fetch(
      `/api/v1/receipts/scans/${aScanId}/lines/${freshLine.id}/create-item`,
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Injected Via Body', unitsPerCount: 1, defaultAreaId: bAreaId }),
      }
    );
    expect(res.status).toBe(404);

    const injected = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.name, 'Injected Via Body'),
    });
    expect(injected).toBeUndefined();

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, freshLine.id),
    });
    expect(line?.resolution).toBe('unresolved');
    expect(line?.itemId).toBeNull();

    // Positive control: the same call succeeds with the caller's own area.
    const own = await userA.fetch(
      `/api/v1/receipts/scans/${aScanId}/lines/${freshLine.id}/create-item`,
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Legit New Item', unitsPerCount: 1, defaultAreaId: aAreaId }),
      }
    );
    expect(own.status).toBe(200);

    const legit = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.name, 'Legit New Item'),
    });
    expect(legit?.defaultAreaId).toBe(aAreaId);
  });
});

describe('receipts tenancy — carried-forward gap: item.defaultAreaId at confirm', () => {
  // Confirm resolves a line's storage area as
  // targetAreaId -> item.defaultAreaId -> scan.defaultAreaId, and verifies
  // whichever one wins against the household. Only the targetAreaId path had
  // a test before this task. The item.defaultAreaId path is more dangerous:
  // a foreign area can enter without the caller ever naming it in the
  // request, purely because the linked item's own defaultAreaId (set at some
  // earlier time, possibly by data drift or a bug elsewhere) points at
  // another household's area.
  it('refuses to confirm a line whose linked item defaults to another household\'s area', async () => {
    const [foreignDefaultItem] = await db
      .insert(inventoryItems)
      .values({
        householdId: userA.householdId,
        name: 'Foreign Default Area Item',
        defaultUnit: 'g',
        defaultAreaId: bAreaId, // household A's item, pointed at household B's area
      })
      .returning({ id: inventoryItems.id });

    const [gapScan] = await db
      .insert(receiptScans)
      .values({
        householdId: userA.householdId,
        scannedBy: userA.id,
        merchant: 'Gap Test Store',
        status: 'review',
        // No scan-level defaultAreaId — nothing but the item's own default
        // area is available to resolve this line's area.
        defaultAreaId: null,
      })
      .returning({ id: receiptScans.id });

    await db.insert(receiptScanLines).values({
      scanId: gapScan.id,
      householdId: userA.householdId,
      lineIndex: 0,
      rawText: 'FOREIGN DEFAULT AREA LINE',
      count: '1.000',
      resolution: 'link',
      itemId: foreignDefaultItem.id,
      unitsPerCount: '1.000',
      targetAreaId: null,
    });

    const res = await userA.fetch(`/api/v1/receipts/scans/${gapScan.id}/confirm`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);

    // `confirmScan` has five distinct 400 paths (unresolved lines, blank
    // merchant, missing item/conversion, item no longer exists, no storage
    // area) — asserting only the status code would still pass if this
    // fixture regressed to fail for an unrelated reason. Naming the reason
    // pins this test to the one check that matters: the resolved area was
    // rejected for belonging to another household.
    const body = await res.json();
    expect(body.error.details.lines).toHaveLength(1);
    expect(body.error.details.lines[0].reason).toBe(
      'resolved storage area does not belong to this household'
    );

    // No side effects anywhere: no stock for this item, scan still in review.
    const stock = await db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.itemId, foreignDefaultItem.id));
    expect(stock).toHaveLength(0);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, gapScan.id) });
    expect(scan?.status).toBe('review');
  });
});

describe('receipts tenancy — carried-forward gap: matcher fails closed on a foreign link', () => {
  // If a receipt_line_links row ever pointed at an item outside its own
  // household — never producible through the routes, since both confirmScan
  // and the /links PATCH verify itemId against the household, but a fail-safe
  // in case of data drift, a bug elsewhere, or a direct DB write — the
  // matcher must not resolve it. It should fall through to alias/fuzzy
  // matching instead of returning a link with a foreign (or null) item. This
  // was previously verified only by inspection; this test exercises it.
  it('falls through to unresolved instead of returning a link whose item is foreign', async () => {
    const merchant = 'gap-store';
    const merchantCode = '9999999';
    const rawText = 'GAP STORE PRODUCT LINE';
    const { lineKey, keyKind } = buildLineKey(merchantCode, rawText);

    // A code-keyed link is always "trusted" (no OCR-confidence gate) — the
    // strongest case that the household filter, not the trust check, is what
    // stops this from resolving.
    expect(keyKind).toBe('code');

    await db.insert(receiptLineLinks).values({
      householdId: userA.householdId,
      merchant: normalizeMerchant(merchant),
      lineKey,
      keyKind,
      itemId: bItemId, // foreign: belongs to household B
      unitsPerCount: '1.000',
    });

    const result = await matchReceiptLine(
      { rawText, merchantCode, merchant, ocrConfidence: null },
      userA.householdId
    );

    expect(result.resolution).toBe('unresolved');
    expect(result.itemId).toBeNull();
    expect(result.suggestions.some((s) => s.itemId === bItemId)).toBe(false);
  });
});

describe('receipts tenancy — confirm sanity control', () => {
  // A clean, fully-resolved scan confirmed end to end within a single
  // household. Without this, every "cannot confirm another household's scan"
  // 404 above would be consistent with confirm being completely broken for
  // everyone, not just correctly tenancy-scoped.
  it('confirms a fully-resolved scan and writes stock only for the caller\'s own household', async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ householdId: userA.householdId, name: 'Confirm Sanity Item', defaultUnit: 'g' })
      .returning({ id: inventoryItems.id });

    const [scan] = await db
      .insert(receiptScans)
      .values({
        householdId: userA.householdId,
        scannedBy: userA.id,
        merchant: 'Confirm Sanity Store',
        status: 'review',
      })
      .returning({ id: receiptScans.id });

    await db.insert(receiptScanLines).values({
      scanId: scan.id,
      householdId: userA.householdId,
      lineIndex: 0,
      rawText: 'CONFIRM SANITY LINE',
      count: '1.000',
      resolution: 'link',
      itemId: item.id,
      unitsPerCount: '1.000',
      targetAreaId: aAreaId,
    });

    const res = await userA.fetch(`/api/v1/receipts/scans/${scan.id}/confirm`, { method: 'POST' });
    expect(res.status).toBe(200);

    const stock = await db.select().from(inventoryStock).where(eq(inventoryStock.itemId, item.id));
    expect(stock).toHaveLength(1);
    expect(stock[0].areaId).toBe(aAreaId);

    const confirmed = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scan.id) });
    expect(confirmed?.status).toBe('confirmed');
  });
});

describe('receipts tenancy — POST /scans', () => {
  // The one remaining foreign-id acceptance point nothing else in this file
  // attacks: the initial upload takes an optional defaultAreaId field,
  // validated against the caller's household at receipts.routes.ts:118-125.
  it('404s on a defaultAreaId from another household and creates no scan row', async () => {
    const before = await db
      .select({ id: receiptScans.id })
      .from(receiptScans)
      .where(eq(receiptScans.householdId, userA.householdId));

    const { body, contentType } = buildMultipart([
      {
        type: 'file',
        name: 'file',
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
        data: Buffer.from('fake-receipt-bytes'),
      },
      { type: 'field', name: 'defaultAreaId', value: bAreaId },
    ]);

    const res = await userA.fetch('/api/v1/receipts/scans', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(res.status).toBe(404);

    // No side effect: not even an orphan scan row with a null/foreign area.
    const after = await db
      .select({ id: receiptScans.id })
      .from(receiptScans)
      .where(eq(receiptScans.householdId, userA.householdId));
    expect(after).toHaveLength(before.length);

    // Positive control: the same upload succeeds with the caller's own area.
    const { body: ownBody, contentType: ownContentType } = buildMultipart([
      {
        type: 'file',
        name: 'file',
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
        data: Buffer.from('fake-receipt-bytes'),
      },
      { type: 'field', name: 'defaultAreaId', value: aAreaId },
    ]);

    const own = await userA.fetch('/api/v1/receipts/scans', {
      method: 'POST',
      headers: { 'content-type': ownContentType },
      body: ownBody,
    });
    expect(own.status).toBe(200);

    const ownResBody = await own.json();
    const created = await db.query.receiptScans.findFirst({
      where: eq(receiptScans.id, ownResBody.data.id),
    });
    expect(created?.householdId).toBe(userA.householdId);
    expect(created?.defaultAreaId).toBe(aAreaId);
  });
});

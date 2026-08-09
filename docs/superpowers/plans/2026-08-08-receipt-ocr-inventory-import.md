# Receipt OCR → Inventory Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photograph a grocery receipt and turn it into inventory stock, with each receipt line's mapping to a catalog item learned once and reused on every future scan.

**Architecture:** A new `receipts` backend module owns the scan lifecycle. Tesseract (WASM, in-process) transcribes the image; a direct Ollama call structures the raw text into lines; each line is resolved against learned links, then aliases, then the existing fuzzy matcher. A review UI forces every line to be resolved before confirm writes stock in one transaction and upserts the learned links.

**Tech Stack:** Fastify + TypeScript, Drizzle ORM (PostgreSQL), BullMQ + Redis, `tesseract.js`, Ollama (`OLLAMA_LLM_MODEL`, default `qwen2.5:7b`), React + Vite + TanStack Query, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-08-receipt-ocr-inventory-import-design.md`

## Global Constraints

- Every query filters by `householdId` from `request.user!.householdId`, and every caller-supplied id is verified to belong to that household. This is the primary guard; RLS is a backstop.
- All three new tables are household-scoped and MUST get RLS policies following `drizzle/0008_rls_all_tables.sql`, plus a check in `backend/test/rls/`.
- New routes MUST get a tenancy test following `backend/test/inventory/tenancy.test.ts`.
- `drizzle-kit generate` is broken in this repo (ESM `.js` specifiers). Migrations, `_journal.json` entries, and snapshots are hand-authored.
- All routes are prefixed `/api/v1/` and registered in `backend/src/app.ts` inside the `apiScope`.
- Both workspaces use the `@/*` → `./src/*` path alias. Backend imports use explicit `.js` extensions.
- Decimal columns come back from Drizzle as **strings**. Never do float math on them directly — use the `multiplyQuantity` helper from Task 3.
- The frontend has **no test infrastructure** (no vitest, no testing-library). Frontend tasks verify with `npm run typecheck`, `npm run lint`, and a Playwright walkthrough — do not invent component tests.
- Commit after every task. Work on branch `receipt-ocr-import` (already created; the spec is committed there as `fd742c8`).

## Phases

- **Phase 1 — Data + pure logic (Tasks 1–3):** schema, normalizer, matcher. No I/O beyond the DB.
- **Phase 2 — Parsing pipeline (Tasks 4–6):** Tesseract, Ollama structuring, worker.
- **Phase 3 — API (Tasks 7–10):** routes, confirm, links management, cleanup.
- **Phase 4 — Frontend (Tasks 11–13).**
- **Phase 5 — Isolation tests (Task 14).**

Phases 1–3 plus 14 are a working, testable deliverable on their own (a complete API with no UI). If you want to split this into two plans, cut between Task 10 and Task 11.

## File Structure

**Backend — created:**

| File | Responsibility |
|---|---|
| `src/db/schema/receipts.ts` | The three tables, two enums, inferred types |
| `drizzle/0010_receipt_scanning.sql` | Drop old table/enum, create new schema, RLS policies |
| `src/modules/receipts/receipt-line-normalizer.ts` | Pure text cleanup: strip noise, expand abbreviations |
| `src/modules/receipts/receipt-line-matcher.ts` | Link → alias → fuzzy resolution for one line |
| `src/modules/receipts/receipt-ocr.ts` | Tesseract transcription |
| `src/modules/receipts/receipt-structurer.ts` | Ollama raw-text → structured lines |
| `src/modules/receipts/receipts.service.ts` | Scan lifecycle: create, process, update, confirm |
| `src/modules/receipts/receipts.schemas.ts` | Zod request/response schemas |
| `src/modules/receipts/receipts.routes.ts` | HTTP surface |
| `src/jobs/receipts.worker.ts` | BullMQ job entry |

**Backend — modified:** `src/db/schema/inventory.ts` (remove dead table), `src/db/schema/index.ts`, `src/app.ts`, `src/jobs/index.ts`, `src/config/index.ts`, `src/jobs/cleanup.worker.ts`.

**Frontend — created:** `src/api/receipts.ts`, `src/pages/inventory/ReceiptScanPage.tsx`, `src/pages/inventory/ReceiptsPage.tsx`, `src/components/inventory/ReceiptUploadDialog.tsx`, `src/components/inventory/ReceiptLineRow.tsx`, `src/components/inventory/ReceiptLinkManager.tsx`.

**Frontend — modified:** `src/App.tsx`, `src/pages/inventory/InventoryPage.tsx`, `src/types/models.ts`.

---

### Task 1: Schema and migration

**Files:**
- Create: `backend/src/db/schema/receipts.ts`
- Create: `backend/drizzle/0010_receipt_scanning.sql`
- Create: `backend/drizzle/meta/0010_snapshot.json` (copied and edited)
- Modify: `backend/drizzle/meta/_journal.json`
- Modify: `backend/src/db/schema/inventory.ts` — delete `receiptScans`, `ParsedReceiptItem`, `ShoppingListSnapshot`, `receiptScanStatusEnum` (lines 59–64 and 227–259)
- Modify: `backend/src/db/schema/index.ts` — export the new module
- Test: `backend/test/rls/receipts-policies.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `receiptScans`, `receiptScanLines`, `receiptLineLinks` tables; `receiptScanStatusEnum`, `receiptLineResolutionEnum`; types `ReceiptScan`, `ReceiptScanLine`, `ReceiptLineLink` (all `$inferSelect`).

- [ ] **Step 1: Write the schema module**

Create `backend/src/db/schema/receipts.ts`:

```ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  decimal,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';
import { inventoryItems, inventoryAreas } from './inventory.js';

export const receiptScanStatusEnum = pgEnum('receipt_scan_status', [
  'processing',
  'review',
  'confirmed',
  'cancelled',
  'failed',
]);

export const receiptLineResolutionEnum = pgEnum('receipt_line_resolution', [
  'unresolved',
  'link',
  'ignore',
]);

/** One scanned receipt image and its parse state. */
export const receiptScans = pgTable('receipt_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  scannedBy: uuid('scanned_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  imagePath: text('image_path'),
  imageMimeType: varchar('image_mime_type', { length: 50 }),
  // Extracted by the LLM, editable by the user. Required (non-blank) at confirm
  // because it is half of every learned link's key.
  merchant: varchar('merchant', { length: 120 }),
  purchasedAt: timestamp('purchased_at'),
  rawOcrText: text('raw_ocr_text'),
  status: receiptScanStatusEnum('status').notNull().default('processing'),
  // 'queued' | 'ocr' | 'structuring' | 'matching' | 'done'
  processingStage: varchar('processing_stage', { length: 20 }).default('queued'),
  parseWarnings: jsonb('parse_warnings').$type<string[]>().notNull().default([]),
  errorMessage: text('error_message'),
  defaultAreaId: uuid('default_area_id').references(() => inventoryAreas.id, {
    onDelete: 'set null',
  }),
  processingTimeMs: integer('processing_time_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
}, (table) => ({
  householdIdx: index('receipt_scans_household_idx').on(table.householdId),
}));

/** One line off the receipt, plus the user's review decision. */
export const receiptScanLines = pgTable('receipt_scan_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  scanId: uuid('scan_id')
    .notNull()
    .references(() => receiptScans.id, { onDelete: 'cascade' }),
  // Denormalized so RLS can police this table directly.
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  lineIndex: integer('line_index').notNull(),
  rawText: varchar('raw_text', { length: 500 }).notNull(),
  // Costco prints an item number; most merchants do not.
  merchantCode: varchar('merchant_code', { length: 64 }),
  // Unitless package count. Decimal because some merchants price by weight.
  count: decimal('count', { precision: 10, scale: 3 }).notNull().default('1'),
  price: decimal('price', { precision: 10, scale: 2 }),
  ocrConfidence: decimal('ocr_confidence', { precision: 5, scale: 4 }),
  resolution: receiptLineResolutionEnum('resolution').notNull().default('unresolved'),
  itemId: uuid('item_id').references(() => inventoryItems.id, { onDelete: 'set null' }),
  // The one-time conversion: stock quantity = count * unitsPerCount, in the
  // item's defaultUnit.
  unitsPerCount: decimal('units_per_count', { precision: 10, scale: 3 }),
  targetAreaId: uuid('target_area_id').references(() => inventoryAreas.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  scanIdx: index('receipt_scan_lines_scan_idx').on(table.scanId),
  householdIdx: index('receipt_scan_lines_household_idx').on(table.householdId),
}));

/** The learned mapping. This is the feature. */
export const receiptLineLinks = pgTable('receipt_line_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  merchant: varchar('merchant', { length: 120 }).notNull(),
  // merchantCode when the receipt printed one, else the normalized raw text.
  lineKey: varchar('line_key', { length: 500 }).notNull(),
  keyKind: varchar('key_kind', { length: 8 }).notNull(), // 'code' | 'text'
  itemId: uuid('item_id')
    .notNull()
    .references(() => inventoryItems.id, { onDelete: 'cascade' }),
  unitsPerCount: decimal('units_per_count', { precision: 10, scale: 3 }).notNull(),
  useCount: integer('use_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueKeyPerHousehold: uniqueIndex('receipt_line_links_household_merchant_key_idx')
    .on(table.householdId, table.merchant, table.lineKey),
}));

export type ReceiptScan = typeof receiptScans.$inferSelect;
export type NewReceiptScan = typeof receiptScans.$inferInsert;
export type ReceiptScanLine = typeof receiptScanLines.$inferSelect;
export type NewReceiptScanLine = typeof receiptScanLines.$inferInsert;
export type ReceiptLineLink = typeof receiptLineLinks.$inferSelect;
export type ReceiptScanStatus = 'processing' | 'review' | 'confirmed' | 'cancelled' | 'failed';
export type ReceiptLineResolution = 'unresolved' | 'link' | 'ignore';
export type ReceiptProcessingStage = 'queued' | 'ocr' | 'structuring' | 'matching' | 'done';
```

- [ ] **Step 2: Remove the dead table from the inventory schema**

In `backend/src/db/schema/inventory.ts`, delete `receiptScanStatusEnum` (lines 59–64), the `receiptScans` table with its `// Receipt Scans` banner comment (lines 223–242), and the now-orphaned `ParsedReceiptItem` (244–252) and `ShoppingListSnapshot` (254–259) interfaces. Then add the export to `backend/src/db/schema/index.ts` alongside the others:

```ts
export * from './receipts.js';
```

- [ ] **Step 3: Confirm nothing else referenced the dead table**

Run: `cd backend && grep -rn "receiptScans\|ParsedReceiptItem\|ShoppingListSnapshot\|receiptScanStatusEnum" src/ | grep -v "db/schema/receipts.ts"`
Expected: no output. (It was schema-only — this is the proof.)

- [ ] **Step 4: Write the migration**

Create `backend/drizzle/0010_receipt_scanning.sql`. Order matters: dropping a table does not drop its enum type, and the existing `receipt_scan_status` has different values.

```sql
-- Receipt OCR → inventory import.
--
-- Drops the dead receipt_scans table (schema-only since 0000, flagged for
-- deletion in 0008) and replaces it with a three-table design: scans, per-line
-- rows with review state, and the learned (merchant, line_key) → item mapping.

DROP TABLE IF EXISTS "receipt_scans";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."receipt_scan_status";--> statement-breakpoint

CREATE TYPE "public"."receipt_scan_status" AS ENUM('processing', 'review', 'confirmed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."receipt_line_resolution" AS ENUM('unresolved', 'link', 'ignore');--> statement-breakpoint

CREATE TABLE "receipt_scans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "scanned_by" uuid NOT NULL,
  "image_path" text,
  "image_mime_type" varchar(50),
  "merchant" varchar(120),
  "purchased_at" timestamp,
  "raw_ocr_text" text,
  "status" "receipt_scan_status" DEFAULT 'processing' NOT NULL,
  "processing_stage" varchar(20) DEFAULT 'queued',
  "parse_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error_message" text,
  "default_area_id" uuid,
  "processing_time_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "confirmed_at" timestamp
);--> statement-breakpoint

CREATE TABLE "receipt_scan_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scan_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "line_index" integer NOT NULL,
  "raw_text" varchar(500) NOT NULL,
  "merchant_code" varchar(64),
  "count" numeric(10, 3) DEFAULT '1' NOT NULL,
  "price" numeric(10, 2),
  "ocr_confidence" numeric(5, 4),
  "resolution" "receipt_line_resolution" DEFAULT 'unresolved' NOT NULL,
  "item_id" uuid,
  "units_per_count" numeric(10, 3),
  "target_area_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "receipt_line_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "merchant" varchar(120) NOT NULL,
  "line_key" varchar(500) NOT NULL,
  "key_kind" varchar(8) NOT NULL,
  "item_id" uuid NOT NULL,
  "units_per_count" numeric(10, 3) NOT NULL,
  "use_count" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_default_area_id_inventory_areas_id_fk" FOREIGN KEY ("default_area_id") REFERENCES "public"."inventory_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scan_lines" ADD CONSTRAINT "receipt_scan_lines_scan_id_receipt_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."receipt_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scan_lines" ADD CONSTRAINT "receipt_scan_lines_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scan_lines" ADD CONSTRAINT "receipt_scan_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scan_lines" ADD CONSTRAINT "receipt_scan_lines_target_area_id_inventory_areas_id_fk" FOREIGN KEY ("target_area_id") REFERENCES "public"."inventory_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_line_links" ADD CONSTRAINT "receipt_line_links_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_line_links" ADD CONSTRAINT "receipt_line_links_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "receipt_scans_household_idx" ON "receipt_scans" ("household_id");--> statement-breakpoint
CREATE INDEX "receipt_scan_lines_scan_idx" ON "receipt_scan_lines" ("scan_id");--> statement-breakpoint
CREATE INDEX "receipt_scan_lines_household_idx" ON "receipt_scan_lines" ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_line_links_household_merchant_key_idx" ON "receipt_line_links" ("household_id", "merchant", "line_key");--> statement-breakpoint

-- RLS: all three are household-scoped. Same shape as 0008.
ALTER TABLE "receipt_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receipt_scans_household ON receipt_scans
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "receipt_scan_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receipt_scan_lines_household ON receipt_scan_lines
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "receipt_line_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receipt_line_links_household ON receipt_line_links
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "receipt_scans" TO basis_rls;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "receipt_scan_lines" TO basis_rls;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "receipt_line_links" TO basis_rls;
```

Before writing the `GRANT` lines, run `grep -n "GRANT" drizzle/0008_rls_all_tables.sql | head -5` and match whatever form that file uses — if it grants via a blanket `ALTER DEFAULT PRIVILEGES` or a schema-wide grant, drop these three lines instead of duplicating the mechanism.

- [ ] **Step 5: Add the journal entry and snapshot**

Append to `backend/drizzle/meta/_journal.json`'s `entries` array:

```json
{
  "idx": 10,
  "version": "7",
  "when": 1786000000000,
  "tag": "0010_receipt_scanning",
  "breakpoints": true
}
```

Then `cp drizzle/meta/0009_snapshot.json drizzle/meta/0010_snapshot.json` and edit the copy:
- `"id"` → `"0a1b2c3d-0010-4010-8010-000000000010"` (continues the file's synthetic pattern)
- `"prevId"` → `"0a1b2c3d-0009-4009-8009-000000000009"`
- Delete the `public.receipt_scans` entry under `tables` and re-add all three tables matching the SQL above
- Under `enums`, replace `public.receipt_scan_status`'s values with the five new ones and add `public.receipt_line_resolution`

- [ ] **Step 6: Apply and verify the migration**

Run: `cd backend && npm run db:migrate && ./../dev.sh db -c "\d receipt_line_links"`
Expected: the three tables exist with the unique index; `\d receipt_scans` shows the five-value status enum.

- [ ] **Step 7: Write the RLS test**

Create `backend/test/rls/receipts-policies.test.ts`, following `inventory-policies.test.ts` — the `asHousehold` helper below is copied from it verbatim:

```ts
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../src/config/database.js';
import {
  households,
  users,
  inventoryItems,
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
} from '../../src/db/schema/index.js';

/**
 * RLS backstop for the receipts tables. These queries run as basis_rls (RLS
 * applies); fixtures are created as the owner (RLS bypassed). A leak here
 * exposes another household's purchase history.
 */

const hhA = randomUUID();
const hhB = randomUUID();
const userB = randomUUID();
let bScanId: string;
let bLineId: string;
let bLinkId: string;
let bItemId: string;

/** Run fn with basis_rls role + household context, transaction-locally. */
function asHousehold<T>(householdId: string, fn: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE basis_rls`;
    await tx.unsafe(`SET LOCAL app.household_id = '${householdId}'`);
    return fn(tx as unknown as typeof sql);
  }) as Promise<T>;
}

beforeAll(async () => {
  await db.insert(households).values([
    { id: hhA, name: `RLS Receipts A ${hhA.slice(0, 8)}` },
    { id: hhB, name: `RLS Receipts B ${hhB.slice(0, 8)}` },
  ]);
  await db.insert(users).values({
    id: userB,
    householdId: hhB,
    email: `${userB}@test.local`,
    name: 'B Scanner',
    passwordHash: 'x',
    role: 'admin',
  });

  const [bItem] = await db
    .insert(inventoryItems)
    .values({ householdId: hhB, name: 'B Secret Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  bItemId = bItem.id;

  const [bScan] = await db
    .insert(receiptScans)
    .values({ householdId: hhB, scannedBy: userB, merchant: 'Costco', status: 'review' })
    .returning({ id: receiptScans.id });
  bScanId = bScan.id;

  const [bLine] = await db
    .insert(receiptScanLines)
    .values({
      scanId: bScanId,
      householdId: hhB,
      lineIndex: 0,
      rawText: 'B SECRET PURCHASE',
      count: '1.000',
    })
    .returning({ id: receiptScanLines.id });
  bLineId = bLine.id;

  const [bLink] = await db
    .insert(receiptLineLinks)
    .values({
      householdId: hhB,
      merchant: 'costco',
      lineKey: 'b-secret-code',
      keyKind: 'code',
      itemId: bItemId,
      unitsPerCount: '2000.000',
    })
    .returning({ id: receiptLineLinks.id });
  bLinkId = bLink.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, hhA));
  await db.delete(households).where(eq(households.id, hhB));
});

describe('receipts RLS policies', () => {
  it("hides another household's scans", async () => {
    const rows = await asHousehold(hhA, (tx) =>
      tx`SELECT id FROM receipt_scans WHERE id = ${bScanId}`
    );
    expect(rows).toHaveLength(0);
  });

  it("shows a household its own scans", async () => {
    const rows = await asHousehold(hhB, (tx) =>
      tx`SELECT id FROM receipt_scans WHERE id = ${bScanId}`
    );
    expect(rows).toHaveLength(1);
  });

  it("hides another household's scan lines", async () => {
    const rows = await asHousehold(hhA, (tx) =>
      tx`SELECT id FROM receipt_scan_lines WHERE id = ${bLineId}`
    );
    expect(rows).toHaveLength(0);
  });

  it("hides another household's learned links", async () => {
    const rows = await asHousehold(hhA, (tx) =>
      tx`SELECT id FROM receipt_line_links WHERE id = ${bLinkId}`
    );
    expect(rows).toHaveLength(0);
  });

  it('refuses an update that would reach across households', async () => {
    await asHousehold(hhA, (tx) =>
      tx`UPDATE receipt_scans SET merchant = 'Hacked' WHERE id = ${bScanId}`
    );
    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, bScanId) });
    expect(scan?.merchant).toBe('Costco');
  });

  it('refuses an insert stamped with another household id', async () => {
    await expect(
      asHousehold(hhA, (tx) =>
        tx`INSERT INTO receipt_line_links
             (household_id, merchant, line_key, key_kind, item_id, units_per_count)
           VALUES (${hhB}, 'costco', 'injected', 'code', ${bItemId}, 1)`
      )
    ).rejects.toThrow();
  });
});
```

Match the `users` insert columns to what `test/helpers/route-harness.ts` uses rather than the placeholder above.

- [ ] **Step 8: Run the RLS test**

Run: `cd backend && npx vitest run test/rls/receipts-policies.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Typecheck and commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/db/schema/receipts.ts backend/src/db/schema/inventory.ts \
  backend/src/db/schema/index.ts backend/drizzle/0010_receipt_scanning.sql \
  backend/drizzle/meta/ backend/test/rls/receipts-policies.test.ts
git commit -m "feat(receipts): schema for receipt scans, lines, and learned links

Drops the dead receipt_scans table and replaces it with per-line rows plus a
(merchant, line_key) -> item mapping. RLS policies on all three."
```

---

### Task 2: Receipt line normalizer

**Files:**
- Create: `backend/src/modules/receipts/receipt-line-normalizer.ts`
- Test: `backend/test/receipts/receipt-line-normalizer.test.ts`

**Interfaces:**
- Consumes: `normalizeIngredientName` from `src/modules/recipes/ingredient-matching.service.js`.
- Produces:
  - `stripLineNoise(rawText: string): { text: string; code: string | null }`
  - `expandAbbreviations(text: string): string`
  - `normalizeReceiptLine(rawText: string): string`

Why this exists: `KS ORG EVOO` scores near zero against `olive oil` in the existing fuzzy matcher. This runs first.

- [ ] **Step 1: Write the failing test**

Create `backend/test/receipts/receipt-line-normalizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  stripLineNoise,
  expandAbbreviations,
  normalizeReceiptLine,
} from '../../src/modules/receipts/receipt-line-normalizer.js';

describe('stripLineNoise', () => {
  it('pulls a leading Costco item number off the line', () => {
    expect(stripLineNoise('1234567 KS ORG EVOO')).toEqual({
      text: 'KS ORG EVOO',
      code: '1234567',
    });
  });

  it('returns a null code when the merchant prints none', () => {
    expect(stripLineNoise('ORGANIC SPINACH')).toEqual({
      text: 'ORGANIC SPINACH',
      code: null,
    });
  });

  it('strips a trailing tax flag', () => {
    expect(stripLineNoise('1234567 KS ORG EVOO A').text).toBe('KS ORG EVOO');
    expect(stripLineNoise('BANANAS E').text).toBe('BANANAS');
  });

  it('does not mistake a short numeric run for an item code', () => {
    // "2%" milk and similar must survive; codes are 5+ digits.
    expect(stripLineNoise('2% MILK GALLON')).toEqual({
      text: '2% MILK GALLON',
      code: null,
    });
  });

  it('collapses repeated whitespace', () => {
    expect(stripLineNoise('KS   ORG    EVOO').text).toBe('KS ORG EVOO');
  });
});

describe('expandAbbreviations', () => {
  it('expands a known brand prefix', () => {
    expect(expandAbbreviations('KS ORG EVOO')).toBe(
      'kirkland signature organic extra virgin olive oil'
    );
  });

  it('expands mid-line tokens', () => {
    expect(expandAbbreviations('ORG CHKN BRST')).toBe('organic chicken breast');
  });

  it('leaves unknown tokens alone', () => {
    expect(expandAbbreviations('BANANAS')).toBe('bananas');
  });

  it('only matches whole tokens', () => {
    // "ORGY" must not become "organicY".
    expect(expandAbbreviations('ORGY')).toBe('orgy');
  });
});

describe('normalizeReceiptLine', () => {
  it('turns a raw Costco line into something the matcher can score', () => {
    expect(normalizeReceiptLine('1234567 KS ORG EVOO A')).toBe(
      'kirkland signature extra virgin olive oil'
    );
  });

  it('is stable across the same line read twice', () => {
    const a = normalizeReceiptLine('96253 ORG SPNCH  5OZ E');
    const b = normalizeReceiptLine('96253 ORG SPNCH 5OZ E');
    expect(a).toBe(b);
  });

  it('never returns an empty string for a non-empty line', () => {
    expect(normalizeReceiptLine('1234567 A').length).toBeGreaterThan(0);
  });
});
```

Note the expected value in the first `normalizeReceiptLine` case: `normalizeIngredientName` strips the descriptor word `organic`, so the final output differs from `expandAbbreviations` alone. That is intended — the link key must match what the fuzzy matcher sees.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipt-line-normalizer.test.ts`
Expected: FAIL — cannot find module `receipt-line-normalizer.js`.

- [ ] **Step 3: Implement the normalizer**

Create `backend/src/modules/receipts/receipt-line-normalizer.ts`:

```ts
import { normalizeIngredientName } from '../recipes/ingredient-matching.service.js';

/**
 * Receipt descriptions are abbreviated past the point where the ingredient
 * matcher can score them ("KS ORG EVOO" vs "olive oil"). This module cleans a
 * raw line into something matchable, and is also what produces the text form
 * of a learned link's key — so it must be deterministic.
 */

/** Item codes are long numeric runs. Five digits avoids eating "2%" or "5OZ". */
const ITEM_CODE_PATTERN = /^(\d{5,})\s+/;

/** Costco prints a single-letter tax flag at the end of most lines. */
const TAX_FLAG_PATTERN = /\s+[AEFNTX]$/;

const ABBREVIATIONS: Record<string, string> = {
  ks: 'kirkland signature',
  kb: 'kirkland signature',
  org: 'organic',
  orgnc: 'organic',
  evoo: 'extra virgin olive oil',
  chkn: 'chicken',
  chk: 'chicken',
  brst: 'breast',
  bnls: 'boneless',
  sknls: 'skinless',
  grnd: 'ground',
  bf: 'beef',
  prk: 'pork',
  spnch: 'spinach',
  bntr: 'butter',
  chdr: 'cheddar',
  chz: 'cheese',
  mzrlla: 'mozzarella',
  yog: 'yogurt',
  ygrt: 'yogurt',
  crm: 'cream',
  mlk: 'milk',
  whl: 'whole',
  wht: 'wheat',
  brd: 'bread',
  tort: 'tortilla',
  ttla: 'tortilla',
  avo: 'avocado',
  tom: 'tomato',
  ptto: 'potato',
  onn: 'onion',
  gar: 'garlic',
  straw: 'strawberry',
  blubry: 'blueberry',
  rasp: 'raspberry',
  jc: 'juice',
  wtr: 'water',
  spklg: 'sparkling',
  frz: 'frozen',
  fzn: 'frozen',
  ppr: 'pepper',
  ssg: 'sausage',
  bcn: 'bacon',
  slmn: 'salmon',
  shrmp: 'shrimp',
  rce: 'rice',
  pnut: 'peanut',
  btr: 'butter',
  choc: 'chocolate',
  vnla: 'vanilla',
  swt: 'sweet',
  lg: 'large',
  sm: 'small',
  md: 'medium',
  pk: 'pack',
  ct: 'count',
  ea: 'each',
};

/**
 * Split a raw receipt line into its item code (when present) and description,
 * with tax flags and stray whitespace removed.
 */
export function stripLineNoise(rawText: string): { text: string; code: string | null } {
  let text = rawText.trim().replace(/\s+/g, ' ');

  let code: string | null = null;
  const codeMatch = text.match(ITEM_CODE_PATTERN);
  if (codeMatch) {
    code = codeMatch[1];
    text = text.slice(codeMatch[0].length);
  }

  text = text.replace(TAX_FLAG_PATTERN, '').trim();

  return { text, code };
}

/**
 * Expand known receipt shorthand to full words. Whole-token matches only —
 * substring replacement would turn "ORGY" into "organicY".
 */
export function expandAbbreviations(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((token) => {
      // Keep trailing punctuation out of the lookup ("evoo," -> "evoo").
      const bare = token.replace(/[^a-z0-9%]/g, '');
      const expanded = ABBREVIATIONS[bare];
      return expanded ?? token;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Full pipeline: strip noise, expand shorthand, then hand off to the shared
 * ingredient normalizer so receipt text and item names are compared on the
 * same footing.
 *
 * Falls back to the pre-normalizer text when normalization empties the string
 * (a line of pure descriptors like "LG ORG" would otherwise vanish), so a
 * link's text key is never blank.
 */
export function normalizeReceiptLine(rawText: string): string {
  const { text } = stripLineNoise(rawText);
  const expanded = expandAbbreviations(text);
  const normalized = normalizeIngredientName(expanded);
  return normalized.length > 0 ? normalized : expanded || text.toLowerCase();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipt-line-normalizer.test.ts`
Expected: PASS, 12 tests. If the `normalizeReceiptLine` expectations differ, run the function against the input and adjust the *test* to the real `normalizeIngredientName` behaviour — do not weaken the normalizer to satisfy a guessed string.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipt-line-normalizer.ts \
  backend/test/receipts/receipt-line-normalizer.test.ts
git commit -m "feat(receipts): normalize abbreviated receipt lines for matching"
```

---

### Task 3: Line matcher

**Files:**
- Create: `backend/src/modules/receipts/receipt-line-matcher.ts`
- Test: `backend/test/receipts/receipt-line-matcher.test.ts`

**Interfaces:**
- Consumes: `normalizeReceiptLine` (Task 2); `matchSingleIngredient`, `MatchSuggestion` from `src/modules/recipes/ingredient-matching.service.js`; `receiptLineLinks`, `ingredientAliases`, `inventoryItems`.
- Produces:
  - `normalizeMerchant(merchant: string): string`
  - `buildLineKey(merchantCode: string | null, rawText: string): { lineKey: string; keyKind: 'code' | 'text' }`
  - `multiplyQuantity(count: string, unitsPerCount: string): string`
  - `matchReceiptLine(input: ReceiptLineMatchInput, householdId: string): Promise<ReceiptLineMatchResult>`
  - `TEXT_LINK_MIN_OCR_CONFIDENCE = 0.75`
  - types `ReceiptLineMatchInput`, `ReceiptLineMatchResult`

- [ ] **Step 1: Write the failing test**

Create `backend/test/receipts/receipt-line-matcher.test.ts`:

```ts
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  households,
  inventoryItems,
  ingredientAliases,
  receiptLineLinks,
} from '../../src/db/schema/index.js';
import {
  matchReceiptLine,
  buildLineKey,
  normalizeMerchant,
  multiplyQuantity,
} from '../../src/modules/receipts/receipt-line-matcher.js';

let householdId: string;
let oliveOilId: string;
let spinachId: string;

beforeAll(async () => {
  householdId = randomUUID();
  await db.insert(households).values({ id: householdId, name: `Matcher ${householdId.slice(0, 8)}` });

  const [oil] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  oliveOilId = oil.id;

  const [spin] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Spinach', defaultUnit: 'g' })
    .returning({ id: inventoryItems.id });
  spinachId = spin.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

describe('buildLineKey', () => {
  it('prefers the merchant code when present', () => {
    expect(buildLineKey('1234567', 'KS ORG EVOO')).toEqual({
      lineKey: '1234567',
      keyKind: 'code',
    });
  });

  it('falls back to normalized text', () => {
    const { lineKey, keyKind } = buildLineKey(null, 'ORG SPNCH');
    expect(keyKind).toBe('text');
    expect(lineKey).toBe('spinach');
  });
});

describe('normalizeMerchant', () => {
  it('lowercases and trims so casing never forks a key', () => {
    expect(normalizeMerchant('  COSTCO  ')).toBe('costco');
    expect(normalizeMerchant('Costco Wholesale')).toBe('costco wholesale');
  });
});

describe('multiplyQuantity', () => {
  it('multiplies decimal strings without float drift', () => {
    expect(multiplyQuantity('3', '2')).toBe('6.000');
    expect(multiplyQuantity('2', '0.5')).toBe('1.000');
    expect(multiplyQuantity('1.5', '3')).toBe('4.500');
  });

  it('is exact where IEEE-754 is not', () => {
    // Number(2.775) * Number(2023.420) lands on 5614.990.
    expect(multiplyQuantity('2.775', '2023.420')).toBe('5614.991');
  });

  it('rejects a non-decimal operand rather than silently yielding NaN', () => {
    expect(() => multiplyQuantity('abc', '2')).toThrow();
  });
});

describe('matchReceiptLine', () => {
  it('auto-resolves from a learned code link', async () => {
    await db.insert(receiptLineLinks).values({
      householdId,
      merchant: 'costco',
      lineKey: '1234567',
      keyKind: 'code',
      itemId: oliveOilId,
      unitsPerCount: '2000',
    });

    const result = await matchReceiptLine(
      { rawText: 'KS ORG EVOO', merchantCode: '1234567', merchant: 'costco', ocrConfidence: 0.4 },
      householdId
    );

    expect(result.resolution).toBe('link');
    expect(result.itemId).toBe(oliveOilId);
    expect(result.unitsPerCount).toBe('2000.000');
    expect(result.linkSource).toBe('code');
  });

  it('does not auto-resolve a text link when OCR confidence is low', async () => {
    await db.insert(receiptLineLinks).values({
      householdId,
      merchant: 'safeway',
      lineKey: 'spinach',
      keyKind: 'text',
      itemId: spinachId,
      unitsPerCount: '150',
    });

    const result = await matchReceiptLine(
      { rawText: 'ORG SPNCH', merchantCode: null, merchant: 'safeway', ocrConfidence: 0.3 },
      householdId
    );

    // The link leads the list but the user must confirm it: a misread
    // description must not silently ride a link into stock.
    expect(result.resolution).toBe('unresolved');
    expect(result.suggestions[0]?.itemId).toBe(spinachId);
  });

  it('still offers fuzzy alternatives beside an untrusted text link', async () => {
    // A second plausible item, so the fuzzy tier has something distinct to add.
    const [baby] = await db
      .insert(inventoryItems)
      .values({ householdId, name: 'Baby Spinach', defaultUnit: 'g' })
      .returning({ id: inventoryItems.id });

    // Same low-confidence line as above. The distrusted link is not the only
    // thing on offer — the user needs alternatives to judge against.
    const result = await matchReceiptLine(
      { rawText: 'ORG SPNCH', merchantCode: null, merchant: 'safeway', ocrConfidence: 0.3 },
      householdId
    );

    expect(result.resolution).toBe('unresolved');
    // The link still leads (confidence 1), with the fuzzy candidate behind it.
    expect(result.suggestions[0]?.itemId).toBe(spinachId);
    expect(result.suggestions.some((s) => s.itemId === baby.id)).toBe(true);
    // No item appears twice.
    const ids = result.suggestions.map((s) => s.itemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('auto-resolves a text link when OCR confidence is high', async () => {
    const result = await matchReceiptLine(
      { rawText: 'ORG SPNCH', merchantCode: null, merchant: 'safeway', ocrConfidence: 0.95 },
      householdId
    );

    expect(result.resolution).toBe('link');
    expect(result.itemId).toBe(spinachId);
    expect(result.linkSource).toBe('text');
  });

  it('scopes links by merchant', async () => {
    const result = await matchReceiptLine(
      { rawText: 'KS ORG EVOO', merchantCode: '1234567', merchant: 'target', ocrConfidence: 0.9 },
      householdId
    );

    expect(result.resolution).toBe('unresolved');
    expect(result.itemId).toBeNull();
  });

  it('offers an alias hit as a suggestion but never auto-resolves it', async () => {
    await db.insert(ingredientAliases).values({
      householdId,
      canonicalItemId: oliveOilId,
      aliasName: 'cooking oil',
      aliasType: 'variant',
    });

    const result = await matchReceiptLine(
      { rawText: 'COOKING OIL', merchantCode: null, merchant: 'target', ocrConfidence: 0.9 },
      householdId
    );

    // No conversion factor is stored on an alias, so the user still has to
    // supply one.
    expect(result.resolution).toBe('unresolved');
    expect(result.unitsPerCount).toBeNull();
    expect(result.suggestions.some((s) => s.itemId === oliveOilId)).toBe(true);
  });

  it('falls through to fuzzy suggestions', async () => {
    const result = await matchReceiptLine(
      { rawText: 'SPINACH', merchantCode: null, merchant: 'target', ocrConfidence: 0.9 },
      householdId
    );

    expect(result.resolution).toBe('unresolved');
    expect(result.suggestions[0]?.itemId).toBe(spinachId);
  });

  it('returns an empty suggestion list when nothing is close', async () => {
    const result = await matchReceiptLine(
      { rawText: 'ZZQX WIDGET', merchantCode: null, merchant: 'target', ocrConfidence: 0.9 },
      householdId
    );

    expect(result.resolution).toBe('unresolved');
    expect(result.suggestions).toHaveLength(0);
  });
});
```

Add `import { eq } from 'drizzle-orm';` at the top — the `afterAll` cleanup uses it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipt-line-matcher.test.ts`
Expected: FAIL — cannot find module `receipt-line-matcher.js`.

- [ ] **Step 3: Implement the matcher**

Create `backend/src/modules/receipts/receipt-line-matcher.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { receiptLineLinks, ingredientAliases, inventoryItems } from '../../db/schema/index.js';
import {
  matchSingleIngredient,
  type MatchSuggestion,
} from '../recipes/ingredient-matching.service.js';
import { normalizeReceiptLine } from './receipt-line-normalizer.js';

/**
 * Resolution order for a single receipt line:
 *
 *   1. learned link on (merchant, line_key)  -> auto-resolved
 *   2. ingredient alias on normalized text   -> suggestion only
 *   3. fuzzy match against the catalog       -> suggestions only
 *
 * Only tier 1 auto-resolves, because only a link carries the conversion
 * factor. Everything else needs the user, which is what makes the blocking
 * confirm rule survivable: the cost is paid once per product.
 */

/**
 * A text-keyed link rides on OCR-read characters, so a bad read could point at
 * the wrong item. Code-keyed links are exact identifiers and are trusted
 * regardless.
 */
export const TEXT_LINK_MIN_OCR_CONFIDENCE = 0.75;

export interface ReceiptLineMatchInput {
  rawText: string;
  merchantCode: string | null;
  merchant: string;
  ocrConfidence: number | null;
}

export interface ReceiptLineMatchResult {
  resolution: 'unresolved' | 'link';
  itemId: string | null;
  unitsPerCount: string | null;
  linkSource: 'code' | 'text' | null;
  suggestions: MatchSuggestion[];
}

/** Casing and padding must never fork a link key. */
export function normalizeMerchant(merchant: string): string {
  return merchant.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildLineKey(
  merchantCode: string | null,
  rawText: string
): { lineKey: string; keyKind: 'code' | 'text' } {
  if (merchantCode && merchantCode.trim().length > 0) {
    return { lineKey: merchantCode.trim(), keyKind: 'code' };
  }
  return { lineKey: normalizeReceiptLine(rawText), keyKind: 'text' };
}

/** Both operands and the result live at decimal(10,3). */
const SCALE = 3;

/** "2.775" -> 2775n, "3" -> 3000n. Throws on anything that isn't a decimal. */
function toScaledInt(value: string): bigint {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d*))?$/);
  if (!match) throw new Error(`Not a decimal value: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  const padded = (fraction + '0'.repeat(SCALE)).slice(0, SCALE);
  return BigInt(`${sign}${whole}${padded}`);
}

/**
 * Drizzle hands decimals back as strings. Multiply as scaled integers — going
 * through Number() loses the column's own precision: 2.775 * 2023.420 lands on
 * 5614.990 in IEEE-754 where the exact product is 5614.991. This result becomes
 * a stock quantity, so that drift is wrong inventory.
 */
export function multiplyQuantity(count: string, unitsPerCount: string): string {
  // Two scaled operands carry 2*SCALE decimal places; divide one scale back out,
  // rounding half away from zero to match Postgres numeric rounding.
  const raw = toScaledInt(count) * toScaledInt(unitsPerCount);
  const divisor = 10n ** BigInt(SCALE);
  const negative = raw < 0n;
  const magnitude = negative ? -raw : raw;
  const rounded = (magnitude + divisor / 2n) / divisor;
  const scaled = negative ? -rounded : rounded;

  const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE);
  return `${scaled < 0n ? '-' : ''}${whole}.${fraction}`;
}

async function findLink(householdId: string, merchant: string, lineKey: string) {
  return db.query.receiptLineLinks.findFirst({
    where: and(
      eq(receiptLineLinks.householdId, householdId),
      eq(receiptLineLinks.merchant, merchant),
      eq(receiptLineLinks.lineKey, lineKey)
    ),
  });
}

async function findAliasSuggestion(
  householdId: string,
  normalizedText: string
): Promise<MatchSuggestion | null> {
  const alias = await db.query.ingredientAliases.findFirst({
    where: and(
      eq(ingredientAliases.householdId, householdId),
      eq(ingredientAliases.aliasName, normalizedText)
    ),
  });
  if (!alias) return null;

  const item = await db.query.inventoryItems.findFirst({
    where: and(
      eq(inventoryItems.id, alias.canonicalItemId),
      eq(inventoryItems.householdId, householdId)
    ),
  });
  if (!item) return null;

  return {
    itemId: item.id,
    name: item.name,
    confidence: 0.92,
    matchReason: 'synonym',
  };
}

export async function matchReceiptLine(
  input: ReceiptLineMatchInput,
  householdId: string
): Promise<ReceiptLineMatchResult> {
  const merchant = normalizeMerchant(input.merchant);
  const { lineKey, keyKind } = buildLineKey(input.merchantCode, input.rawText);
  const normalizedText = normalizeReceiptLine(input.rawText);

  // Set when a link exists but is not trustworthy enough to auto-apply. It
  // still leads the suggestion list — it is probably right — but the user
  // needs the alternatives beside it to judge, so we fall through to tiers 2
  // and 3 rather than returning it alone.
  let untrustedLinkSuggestion: MatchSuggestion | null = null;

  // Tier 1 — learned link.
  const link = await findLink(householdId, merchant, lineKey);
  if (link) {
    const trusted =
      keyKind === 'code' ||
      (input.ocrConfidence ?? 1) >= TEXT_LINK_MIN_OCR_CONFIDENCE;

    const item = await db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, link.itemId),
        eq(inventoryItems.householdId, householdId)
      ),
    });

    if (item) {
      const linkSuggestion: MatchSuggestion = {
        itemId: item.id,
        name: item.name,
        confidence: 1,
        matchReason: 'exact',
      };

      if (trusted) {
        return {
          resolution: 'link',
          itemId: link.itemId,
          unitsPerCount: link.unitsPerCount,
          linkSource: keyKind,
          suggestions: [linkSuggestion],
        };
      }

      // Low-confidence text link: remember it, then fall through so the user
      // sees it alongside the alias and fuzzy candidates. Returning it alone
      // would leave them one option — the one we just declined to trust.
      untrustedLinkSuggestion = linkSuggestion;
    }
  }

  // Tier 2 — alias.
  const suggestions: MatchSuggestion[] = [];
  if (untrustedLinkSuggestion) suggestions.push(untrustedLinkSuggestion);

  const aliasSuggestion = await findAliasSuggestion(householdId, normalizedText);
  if (aliasSuggestion && !suggestions.some((s) => s.itemId === aliasSuggestion.itemId)) {
    suggestions.push(aliasSuggestion);
  }

  // Tier 3 — fuzzy.
  const fuzzy = await matchSingleIngredient(normalizedText, householdId);
  for (const candidate of fuzzy) {
    if (suggestions.some((s) => s.itemId === candidate.itemId)) continue;
    suggestions.push(candidate);
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);

  return {
    resolution: 'unresolved',
    itemId: null,
    unitsPerCount: null,
    linkSource: null,
    suggestions: suggestions.slice(0, 5),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipt-line-matcher.test.ts`
Expected: PASS, 14 tests.

If "returns an empty suggestion list when nothing is close" fails, check `matchSingleIngredient`'s threshold — it returns anything scoring ≥ 0.5, so pick a test string with no token overlap with `Olive Oil` or `Spinach` rather than lowering the threshold.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipt-line-matcher.ts \
  backend/test/receipts/receipt-line-matcher.test.ts
git commit -m "feat(receipts): resolve receipt lines via learned links, aliases, then fuzzy"
```

---

### Task 4: Tesseract transcription

**Files:**
- Create: `backend/src/modules/receipts/receipt-ocr.ts`
- Modify: `backend/package.json` — add `tesseract.js`
- Modify: `backend/src/config/index.ts` — add receipt config
- Test: `backend/test/receipts/receipt-ocr.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `transcribeReceipt(imagePath: string): Promise<TranscriptionResult>`
  - `isOcrAvailable(): Promise<boolean>`
  - type `TranscriptionResult { rawText: string; lines: TranscribedLine[]; processingTimeMs: number }`
  - type `TranscribedLine { text: string; confidence: number }`

`tesseract.js` over `node-tesseract-ocr`: prod is a native systemd install with a guided installer, and a system binary means installer changes and a new way for installs to fail.

> **The code blocks below are superseded on API mechanics.** `tesseract.js@7` nests
> per-line data at `blocks[].paragraphs[].lines[]` and only populates it when
> `recognize()` is passed `output: { blocks: true }`; `createWorker()` needs an
> `errorHandler` or a failed recognition throws uncaught; and the `setTimeout`
> shown below does not bound anything — use `Promise.race`. Adapt to the real
> installed API and keep the exported contract. What is normative here is the
> contract, the config keys, and the test strategy.

**Format normalization is required.** Tesseract's Leptonica build reads JPEG,
PNG, GIF, BMP, TIFF, and WebP — but not HEIC/HEIF. Before transcription, detect
HEIC/HEIF by magic bytes (ISO-BMFF: `ftyp` at offset 4, followed by a
`heic`/`heix`/`hevc`/`hevx`/`mif1`/`msf1` brand) and convert to JPEG with
`sharp`, already a backend dependency at `^0.33.5`. Formats Tesseract already
reads pass through untouched — no re-encode, no generational loss. Anything
whose magic bytes match nothing recognized is rejected before a worker is
created, so the WASM decoder never runs on garbage input (which is also what
keeps the negative test's output pristine: the decoder's stderr goes to a
`worker_threads` realm a main-thread `console.error` spy cannot reach).

> **Known limitation — real iPhone HEIC will not OCR on a standard install.**
> sharp's prebuilt binaries ship libheif *without* an HEVC decoder for patent
> reasons, so they handle AVIF-family HEIF but not the HEVC-coded HEIC an iPhone
> actually produces. Verified twice against independently generated `ftypheic`
> fixtures: sharp fails with `bad seek to <size+8>` in both. An earlier draft of
> this plan claimed otherwise; that claim was wrong.
>
> The conversion path stays anyway. It costs nothing on the JPEG path, it does
> handle AVIF-family HEIF, it starts working by itself in any deployment whose
> sharp is built against a system libvips carrying libde265, and where it cannot
> decode it produces a clear named error rather than a confusing Leptonica
> failure. Real-world exposure is small because iOS Safari normally transcodes
> HEIC to JPEG when a photo is uploaded through `<input type="file">` — the flow
> this feature uses. HEIC/HEIF stay in the upload allowlist so the failure, when
> it happens, is a legible message rather than a rejected file.

- [ ] **Step 1: Install the dependency**

```bash
cd backend && npm install tesseract.js
```

Run: `cd backend && node -e "import('tesseract.js').then(t => console.log(typeof t.createWorker))"`
Expected: `function`

- [ ] **Step 2: Add config**

In `backend/src/config/index.ts`, beside the existing `IMAGE_PARSE_*` entries (around line 106–123):

```ts
  RECEIPT_MAX_SIZE_MB: z.coerce.number().default(15),
  RECEIPT_OCR_LANG: z.string().default('eng'),
  RECEIPT_OCR_TIMEOUT_MS: z.coerce.number().default(120000),
  RECEIPT_STRUCTURE_TIMEOUT_MS: z.coerce.number().default(300000),
  RECEIPT_IMAGE_RETENTION_DAYS: z.coerce.number().default(7),
  RECEIPT_SCAN_RETENTION_DAYS: z.coerce.number().default(30),
```

- [ ] **Step 3: Write the failing test**

Create `backend/test/receipts/receipt-ocr.test.ts`. Note what is and is not tested here: OCR accuracy is not a unit test — it is hostage to a WASM engine's mood. We test the contract (shape, confidence normalization, error on a missing file) and leave one accuracy check opt-in.

```ts
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transcribeReceipt } from '../../src/modules/receipts/receipt-ocr.js';

const workDir = join(tmpdir(), 'basis-receipt-ocr-test');

beforeAll(async () => {
  await mkdir(workDir, { recursive: true });
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('transcribeReceipt', () => {
  it('rejects a path that does not exist', async () => {
    await expect(
      transcribeReceipt(join(workDir, 'missing.jpg'))
    ).rejects.toThrow(/not found|no such file/i);
  });

  it('rejects a file that is not an image', async () => {
    const path = join(workDir, 'notanimage.jpg');
    await writeFile(path, 'this is plain text, not a JPEG');
    await expect(transcribeReceipt(path)).rejects.toThrow();
  });
});

// Accuracy check against a real receipt image. Skipped by default: it
// downloads a ~2MB language model on first run and its output depends on the
// tesseract build. Run deliberately with RUN_OCR_ACCURACY=1.
describe.skipIf(!process.env.RUN_OCR_ACCURACY)('transcribeReceipt accuracy', () => {
  it('reads lines off a sample receipt', async () => {
    const result = await transcribeReceipt(
      join(__dirname, 'fixtures', 'sample-receipt.jpg')
    );
    expect(result.rawText.length).toBeGreaterThan(20);
    expect(result.lines.length).toBeGreaterThan(3);
    for (const line of result.lines) {
      expect(line.confidence).toBeGreaterThanOrEqual(0);
      expect(line.confidence).toBeLessThanOrEqual(1);
    }
  }, 120000);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipt-ocr.test.ts`
Expected: FAIL — cannot find module `receipt-ocr.js`.

- [ ] **Step 5: Implement the transcriber**

Create `backend/src/modules/receipts/receipt-ocr.ts`:

```ts
import { access } from 'fs/promises';
import { createWorker } from 'tesseract.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

/**
 * Receipts are dense printed text, which is Tesseract's home turf and not
 * what the image-parse VLM was built for. A captioning model asked to read 40
 * receipt lines invents plausible ones; here a hallucinated line would become
 * wrong stock, so transcription is deterministic and the LLM only ever sees
 * text Tesseract actually read.
 */

export interface TranscribedLine {
  text: string;
  /** 0–1. Tesseract reports 0–100; normalized here. */
  confidence: number;
}

export interface TranscriptionResult {
  rawText: string;
  lines: TranscribedLine[];
  processingTimeMs: number;
}

export async function isOcrAvailable(): Promise<boolean> {
  try {
    const worker = await createWorker(config.RECEIPT_OCR_LANG);
    await worker.terminate();
    return true;
  } catch (error) {
    logger.warn({ error }, 'Tesseract worker could not be created');
    return false;
  }
}

export async function transcribeReceipt(imagePath: string): Promise<TranscriptionResult> {
  try {
    await access(imagePath);
  } catch {
    throw new Error(`Receipt image not found: ${imagePath}`);
  }

  const startTime = Date.now();
  const worker = await createWorker(config.RECEIPT_OCR_LANG);

  try {
    const timeout = setTimeout(() => {
      void worker.terminate();
    }, config.RECEIPT_OCR_TIMEOUT_MS);

    const { data } = await worker.recognize(imagePath);
    clearTimeout(timeout);

    const rawText = (data.text ?? '').trim();
    if (rawText.length === 0) {
      throw new Error('Tesseract produced no text — the image may be unreadable');
    }

    // tesseract.js exposes per-line blocks on data.lines when available; fall
    // back to splitting the flat text so callers always get a line list.
    const lines: TranscribedLine[] =
      Array.isArray(data.lines) && data.lines.length > 0
        ? data.lines
            .map((line) => ({
              text: String(line.text ?? '').trim(),
              confidence: Math.max(0, Math.min(1, Number(line.confidence ?? 0) / 100)),
            }))
            .filter((line) => line.text.length > 0)
        : rawText
            .split('\n')
            .map((text) => text.trim())
            .filter((text) => text.length > 0)
            .map((text) => ({
              text,
              confidence: Math.max(0, Math.min(1, Number(data.confidence ?? 0) / 100)),
            }));

    const processingTimeMs = Date.now() - startTime;
    logger.info({ imagePath, lineCount: lines.length, processingTimeMs }, 'Receipt transcribed');

    return { rawText, lines, processingTimeMs };
  } finally {
    await worker.terminate();
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipt-ocr.test.ts`
Expected: PASS, 2 tests, 1 skipped.

- [ ] **Step 7: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/package.json backend/package-lock.json backend/src/config/index.ts \
  backend/src/modules/receipts/receipt-ocr.ts backend/test/receipts/receipt-ocr.test.ts
git commit -m "feat(receipts): transcribe receipt images with tesseract.js"
```

---

### Task 5: LLM structuring

**Files:**
- Create: `backend/src/modules/receipts/receipt-structurer.ts`
- Test: `backend/test/receipts/receipt-structurer.test.ts`

**Interfaces:**
- Consumes: `TranscribedLine` (Task 4).
- Produces:
  - `structureReceipt(rawText: string): Promise<StructuredReceipt>`
  - `parseStructuredResponse(json: string): StructuredReceipt` (exported for testing)
  - `attachConfidences(structured: StructuredReceipt, lines: TranscribedLine[]): StructuredReceiptLine[]`
  - `isStructurerAvailable(): Promise<boolean>`
  - types `StructuredReceipt { merchant: string | null; purchasedAt: string | null; lines: StructuredReceiptLine[] }`, `StructuredReceiptLine { rawText: string; code: string | null; count: number; price: number | null; ocrConfidence: number | null }`

This calls Ollama directly rather than the `services/vlm-llm` Python service. That service's `/llm/structure` is typed to its own `ContentType` enum, so routing receipts through it would mean a cross-language change plus a hard dependency on a service that need not be deployed. Ollama is already a dependency of that service anyway.

- [ ] **Step 1: Write the failing test**

Create `backend/test/receipts/receipt-structurer.test.ts`. The network call is not tested; the parsing and confidence-joining logic is, against frozen text.

```ts
import { describe, expect, it } from 'vitest';
import {
  parseStructuredResponse,
  attachConfidences,
} from '../../src/modules/receipts/receipt-structurer.js';

const COSTCO_RESPONSE = JSON.stringify({
  merchant: 'Costco Wholesale',
  purchased_at: '2026-08-01',
  lines: [
    { raw_text: '1234567 KS ORG EVOO', code: '1234567', count: 1, price: 21.99 },
    { raw_text: '96253 ORG SPNCH', code: '96253', count: 2, price: 7.98 },
  ],
});

describe('parseStructuredResponse', () => {
  it('maps snake_case model output to our shape', () => {
    const result = parseStructuredResponse(COSTCO_RESPONSE);
    expect(result.merchant).toBe('Costco Wholesale');
    expect(result.purchasedAt).toBe('2026-08-01');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]).toMatchObject({
      rawText: '96253 ORG SPNCH',
      code: '96253',
      count: 2,
      price: 7.98,
    });
  });

  it('tolerates a model that wraps JSON in prose or fences', () => {
    const wrapped = 'Here you go:\n```json\n' + COSTCO_RESPONSE + '\n```';
    expect(parseStructuredResponse(wrapped).lines).toHaveLength(2);
  });

  it('defaults a missing count to 1', () => {
    const result = parseStructuredResponse(
      JSON.stringify({ lines: [{ raw_text: 'BANANAS' }] })
    );
    expect(result.lines[0].count).toBe(1);
    expect(result.lines[0].code).toBeNull();
    expect(result.lines[0].price).toBeNull();
  });

  it('drops lines with no usable text rather than inventing one', () => {
    const result = parseStructuredResponse(
      JSON.stringify({ lines: [{ raw_text: '' }, { raw_text: '  ' }, { raw_text: 'MILK' }] })
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].rawText).toBe('MILK');
  });

  it('rejects a response with no lines array', () => {
    expect(() => parseStructuredResponse('{"merchant":"Costco"}')).toThrow(
      /lines/i
    );
  });

  it('rejects unparseable output', () => {
    expect(() => parseStructuredResponse('the model apologised')).toThrow();
  });

  it('rejects a negative count', () => {
    expect(() =>
      parseStructuredResponse(JSON.stringify({ lines: [{ raw_text: 'X', count: -2 }] }))
    ).toThrow(/count/i);
  });
});

describe('attachConfidences', () => {
  it('carries the OCR confidence of the line the text came from', () => {
    const structured = parseStructuredResponse(COSTCO_RESPONSE);
    const lines = attachConfidences(structured, [
      { text: '1234567 KS ORG EVOO', confidence: 0.91 },
      { text: '96253 ORG SPNCH', confidence: 0.44 },
    ]);
    expect(lines[0].ocrConfidence).toBe(0.91);
    expect(lines[1].ocrConfidence).toBe(0.44);
  });

  it('matches loosely so minor reformatting still joins', () => {
    const structured = parseStructuredResponse(COSTCO_RESPONSE);
    const lines = attachConfidences(structured, [
      { text: '1234567  KS  ORG  EVOO', confidence: 0.88 },
      { text: '96253 ORG SPNCH', confidence: 0.5 },
    ]);
    expect(lines[0].ocrConfidence).toBe(0.88);
  });

  it('leaves confidence null when no transcribed line corresponds', () => {
    const structured = parseStructuredResponse(COSTCO_RESPONSE);
    const lines = attachConfidences(structured, [
      { text: 'TOTAL 29.97', confidence: 0.99 },
    ]);
    expect(lines[0].ocrConfidence).toBeNull();
  });

  it('gives each duplicate line its own transcription confidence', () => {
    // Buying the same product twice prints two lines, each scanning at whatever
    // confidence that impression happened to get. A single-value-per-text join
    // would hand both lines the last one's confidence.
    const structured = parseStructuredResponse(
      JSON.stringify({
        lines: [{ raw_text: 'MILK' }, { raw_text: 'MILK' }],
      })
    );
    const lines = attachConfidences(structured, [
      { text: 'MILK', confidence: 0.95 },
      { text: 'MILK', confidence: 0.31 },
    ]);
    expect(lines[0].ocrConfidence).toBe(0.95);
    expect(lines[1].ocrConfidence).toBe(0.31);
  });

  it('leaves the surplus duplicate null rather than reusing a confidence', () => {
    const structured = parseStructuredResponse(
      JSON.stringify({
        lines: [{ raw_text: 'MILK' }, { raw_text: 'MILK' }],
      })
    );
    const lines = attachConfidences(structured, [{ text: 'MILK', confidence: 0.95 }]);
    expect(lines[0].ocrConfidence).toBe(0.95);
    expect(lines[1].ocrConfidence).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipt-structurer.test.ts`
Expected: FAIL — cannot find module `receipt-structurer.js`.

- [ ] **Step 3: Implement the structurer**

Create `backend/src/modules/receipts/receipt-structurer.ts`:

```ts
import { z } from 'zod';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import type { TranscribedLine } from './receipt-ocr.js';

/**
 * Turns Tesseract's flat transcription into structured lines using the local
 * LLM. The model reorganizes text it was given; it is never shown the image,
 * so it cannot invent a product that was not on the receipt.
 */

export interface StructuredReceiptLine {
  rawText: string;
  code: string | null;
  count: number;
  price: number | null;
  ocrConfidence: number | null;
}

export interface StructuredReceipt {
  merchant: string | null;
  purchasedAt: string | null;
  lines: StructuredReceiptLine[];
}

const PROMPT = `You are parsing a supermarket receipt that has already been transcribed by OCR.

Return ONLY a JSON object, no commentary, with this exact shape:
{
  "merchant": string or null,
  "purchased_at": "YYYY-MM-DD" or null,
  "lines": [
    { "raw_text": string, "code": string or null, "count": number, "price": number or null }
  ]
}

Rules:
- One entry per purchased product line. Copy "raw_text" VERBATIM from the transcription — do not expand abbreviations, do not correct spelling, do not invent products.
- "code" is the merchant's item number when the line begins with one (Costco prints these), otherwise null.
- "count" is how many units were bought. If the receipt does not say, use 1.
- "price" is the amount charged for that line, or null.
- EXCLUDE subtotals, totals, tax lines, payment/card lines, change due, membership numbers, coupon and discount lines, and store address or phone lines.
- If the transcription contains no product lines, return an empty "lines" array.

Transcription:
`;

const responseSchema = z.object({
  merchant: z.string().nullish(),
  purchased_at: z.string().nullish(),
  lines: z.array(
    z.object({
      raw_text: z.string(),
      code: z.string().nullish(),
      count: z.coerce.number().nonnegative({ message: 'count must not be negative' }).nullish(),
      price: z.coerce.number().nullish(),
    })
  ),
});

/** Models wrap JSON in prose or code fences often enough to handle it here. */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);

  throw new Error('LLM response contained no JSON object');
}

export function parseStructuredResponse(json: string): StructuredReceipt {
  const parsed = responseSchema.parse(JSON.parse(extractJsonObject(json)));

  return {
    merchant: parsed.merchant?.trim() || null,
    purchasedAt: parsed.purchased_at?.trim() || null,
    lines: parsed.lines
      .map((line) => ({
        rawText: line.raw_text.trim(),
        code: line.code?.trim() || null,
        count: line.count ?? 1,
        price: line.price ?? null,
        ocrConfidence: null as number | null,
      }))
      .filter((line) => line.rawText.length > 0),
  };
}

/** Loose key so whitespace or case differences still join. */
function confidenceKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Carry each transcribed line's OCR confidence onto the structured line it
 * produced. Used downstream to decide whether a text-keyed learned link is
 * trustworthy enough to auto-resolve.
 *
 * Duplicate line text is ordinary on a receipt — buy the same product twice and
 * it prints twice, at whatever confidence each impression happened to scan. So
 * the join consumes matches positionally rather than keying a single value per
 * text: a plain Map would keep only the last duplicate's confidence and hand it
 * to every line sharing that text, which could let a badly-scanned line inherit
 * a clean one's confidence and auto-apply a learned mapping it should not.
 */
export function attachConfidences(
  structured: StructuredReceipt,
  transcribed: TranscribedLine[]
): StructuredReceiptLine[] {
  const byKey = new Map<string, number[]>();
  for (const line of transcribed) {
    const key = confidenceKey(line.text);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(line.confidence);
    else byKey.set(key, [line.confidence]);
  }

  return structured.lines.map((line) => {
    const bucket = byKey.get(confidenceKey(line.rawText));
    // shift() so the Nth structured line with this text takes the Nth
    // transcription's confidence, in receipt order.
    const confidence = bucket?.shift();
    return { ...line, ocrConfidence: confidence ?? null };
  });
}

export async function isStructurerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).some((m) => m.name.startsWith(config.OLLAMA_LLM_MODEL.split(':')[0]));
  } catch {
    return false;
  }
}

export async function structureReceipt(rawText: string): Promise<StructuredReceipt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.RECEIPT_STRUCTURE_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.OLLAMA_LLM_MODEL,
        prompt: `${PROMPT}${rawText}`,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { response: string };
    const structured = parseStructuredResponse(data.response);

    logger.info(
      { merchant: structured.merchant, lineCount: structured.lines.length },
      'Receipt structured'
    );

    return structured;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipt-structurer.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipt-structurer.ts \
  backend/test/receipts/receipt-structurer.test.ts
git commit -m "feat(receipts): structure OCR text into receipt lines via ollama"
```

---

### Task 6: Scan lifecycle service and worker

**Files:**
- Create: `backend/src/modules/receipts/receipts.service.ts`
- Create: `backend/src/jobs/receipts.worker.ts`
- Modify: `backend/src/jobs/index.ts` — queue, job data type, worker registration, close, enqueue helper
- Test: `backend/test/receipts/receipts.service.test.ts`

> **Two corrections found in review, both normative.**
>
> **1. `processReceiptScan` must never throw — and the code below does, in three
> places.** The initial scan lookup sits outside the `try`, so a transient DB
> error escapes; after BullMQ exhausts `attempts: 2` the job is gone while the
> row stays `processing` forever, with no path left to move it. `failScan` is
> called unguarded from inside the `catch`, so if its own write fails the
> exception escapes too. And the `!scan.imagePath` branch merely logs and
> returns, wedging the scan in `processing` — the one state worse than `failed`,
> because the UI has nothing to offer the user. All three must resolve to
> `failed` (or, where the scan id cannot be resolved at all, log and return
> without throwing).
>
> **2. `getScan` must not recompute suggestions per line against a freshly
> fetched catalog.** `matchSingleIngredient` loads the household's entire
> inventory catalog and scores it in memory, so a 40-line receipt costs ~40 full
> catalog fetches per read — on an endpoint a review UI polls. Fetch the catalog
> once per `getScan` and thread it through, and skip suggestion computation
> entirely for lines that are already `link` or `ignore` — a resolved line has no
> use for suggestions. This adds an optional pre-fetched-items parameter to
> `matchSingleIngredient` and an optional catalog parameter to
> `matchReceiptLine`; both are additive and backward compatible.

**Interfaces:**
- Consumes: `transcribeReceipt` (Task 4); `structureReceipt`, `attachConfidences` (Task 5); `matchReceiptLine` (Task 3); schema from Task 1.
- Produces:
  - `createScan(householdId, userId, imageBuffer, mimeType, defaultAreaId?): Promise<string>`
  - `processReceiptScan(scanId: string, householdId: string): Promise<void>`
  - `getScan(scanId, householdId): Promise<ScanWithLines | null>`
  - `rematchScanLines(scanId, householdId): Promise<void>`
  - `getReceiptImagePath(scanId: string, mimeType: string): string`
  - type `ScanWithLines = ReceiptScan & { lines: Array<ReceiptScanLine & { suggestions: MatchSuggestion[] }> }`
- Also produces on `src/jobs/index.ts`: `receiptQueue`, `ReceiptJobData`, `queueReceiptParse(data)`.

- [ ] **Step 1: Wire the queue**

In `backend/src/jobs/index.ts`, mirroring the image-parse entries exactly:

```ts
// Beside the other queues (after imageParseQueue, ~line 80)
export const receiptQueue = new Queue('receipts', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 2,
  },
});

// Beside ImageParseJobData (~line 147)
export interface ReceiptJobData {
  scanId: string;
  householdId: string;
}
```

Inside the worker-registration function, after the image-parse worker (~line 275):

```ts
  // Receipt scan worker
  const receiptWorker = new Worker(
    'receipts',
    async (job: Job<ReceiptJobData>) => {
      const { processReceiptJob } = await import('./receipts.worker.js');
      return processReceiptJob(job);
    },
    { connection: redis, concurrency: 1 }
  );

  receiptWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, scanId: job.data.scanId }, 'Receipt scan job completed');
  });

  receiptWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, scanId: job?.data.scanId, error }, 'Receipt scan job failed');
  });
```

Concurrency is 1: Tesseract WASM and the local LLM both want the whole box, and two concurrent scans would be slower than two sequential ones.

Add to the shutdown sequence beside the other closes (~line 418):

```ts
  await receiptQueue.close();
```

And the enqueue helper beside `queueImageParse` (~line 457):

```ts
// Helper to queue a receipt scan parse
export async function queueReceiptParse(data: ReceiptJobData): Promise<void> {
  await receiptQueue.add('parse', data, {
    jobId: `receipt-${data.scanId}`,
  });
}
```

The `receipt-` prefix uses a hyphen, not a colon — bullmq 5.66 rejects `:` in custom job ids (fixed in `d9b2188`).

- [ ] **Step 2: Write the worker**

Create `backend/src/jobs/receipts.worker.ts`:

```ts
import type { Job } from 'bullmq';
import { logger } from '../lib/logger.js';
import type { ReceiptJobData } from './index.js';

export async function processReceiptJob(job: Job<ReceiptJobData>): Promise<void> {
  const { scanId, householdId } = job.data;

  logger.info({ scanId, jobId: job.id }, 'Starting receipt scan job');

  try {
    // Dynamic import to avoid circular dependencies
    const { processReceiptScan } = await import('../modules/receipts/receipts.service.js');

    await processReceiptScan(scanId, householdId);

    logger.info({ scanId, jobId: job.id }, 'Receipt scan job completed successfully');
  } catch (error) {
    logger.error({ scanId, jobId: job.id, error }, 'Receipt scan job failed');
    throw error;
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `backend/test/receipts/receipts.service.test.ts`. The OCR and LLM stages are mocked — this task's logic is the state machine and the persisted result, not the models.

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  households,
  users,
  inventoryItems,
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
} from '../../src/db/schema/index.js';

vi.mock('../../src/modules/receipts/receipt-ocr.js', () => ({
  transcribeReceipt: vi.fn(),
  isOcrAvailable: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../src/modules/receipts/receipt-structurer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/receipts/receipt-structurer.js')>();
  return { ...actual, structureReceipt: vi.fn(), isStructurerAvailable: vi.fn().mockResolvedValue(true) };
});

const { transcribeReceipt } = await import('../../src/modules/receipts/receipt-ocr.js');
const { structureReceipt } = await import('../../src/modules/receipts/receipt-structurer.js');
const { processReceiptScan, getScan } = await import(
  '../../src/modules/receipts/receipts.service.js'
);

let householdId: string;
let userId: string;
let oliveOilId: string;

async function makeScan(): Promise<string> {
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId,
      scannedBy: userId,
      imagePath: '/tmp/does-not-matter.jpg',
      imageMimeType: 'image/jpeg',
      status: 'processing',
    })
    .returning({ id: receiptScans.id });
  return scan.id;
}

beforeAll(async () => {
  householdId = randomUUID();
  userId = randomUUID();
  await db.insert(households).values({ id: householdId, name: `Svc ${householdId.slice(0, 8)}` });
  await db.insert(users).values({
    id: userId,
    householdId,
    email: `${userId}@test.local`,
    name: 'Scanner',
    passwordHash: 'x',
    role: 'admin',
  });
  const [oil] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  oliveOilId = oil.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

beforeEach(() => {
  vi.mocked(transcribeReceipt).mockReset();
  vi.mocked(structureReceipt).mockReset();
});

describe('processReceiptScan', () => {
  it('lands in review with one row per product line', async () => {
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: '1234567 KS ORG EVOO\n96253 ORG SPNCH\nTOTAL 29.97',
      lines: [
        { text: '1234567 KS ORG EVOO', confidence: 0.9 },
        { text: '96253 ORG SPNCH', confidence: 0.8 },
      ],
      processingTimeMs: 1200,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: '2026-08-01',
      lines: [
        { rawText: '1234567 KS ORG EVOO', code: '1234567', count: 1, price: 21.99, ocrConfidence: null },
        { rawText: '96253 ORG SPNCH', code: '96253', count: 2, price: 7.98, ocrConfidence: null },
      ],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.status).toBe('review');
    expect(scan?.merchant).toBe('Costco');
    expect(scan?.lines).toHaveLength(2);
    expect(scan?.lines[0].count).toBe('1.000');
    expect(scan?.lines[1].count).toBe('2.000');
    expect(scan?.lines.every((l) => l.resolution === 'unresolved')).toBe(true);
  });

  it('auto-resolves a line that has a learned link', async () => {
    await db.insert(receiptLineLinks).values({
      householdId,
      merchant: 'costco',
      lineKey: '1234567',
      keyKind: 'code',
      itemId: oliveOilId,
      unitsPerCount: '2000',
    });

    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: '1234567 KS ORG EVOO',
      lines: [{ text: '1234567 KS ORG EVOO', confidence: 0.9 }],
      processingTimeMs: 900,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: null,
      lines: [
        { rawText: '1234567 KS ORG EVOO', code: '1234567', count: 1, price: 21.99, ocrConfidence: null },
      ],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.lines[0].resolution).toBe('link');
    expect(scan?.lines[0].itemId).toBe(oliveOilId);
    expect(scan?.lines[0].unitsPerCount).toBe('2000.000');
  });

  it('fails the scan when OCR reads nothing', async () => {
    vi.mocked(transcribeReceipt).mockRejectedValue(new Error('Tesseract produced no text'));

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.status).toBe('failed');
    expect(scan?.errorMessage).toMatch(/no text/i);
  });

  it('fails the scan when the receipt has no product lines', async () => {
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: 'TOTAL 29.97',
      lines: [{ text: 'TOTAL 29.97', confidence: 0.99 }],
      processingTimeMs: 500,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: null,
      lines: [],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.status).toBe('failed');
    expect(scan?.errorMessage).toMatch(/no product lines/i);
  });

  it('replaces prior lines when reprocessed rather than appending', async () => {
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: 'MILK',
      lines: [{ text: 'MILK', confidence: 0.9 }],
      processingTimeMs: 300,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Safeway',
      purchasedAt: null,
      lines: [{ rawText: 'MILK', code: null, count: 1, price: 3.5, ocrConfidence: null }],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);
    await processReceiptScan(scanId, householdId);

    const rows = await db
      .select()
      .from(receiptScanLines)
      .where(eq(receiptScanLines.scanId, scanId));
    expect(rows).toHaveLength(1);
  });

  it('warns when the same shop on the same day was already confirmed', async () => {
    await db.insert(receiptScans).values({
      householdId,
      scannedBy: userId,
      merchant: 'Costco',
      purchasedAt: new Date('2026-08-01T00:00:00Z'),
      status: 'confirmed',
      confirmedAt: new Date(),
    });

    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: 'KS ORG EVOO',
      lines: [{ text: 'KS ORG EVOO', confidence: 0.9 }],
      processingTimeMs: 400,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: '2026-08-01',
      lines: [{ rawText: 'KS ORG EVOO', code: null, count: 1, price: 21.99, ocrConfidence: null }],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    // A warning, not a block — the scan is still reviewable.
    expect(scan?.status).toBe('review');
    expect(scan?.parseWarnings.join(' ')).toMatch(/already confirmed/i);
  });

  it('scopes the fetch by household', async () => {
    const scanId = await makeScan();
    expect(await getScan(scanId, randomUUID())).toBeNull();
  });
});
```

Check `backend/test/helpers/route-harness.ts` for the exact `users` insert columns before running — copy its field names rather than the placeholder shown here.

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipts.service.test.ts`
Expected: FAIL — cannot find module `receipts.service.js`.

- [ ] **Step 5: Implement the service**

Create `backend/src/modules/receipts/receipts.service.ts`:

```ts
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { queueReceiptParse } from '../../jobs/index.js';
import {
  receiptScans,
  receiptScanLines,
  type ReceiptScan,
  type ReceiptScanLine,
  type ReceiptProcessingStage,
} from '../../db/schema/index.js';
import type { MatchSuggestion } from '../recipes/ingredient-matching.service.js';
import { transcribeReceipt } from './receipt-ocr.js';
import { structureReceipt, attachConfidences } from './receipt-structurer.js';
import { matchReceiptLine } from './receipt-line-matcher.js';

const UPLOAD_DIR = join(config.STORAGE_PATH, 'receipts');

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export interface ScanLineWithSuggestions extends ReceiptScanLine {
  suggestions: MatchSuggestion[];
}

export interface ScanWithLines extends ReceiptScan {
  lines: ScanLineWithSuggestions[];
}

export function getReceiptImagePath(scanId: string, mimeType: string): string {
  const ext = mimeType.includes('png') ? '.png'
    : mimeType.includes('webp') ? '.webp'
    : mimeType.includes('heic') ? '.heic'
    : mimeType.includes('heif') ? '.heif'
    : '.jpg';
  return join(UPLOAD_DIR, `${scanId}${ext}`);
}

async function setStage(scanId: string, stage: ReceiptProcessingStage): Promise<void> {
  await db
    .update(receiptScans)
    .set({ processingStage: stage, updatedAt: new Date() })
    .where(eq(receiptScans.id, scanId));
}

/**
 * Persist the uploaded image and queue the parse. Returns the scan id
 * immediately — parsing runs on the receipts worker.
 */
export async function createScan(
  householdId: string,
  userId: string,
  imageBuffer: Buffer,
  mimeType: string,
  defaultAreaId?: string
): Promise<string> {
  const maxBytes = config.RECEIPT_MAX_SIZE_MB * 1024 * 1024;
  if (imageBuffer.length > maxBytes) {
    throw Errors.validation(`Image size exceeds maximum of ${config.RECEIPT_MAX_SIZE_MB}MB`);
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw Errors.validation(`Unsupported image type: ${mimeType}`);
  }

  const scanId = randomUUID();
  await mkdir(UPLOAD_DIR, { recursive: true });
  const imagePath = getReceiptImagePath(scanId, mimeType);
  await writeFile(imagePath, imageBuffer);

  await db.insert(receiptScans).values({
    id: scanId,
    householdId,
    scannedBy: userId,
    imagePath,
    imageMimeType: mimeType,
    defaultAreaId,
    status: 'processing',
    processingStage: 'queued',
  });

  await queueReceiptParse({ scanId, householdId });

  logger.info({ scanId, sizeBytes: imageBuffer.length }, 'Receipt scan queued');
  return scanId;
}

async function failScan(scanId: string, message: string): Promise<void> {
  await db
    .update(receiptScans)
    .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
    .where(eq(receiptScans.id, scanId));
}

/**
 * OCR -> structure -> match. Terminal states are 'review' or 'failed'; this
 * never throws, so a failed parse is a reviewable record rather than a lost
 * job.
 */
export async function processReceiptScan(scanId: string, householdId: string): Promise<void> {
  const startedAt = Date.now();

  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });

  if (!scan || !scan.imagePath) {
    logger.warn({ scanId }, 'Receipt scan missing or has no image; nothing to process');
    return;
  }

  try {
    await setStage(scanId, 'ocr');
    const transcription = await transcribeReceipt(scan.imagePath);

    await setStage(scanId, 'structuring');
    const structured = await structureReceipt(transcription.rawText);
    const linesWithConfidence = attachConfidences(structured, transcription.lines);

    if (linesWithConfidence.length === 0) {
      await failScan(scanId, 'The receipt was read but contained no product lines.');
      return;
    }

    await setStage(scanId, 'matching');
    const merchant = structured.merchant ?? '';

    // Reprocessing replaces prior lines; otherwise a retry would double them.
    await db.delete(receiptScanLines).where(eq(receiptScanLines.scanId, scanId));

    const warnings: string[] = [];
    if (!structured.merchant) {
      warnings.push('No merchant was detected. Set one before confirming.');
    }

    // Same shop, same day, already confirmed — probably a re-scan of a receipt
    // that is already in the pantry. A warning, not a block: genuine repeat
    // trips on one day do happen.
    if (structured.merchant && structured.purchasedAt) {
      const duplicate = await db.query.receiptScans.findFirst({
        where: and(
          eq(receiptScans.householdId, householdId),
          eq(receiptScans.status, 'confirmed'),
          eq(receiptScans.merchant, structured.merchant),
          eq(receiptScans.purchasedAt, new Date(structured.purchasedAt))
        ),
      });
      if (duplicate) {
        warnings.push(
          `A receipt from ${structured.merchant} on this date was already confirmed. Check you are not adding the same shop twice.`
        );
      }
    }

    for (const [index, line] of linesWithConfidence.entries()) {
      const match = await matchReceiptLine(
        {
          rawText: line.rawText,
          merchantCode: line.code,
          merchant,
          ocrConfidence: line.ocrConfidence,
        },
        householdId
      );

      await db.insert(receiptScanLines).values({
        scanId,
        householdId,
        lineIndex: index,
        rawText: line.rawText.slice(0, 500),
        merchantCode: line.code,
        count: line.count.toFixed(3),
        price: line.price !== null ? line.price.toFixed(2) : null,
        ocrConfidence: line.ocrConfidence !== null ? line.ocrConfidence.toFixed(4) : null,
        resolution: match.resolution,
        itemId: match.itemId,
        unitsPerCount: match.unitsPerCount,
      });
    }

    await db
      .update(receiptScans)
      .set({
        status: 'review',
        processingStage: 'done',
        merchant: structured.merchant,
        purchasedAt: structured.purchasedAt ? new Date(structured.purchasedAt) : null,
        rawOcrText: transcription.rawText,
        parseWarnings: warnings,
        processingTimeMs: Date.now() - startedAt,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(receiptScans.id, scanId));

    logger.info(
      { scanId, lineCount: linesWithConfidence.length, ms: Date.now() - startedAt },
      'Receipt scan ready for review'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receipt parsing failed';
    logger.error({ scanId, error }, 'Receipt scan processing failed');
    await failScan(scanId, message);
  }
}

export async function getScan(
  scanId: string,
  householdId: string
): Promise<ScanWithLines | null> {
  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });
  if (!scan) return null;

  const lines = await db
    .select()
    .from(receiptScanLines)
    .where(eq(receiptScanLines.scanId, scanId))
    .orderBy(asc(receiptScanLines.lineIndex));

  const merchant = scan.merchant ?? '';

  const withSuggestions: ScanLineWithSuggestions[] = [];
  for (const line of lines) {
    // Suggestions are recomputed on read rather than stored: the catalog moves
    // under a scan that sits in review, and a stale suggestion list is worse
    // than none.
    const match = await matchReceiptLine(
      {
        rawText: line.rawText,
        merchantCode: line.merchantCode,
        merchant,
        ocrConfidence: line.ocrConfidence !== null ? Number(line.ocrConfidence) : null,
      },
      householdId
    );
    withSuggestions.push({ ...line, suggestions: match.suggestions });
  }

  return { ...scan, lines: withSuggestions };
}

/**
 * Re-run matching for every still-unresolved line. Used after the user edits
 * the merchant, which changes every link key on the scan.
 */
export async function rematchScanLines(scanId: string, householdId: string): Promise<void> {
  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });
  if (!scan) return;

  const lines = await db
    .select()
    .from(receiptScanLines)
    .where(eq(receiptScanLines.scanId, scanId));

  for (const line of lines) {
    if (line.resolution !== 'unresolved') continue;

    const match = await matchReceiptLine(
      {
        rawText: line.rawText,
        merchantCode: line.merchantCode,
        merchant: scan.merchant ?? '',
        ocrConfidence: line.ocrConfidence !== null ? Number(line.ocrConfidence) : null,
      },
      householdId
    );

    if (match.resolution === 'link') {
      await db
        .update(receiptScanLines)
        .set({
          resolution: 'link',
          itemId: match.itemId,
          unitsPerCount: match.unitsPerCount,
          updatedAt: new Date(),
        })
        .where(eq(receiptScanLines.id, line.id));
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipts.service.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipts.service.ts backend/src/jobs/receipts.worker.ts \
  backend/src/jobs/index.ts backend/test/receipts/receipts.service.test.ts
git commit -m "feat(receipts): scan lifecycle service and background worker"
```

---

### Task 7: Scan and line routes

**Files:**
- Create: `backend/src/modules/receipts/receipts.schemas.ts`
- Create: `backend/src/modules/receipts/receipts.routes.ts`
- Modify: `backend/src/app.ts` — import and register
- Test: `backend/test/receipts/receipts.routes.test.ts`

**Interfaces:**
- Consumes: `createScan`, `getScan`, `rematchScanLines`, `getReceiptImagePath` (Task 6); `isOcrAvailable` (Task 4); `isStructurerAvailable` (Task 5).
- Produces: the HTTP surface listed below. Task 8 adds `POST /scans/:id/confirm` to the same file; Task 9 adds the `/links` routes.

- [ ] **Step 1: Write the Zod schemas**

Create `backend/src/modules/receipts/receipts.schemas.ts`:

```ts
import { z } from 'zod';

export const updateScanSchema = z.object({
  merchant: z.string().trim().min(1).max(120).optional(),
  purchasedAt: z.string().datetime().nullable().optional(),
  defaultAreaId: z.string().uuid().nullable().optional(),
});

export const updateLineSchema = z.object({
  resolution: z.enum(['unresolved', 'link', 'ignore']).optional(),
  itemId: z.string().uuid().nullable().optional(),
  unitsPerCount: z.number().positive().nullable().optional(),
  targetAreaId: z.string().uuid().nullable().optional(),
  count: z.number().positive().optional(),
  price: z.number().nonnegative().nullable().optional(),
  rawText: z.string().trim().min(1).max(500).optional(),
});

export const createItemForLineSchema = z.object({
  name: z.string().trim().min(1).max(255),
  category: z.string().max(100).optional(),
  defaultUnit: z.string().max(50).optional(),
  defaultAreaId: z.string().uuid().optional(),
  unitsPerCount: z.number().positive(),
});

export const listScansQuerySchema = z.object({
  status: z.enum(['processing', 'review', 'confirmed', 'cancelled', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
```

- [ ] **Step 2: Write the failing test**

Create `backend/test/receipts/receipts.routes.test.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  inventoryAreas,
  inventoryItems,
  receiptScans,
  receiptScanLines,
} from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

let ctx: RouteTestContext;
let user: TestUser;
let areaId: string;
let itemId: string;

/** Insert a scan already in review, bypassing OCR. */
async function seedScan(merchant: string | null = 'Costco'): Promise<{ scanId: string; lineId: string }> {
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId: user.householdId,
      scannedBy: user.id,
      merchant,
      status: 'review',
      rawOcrText: '1234567 KS ORG EVOO',
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
      price: '21.99',
    })
    .returning({ id: receiptScanLines.id });

  return { scanId: scan.id, lineId: line.id };
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  user = await ctx.createUser(householdId);

  const [area] = await db
    .insert(inventoryAreas)
    .values({ householdId, name: 'Pantry' })
    .returning({ id: inventoryAreas.id });
  areaId = area.id;

  const [item] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  itemId = item.id;
});

afterAll(async () => {
  await ctx.close();
});

describe('GET /api/v1/receipts/scans/:id', () => {
  it('returns the scan with its lines and suggestions', async () => {
    const { scanId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.scan.merchant).toBe('Costco');
    expect(body.data.scan.lines).toHaveLength(1);
    expect(Array.isArray(body.data.scan.lines[0].suggestions)).toBe(true);
  });

  it('404s for an unknown id', async () => {
    const res = await user.fetch(`/api/v1/receipts/scans/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/receipts/scans/:id/status', () => {
  it('returns just status and stage', async () => {
    const { scanId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/status`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.status).toBe('review');
    expect(body.data.lines).toBeUndefined();
  });
});

describe('PATCH /api/v1/receipts/scans/:id', () => {
  it('updates the merchant', async () => {
    const { scanId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant: 'Safeway' }),
    });
    expect(res.status).toBe(200);

    const scan = await db.query.receiptScans.findFirst({
      where: eq(receiptScans.id, scanId),
    });
    expect(scan?.merchant).toBe('Safeway');
  });

  it('refuses to edit a confirmed scan', async () => {
    const { scanId } = await seedScan();
    await db.update(receiptScans).set({ status: 'confirmed' }).where(eq(receiptScans.id, scanId));

    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant: 'Safeway' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/v1/receipts/scans/:id/lines/:lineId', () => {
  it('links a line to an item with a conversion', async () => {
    const { scanId, lineId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId, unitsPerCount: 2000 }),
    });
    expect(res.status).toBe(200);

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, lineId),
    });
    expect(line?.resolution).toBe('link');
    expect(line?.itemId).toBe(itemId);
    expect(line?.unitsPerCount).toBe('2000.000');
  });

  it('rejects a link with no conversion', async () => {
    const { scanId, lineId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an item from another household', async () => {
    const otherHouseholdId = await ctx.createHousehold();
    const [foreign] = await db
      .insert(inventoryItems)
      .values({ householdId: otherHouseholdId, name: 'Someone else oil', defaultUnit: 'ml' })
      .returning({ id: inventoryItems.id });

    const { scanId, lineId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId: foreign.id, unitsPerCount: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('clears item and conversion when set to ignore', async () => {
    const { scanId, lineId } = await seedScan();
    await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId, unitsPerCount: 2000 }),
    });
    await user.fetch(`/api/v1/receipts/scans/${scanId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'ignore' }),
    });

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, lineId),
    });
    expect(line?.resolution).toBe('ignore');
    expect(line?.itemId).toBeNull();
    expect(line?.unitsPerCount).toBeNull();
  });
});

describe('POST /api/v1/receipts/scans/:id/lines/:lineId/create-item', () => {
  it('creates the item and links the line in one call', async () => {
    const { scanId, lineId } = await seedScan();
    const res = await user.fetch(
      `/api/v1/receipts/scans/${scanId}/lines/${lineId}/create-item`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Kirkland Olive Oil',
          defaultUnit: 'ml',
          unitsPerCount: 2000,
          defaultAreaId: areaId,
        }),
      }
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.item.name).toBe('Kirkland Olive Oil');

    const line = await db.query.receiptScanLines.findFirst({
      where: eq(receiptScanLines.id, lineId),
    });
    expect(line?.resolution).toBe('link');
    expect(line?.itemId).toBe(body.data.item.id);
    expect(line?.unitsPerCount).toBe('2000.000');
  });
});

describe('DELETE /api/v1/receipts/scans/:id', () => {
  it('cancels the scan and cascades its lines', async () => {
    const { scanId } = await seedScan();
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(receiptScanLines)
      .where(eq(receiptScanLines.scanId, scanId));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipts.routes.test.ts`
Expected: FAIL — all requests 404, the routes are not registered.

- [ ] **Step 4: Write the routes**

Create `backend/src/modules/receipts/receipts.routes.ts`:

```ts
import { randomBytes } from 'crypto';
import { unlink } from 'fs/promises';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireInventoryAccess } from '../../middleware/permission.middleware.js';
import {
  receiptScans,
  receiptScanLines,
  inventoryItems,
  inventoryAreas,
} from '../../db/schema/index.js';
import { queueReceiptParse } from '../../jobs/index.js';
import { isOcrAvailable } from './receipt-ocr.js';
import { isStructurerAvailable } from './receipt-structurer.js';
import { createScan, getScan, rematchScanLines } from './receipts.service.js';
import {
  updateScanSchema,
  updateLineSchema,
  createItemForLineSchema,
  listScansQuerySchema,
} from './receipts.schemas.js';

/** Load a scan, 404ing when it belongs to another household. */
async function requireScan(scanId: string, householdId: string) {
  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });
  if (!scan) throw Errors.notFound('Receipt scan', scanId);
  return scan;
}

/** A scan past review is a historical record — edits are refused, not ignored. */
function assertEditable(status: string): void {
  if (status === 'confirmed' || status === 'cancelled') {
    throw Errors.conflict(`This scan is ${status} and can no longer be edited`);
  }
}

async function requireLine(lineId: string, scanId: string, householdId: string) {
  const line = await db.query.receiptScanLines.findFirst({
    where: and(
      eq(receiptScanLines.id, lineId),
      eq(receiptScanLines.scanId, scanId),
      eq(receiptScanLines.householdId, householdId)
    ),
  });
  if (!line) throw Errors.notFound('Receipt line', lineId);
  return line;
}

async function requireItem(itemId: string, householdId: string) {
  const item = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.id, itemId), eq(inventoryItems.householdId, householdId)),
  });
  if (!item) throw Errors.notFound('Inventory item', itemId);
  return item;
}

export default async function receiptsRoutes(app: FastifyInstance): Promise<void> {
  // Capability probe so the UI can disable the entry point rather than fail late
  app.get(
    '/status',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async () => {
      const [ocr, structurer] = await Promise.all([isOcrAvailable(), isStructurerAvailable()]);
      return {
        success: true,
        data: { available: ocr && structurer, ocrAvailable: ocr, structurerAvailable: structurer },
      };
    }
  );

  // Upload a receipt image
  app.post(
    '/scans',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const contentType = request.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        throw Errors.validation('Expected multipart/form-data');
      }

      // Bound the upload at the multipart layer. The app-wide limit is far
      // looser (MAX_UPLOAD_SIZE_MB), so without this the whole file is resident
      // in memory before createScan's own size check ever runs — the tighter
      // limit would reject after the damage, not prevent it.
      const data = await request.file({
        limits: { fileSize: config.RECEIPT_MAX_SIZE_MB * 1024 * 1024 },
      });
      if (!data) throw Errors.validation('No file uploaded');

      const buffer = await data.toBuffer();

      // Read fields only AFTER the stream is consumed. @fastify/multipart
      // populates `fields` as it parses, so a client that appends the file
      // before its other fields — the natural FormData order — would otherwise
      // hand us an empty object and we would silently drop defaultAreaId.
      const fields = data.fields as Record<string, { value?: string }>;
      const defaultAreaId = fields?.defaultAreaId?.value || undefined;
      if (defaultAreaId) {
        const area = await db.query.inventoryAreas.findFirst({
          where: and(
            eq(inventoryAreas.id, defaultAreaId),
            eq(inventoryAreas.householdId, request.user!.householdId)
          ),
        });
        if (!area) throw Errors.notFound('Storage area', defaultAreaId);
      }

      const scanId = await createScan(
        request.user!.householdId,
        request.user!.id,
        buffer,
        data.mimetype,
        defaultAreaId
      );

      return { success: true, data: { id: scanId, status: 'processing' } };
    }
  );

  app.get<{ Querystring: { status?: string; limit?: number } }>(
    '/scans',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const query = listScansQuerySchema.parse(request.query);

      const where = query.status
        ? and(
            eq(receiptScans.householdId, request.user!.householdId),
            eq(receiptScans.status, query.status)
          )
        : eq(receiptScans.householdId, request.user!.householdId);

      const scans = await db
        .select()
        .from(receiptScans)
        .where(where)
        .orderBy(desc(receiptScans.createdAt))
        .limit(query.limit);

      return { success: true, data: { scans } };
    }
  );

  // Lightweight poll while parsing — avoids recomputing suggestions per tick
  app.get<{ Params: { id: string } }>(
    '/scans/:id/status',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      return {
        success: true,
        data: {
          status: scan.status,
          processingStage: scan.processingStage,
          errorMessage: scan.errorMessage,
        },
      };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/scans/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const scan = await getScan(request.params.id, request.user!.householdId);
      if (!scan) throw Errors.notFound('Receipt scan', request.params.id);
      return { success: true, data: { scan } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/scans/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      assertEditable(scan.status);

      const input = updateScanSchema.parse(request.body);

      if (input.defaultAreaId) {
        const area = await db.query.inventoryAreas.findFirst({
          where: and(
            eq(inventoryAreas.id, input.defaultAreaId),
            eq(inventoryAreas.householdId, request.user!.householdId)
          ),
        });
        if (!area) throw Errors.notFound('Storage area', input.defaultAreaId);
      }

      await db
        .update(receiptScans)
        .set({
          ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
          ...(input.purchasedAt !== undefined
            ? { purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null }
            : {}),
          ...(input.defaultAreaId !== undefined ? { defaultAreaId: input.defaultAreaId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(receiptScans.id, scan.id));

      // A merchant change rewrites every link key on the scan, so unresolved
      // lines get another shot at matching.
      if (input.merchant !== undefined && input.merchant !== scan.merchant) {
        await rematchScanLines(scan.id, request.user!.householdId);
      }

      const updated = await getScan(scan.id, request.user!.householdId);
      return { success: true, data: { scan: updated } };
    }
  );

  app.patch<{ Params: { id: string; lineId: string } }>(
    '/scans/:id/lines/:lineId',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      assertEditable(scan.status);
      const line = await requireLine(request.params.lineId, scan.id, request.user!.householdId);

      const input = updateLineSchema.parse(request.body);

      const resolution = input.resolution ?? line.resolution;
      const itemId = input.itemId !== undefined ? input.itemId : line.itemId;
      const unitsPerCount =
        input.unitsPerCount !== undefined
          ? input.unitsPerCount?.toFixed(3) ?? null
          : line.unitsPerCount;

      if (resolution === 'link') {
        if (!itemId) throw Errors.validation('A linked line needs an item');
        if (!unitsPerCount) {
          throw Errors.validation(
            'A linked line needs a conversion — how many units of the item is one of these?'
          );
        }
        await requireItem(itemId, request.user!.householdId);
      }

      if (input.targetAreaId) {
        const area = await db.query.inventoryAreas.findFirst({
          where: and(
            eq(inventoryAreas.id, input.targetAreaId),
            eq(inventoryAreas.householdId, request.user!.householdId)
          ),
        });
        if (!area) throw Errors.notFound('Storage area', input.targetAreaId);
      }

      // Ignoring is a clean slate: leaving a stale item behind would let a
      // later flip back to 'link' silently reuse a conversion the user never
      // reviewed.
      const cleared = resolution !== 'link';

      await db
        .update(receiptScanLines)
        .set({
          resolution,
          itemId: cleared ? null : itemId,
          unitsPerCount: cleared ? null : unitsPerCount,
          ...(input.targetAreaId !== undefined ? { targetAreaId: input.targetAreaId } : {}),
          ...(input.count !== undefined ? { count: input.count.toFixed(3) } : {}),
          ...(input.price !== undefined
            ? { price: input.price !== null ? input.price.toFixed(2) : null }
            : {}),
          ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
          updatedAt: new Date(),
        })
        .where(eq(receiptScanLines.id, line.id));

      const updated = await getScan(scan.id, request.user!.householdId);
      return { success: true, data: { scan: updated } };
    }
  );

  // Create a catalog item and link the line to it in one round trip. Two calls
  // would risk an orphan item if the client died between them.
  app.post<{ Params: { id: string; lineId: string } }>(
    '/scans/:id/lines/:lineId/create-item',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      assertEditable(scan.status);
      const line = await requireLine(request.params.lineId, scan.id, request.user!.householdId);

      const input = createItemForLineSchema.parse(request.body);

      if (input.defaultAreaId) {
        const area = await db.query.inventoryAreas.findFirst({
          where: and(
            eq(inventoryAreas.id, input.defaultAreaId),
            eq(inventoryAreas.householdId, request.user!.householdId)
          ),
        });
        if (!area) throw Errors.notFound('Storage area', input.defaultAreaId);
      }

      const item = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(inventoryItems)
          .values({
            householdId: request.user!.householdId,
            name: input.name,
            internalId: `HM-${randomBytes(3).toString('hex').toUpperCase()}`,
            defaultUnit: input.defaultUnit,
            category: input.category,
            defaultAreaId: input.defaultAreaId,
          })
          .returning();

        await tx
          .update(receiptScanLines)
          .set({
            resolution: 'link',
            itemId: created.id,
            unitsPerCount: input.unitsPerCount.toFixed(3),
            updatedAt: new Date(),
          })
          .where(eq(receiptScanLines.id, line.id));

        return created;
      });

      const updated = await getScan(scan.id, request.user!.householdId);
      return { success: true, data: { item, scan: updated } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/scans/:id/reprocess',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      assertEditable(scan.status);
      if (!scan.imagePath) {
        throw Errors.validation('This scan has no stored image and cannot be reprocessed');
      }

      await db
        .update(receiptScans)
        .set({
          status: 'processing',
          processingStage: 'queued',
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(receiptScans.id, scan.id));

      await queueReceiptParse({ scanId: scan.id, householdId: request.user!.householdId });

      return { success: true, data: { id: scan.id, status: 'processing' } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/scans/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);

      if (scan.imagePath) {
        try {
          await unlink(scan.imagePath);
        } catch (error) {
          logger.warn({ scanId: scan.id, error }, 'Could not delete receipt image');
        }
      }

      // Lines cascade.
      await db.delete(receiptScans).where(eq(receiptScans.id, scan.id));

      return { success: true, data: { message: 'Scan deleted' } };
    }
  );
}
```

- [ ] **Step 5: Register the routes**

In `backend/src/app.ts`, add the import beside the other module imports, then register it inside `apiScope` next to the inventory line (~line 245):

```ts
    await apiScope.register(receiptsRoutes, { prefix: '/api/v1/receipts' });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipts.routes.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipts.routes.ts \
  backend/src/modules/receipts/receipts.schemas.ts backend/src/app.ts \
  backend/test/receipts/receipts.routes.test.ts
git commit -m "feat(receipts): scan and line review routes"
```

---

### Task 8: Confirm

**Files:**
- Modify: `backend/src/modules/receipts/receipts.service.ts` — add `confirmScan`
- Modify: `backend/src/modules/receipts/receipts.routes.ts` — add the confirm route
- Test: `backend/test/receipts/receipts.confirm.test.ts`

**Interfaces:**
- Consumes: `multiplyQuantity`, `normalizeMerchant`, `buildLineKey` (Task 3); `emitInventoryEvent` from the websocket module (grep `backend/src/websocket/` for its exact export path — `inventory.routes.ts:744` imports it).
- Produces: `confirmScan(scanId, householdId): Promise<ConfirmResult>`; type `ConfirmResult { stockCreated: number; linksSaved: number; ignoredCount: number }`.

> **Two corrections found in review, both normative.**
>
> **1. The resolved `areaId` must be household-verified at confirm time.** It is
> the one id in the write path that nothing checks. The item is re-verified, but
> the area — `line.targetAreaId ?? item.defaultAreaId ?? scan.defaultAreaId` —
> goes straight into `inventory_stock.areaId`. There is no DB backstop: the RLS
> policy on `inventory_stock` (`drizzle/0007_rls_foundation.sql`) constrains
> `item_id` only and says nothing about `area_id`. And `inventory_items`
> currently lets a `defaultAreaId` be set without checking the area's household,
> so an item can legitimately carry a foreign area that confirm would propagate.
> Because `inventory_stock.areaId` is `onDelete: 'cascade'`, the other household
> deleting that area would silently delete this household's stock row. Collect
> the distinct resolved area ids and verify them in one query before the
> transaction opens; refuse on any that do not belong.
>
> **2. Refusals must collect, and must carry line ids.** The design is "failures
> collect; the throw happens before the transaction opens" — only the second half
> was implemented. Item-resolution failures throw on the first offending line, so
> a forty-line receipt with six bad lines surfaces them one round trip at a time.
> And the missing-area detail carries `rawText` only; receipt lines routinely
> repeat identical text (two of the same product), so a UI cannot tell which row
> to highlight. Every refusal emits `{ lineId, rawText }[]`.
>
> The task's headline invariant — never half a receipt — must also be proven by a
> test, not just by code structure: two lines, the first fully valid and the
> second unplaceable, expecting a 400 and **zero** new `inventory_stock` rows.

- [ ] **Step 1: Write the failing test**

Create `backend/test/receipts/receipts.confirm.test.ts`:

```ts
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

let ctx: RouteTestContext;
let user: TestUser;
let areaId: string;
let itemId: string;

interface SeedLine {
  rawText: string;
  merchantCode?: string | null;
  count?: string;
  price?: string | null;
  resolution?: 'unresolved' | 'link' | 'ignore';
  itemId?: string | null;
  unitsPerCount?: string | null;
  targetAreaId?: string | null;
}

async function seedScan(
  lines: SeedLine[],
  opts: { merchant?: string | null; defaultAreaId?: string | null } = {}
): Promise<string> {
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId: user.householdId,
      scannedBy: user.id,
      merchant: opts.merchant === undefined ? 'Costco' : opts.merchant,
      defaultAreaId: opts.defaultAreaId === undefined ? areaId : opts.defaultAreaId,
      purchasedAt: new Date('2026-08-01T00:00:00Z'),
      status: 'review',
    })
    .returning({ id: receiptScans.id });

  await db.insert(receiptScanLines).values(
    lines.map((line, index) => ({
      scanId: scan.id,
      householdId: user.householdId,
      lineIndex: index,
      rawText: line.rawText,
      merchantCode: line.merchantCode ?? null,
      count: line.count ?? '1.000',
      price: line.price ?? null,
      resolution: line.resolution ?? 'link',
      itemId: line.itemId === undefined ? itemId : line.itemId,
      unitsPerCount: line.unitsPerCount === undefined ? '2000.000' : line.unitsPerCount,
      targetAreaId: line.targetAreaId ?? null,
    }))
  );

  return scan.id;
}

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  user = await ctx.createUser(householdId);

  const [area] = await db
    .insert(inventoryAreas)
    .values({ householdId, name: 'Pantry' })
    .returning({ id: inventoryAreas.id });
  areaId = area.id;

  const [item] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  itemId = item.id;
});

afterAll(async () => {
  await ctx.close();
});

async function confirm(scanId: string): Promise<Response> {
  return user.fetch(`/api/v1/receipts/scans/${scanId}/confirm`, { method: 'POST' });
}

describe('POST /api/v1/receipts/scans/:id/confirm', () => {
  it('writes stock as count x unitsPerCount in the item default unit', async () => {
    const scanId = await seedScan([
      { rawText: '1234567 KS ORG EVOO', merchantCode: '1234567', count: '3.000', price: '65.97' },
    ]);

    const res = await confirm(scanId);
    expect(res.status).toBe(200);

    const stock = await db.select().from(inventoryStock).where(eq(inventoryStock.itemId, itemId));
    const row = stock.at(-1)!;
    expect(row.quantity).toBe('6000.000');
    expect(row.unit).toBe('ml');
    expect(row.source).toBe('purchase');
    expect(row.areaId).toBe(areaId);
    // 65.97 spread across 6000 ml
    expect(Number(row.pricePerUnit)).toBeCloseTo(0.011, 3);
  });

  it('saves a learned link keyed on the item code', async () => {
    const scanId = await seedScan([
      { rawText: '1234567 KS ORG EVOO', merchantCode: '1234567' },
    ]);
    await confirm(scanId);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.lineKey, '1234567'),
    });
    expect(link?.merchant).toBe('costco');
    expect(link?.keyKind).toBe('code');
    expect(link?.itemId).toBe(itemId);
    expect(link?.unitsPerCount).toBe('2000.000');
    expect(link?.useCount).toBe(1);
  });

  it('updates rather than duplicates a link on the second scan', async () => {
    const first = await seedScan([{ rawText: 'ORG SPNCH', merchantCode: '9999' }]);
    await confirm(first);
    const second = await seedScan([
      { rawText: 'ORG SPNCH', merchantCode: '9999', unitsPerCount: '150.000' },
    ]);
    await confirm(second);

    const links = await db
      .select()
      .from(receiptLineLinks)
      .where(eq(receiptLineLinks.lineKey, '9999'));
    expect(links).toHaveLength(1);
    expect(links[0].unitsPerCount).toBe('150.000');
    expect(links[0].useCount).toBe(2);
  });

  it('refuses when any line is unresolved, naming the line', async () => {
    const scanId = await seedScan([
      { rawText: 'KNOWN', merchantCode: '1' },
      { rawText: 'MYSTERY', merchantCode: '2', resolution: 'unresolved', itemId: null, unitsPerCount: null },
    ]);

    const res = await confirm(scanId);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/MYSTERY|unresolved/i);

    // Nothing partially applied.
    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan?.status).toBe('review');
  });

  it('refuses when the merchant is blank', async () => {
    const scanId = await seedScan([{ rawText: 'KS ORG EVOO' }], { merchant: null });
    const res = await confirm(scanId);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/merchant/i);
  });

  it('refuses when a line resolves to no storage area', async () => {
    const [orphanItem] = await db
      .insert(inventoryItems)
      .values({ householdId: user.householdId, name: 'Homeless Item', defaultUnit: 'g' })
      .returning({ id: inventoryItems.id });

    const scanId = await seedScan([{ rawText: 'NO HOME', itemId: orphanItem.id }], {
      defaultAreaId: null,
    });

    const res = await confirm(scanId);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/area/i);
  });

  it('ignores ignored lines entirely — no stock, no link', async () => {
    const scanId = await seedScan([
      { rawText: 'BAG FEE', merchantCode: '55', resolution: 'ignore', itemId: null, unitsPerCount: null },
      { rawText: 'KS ORG EVOO', merchantCode: '56' },
    ]);

    const res = await confirm(scanId);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.stockCreated).toBe(1);
    expect(body.data.ignoredCount).toBe(1);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.lineKey, '55'),
    });
    expect(link).toBeUndefined();
  });

  it('prefers the line target area over the scan default', async () => {
    const [fridge] = await db
      .insert(inventoryAreas)
      .values({ householdId: user.householdId, name: 'Fridge' })
      .returning({ id: inventoryAreas.id });

    const scanId = await seedScan([{ rawText: 'KS ORG EVOO', targetAreaId: fridge.id }]);
    await confirm(scanId);

    const stock = await db.select().from(inventoryStock).where(eq(inventoryStock.areaId, fridge.id));
    expect(stock).toHaveLength(1);
  });

  it('409s on a second confirm', async () => {
    const scanId = await seedScan([{ rawText: 'KS ORG EVOO' }]);
    expect((await confirm(scanId)).status).toBe(200);
    expect((await confirm(scanId)).status).toBe(409);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipts.confirm.test.ts`
Expected: FAIL — the confirm route 404s.

- [ ] **Step 3: Implement `confirmScan`**

Append to `backend/src/modules/receipts/receipts.service.ts` (and extend the imports at the top of the file to include `sql` from `drizzle-orm`, `inventoryStock`, `inventoryItems`, `receiptLineLinks`, and `multiplyQuantity` / `normalizeMerchant` / `buildLineKey` from `./receipt-line-matcher.js`):

```ts
export interface ConfirmResult {
  stockCreated: number;
  linksSaved: number;
  ignoredCount: number;
}

/**
 * Turn a reviewed scan into stock, and remember every decision.
 *
 * Every line must be resolved first — unlike /shopping-list/put-away, which
 * silently skips what it cannot place, this refuses. Silence here would mean a
 * user believing their pantry was updated when half the receipt was dropped.
 */
export async function confirmScan(
  scanId: string,
  householdId: string
): Promise<ConfirmResult> {
  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });
  if (!scan) throw Errors.notFound('Receipt scan', scanId);

  if (scan.status === 'confirmed') {
    throw Errors.conflict('This scan has already been confirmed');
  }
  if (scan.status !== 'review') {
    throw Errors.validation(`A scan in status "${scan.status}" cannot be confirmed`);
  }

  const merchant = (scan.merchant ?? '').trim();
  if (merchant.length === 0) {
    throw Errors.validation(
      'Set the merchant before confirming — it is part of every saved line mapping.'
    );
  }

  const lines = await db
    .select()
    .from(receiptScanLines)
    .where(eq(receiptScanLines.scanId, scanId))
    .orderBy(asc(receiptScanLines.lineIndex));

  const unresolved = lines.filter((line) => line.resolution === 'unresolved');
  if (unresolved.length > 0) {
    throw Errors.validation(
      `${unresolved.length} line(s) still need a decision before this receipt can be confirmed.`,
      {
        unresolvedLineIds: unresolved.map((line) => line.id),
        unresolvedLines: unresolved.map((line) => line.rawText),
      }
    );
  }

  const linked = lines.filter((line) => line.resolution === 'link');
  const ignoredCount = lines.length - linked.length;

  // Resolve every area up front so a missing one fails before any write.
  const plans: Array<{
    line: typeof linked[number];
    areaId: string;
    quantity: string;
    unit: string | null;
  }> = [];

  const missingArea: string[] = [];

  for (const line of linked) {
    const item = await db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, line.itemId!),
        eq(inventoryItems.householdId, householdId)
      ),
    });
    if (!item) throw Errors.notFound('Inventory item', line.itemId ?? 'unknown');

    const areaId = line.targetAreaId ?? item.defaultAreaId ?? scan.defaultAreaId;
    if (!areaId) {
      missingArea.push(line.rawText);
      continue;
    }

    plans.push({
      line,
      areaId,
      quantity: multiplyQuantity(line.count, line.unitsPerCount!),
      unit: item.defaultUnit,
    });
  }

  if (missingArea.length > 0) {
    throw Errors.validation(
      `${missingArea.length} line(s) have no storage area. Set a default area for the scan, or pick one per line.`,
      { linesWithoutArea: missingArea }
    );
  }

  const addedAt = scan.purchasedAt ?? new Date();

  await db.transaction(async (tx) => {
    for (const plan of plans) {
      const pricePerUnit =
        plan.line.price !== null && Number(plan.quantity) > 0
          ? (Number(plan.line.price) / Number(plan.quantity)).toFixed(4)
          : null;

      await tx.insert(inventoryStock).values({
        itemId: plan.line.itemId!,
        areaId: plan.areaId,
        quantity: plan.quantity,
        unit: plan.unit,
        source: 'purchase',
        pricePerUnit,
        originalQuantity: plan.quantity,
        addedAt,
      });

      const { lineKey, keyKind } = buildLineKey(plan.line.merchantCode, plan.line.rawText);

      await tx
        .insert(receiptLineLinks)
        .values({
          householdId,
          merchant: normalizeMerchant(merchant),
          lineKey,
          keyKind,
          itemId: plan.line.itemId!,
          unitsPerCount: plan.line.unitsPerCount!,
          useCount: 1,
          lastUsedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            receiptLineLinks.householdId,
            receiptLineLinks.merchant,
            receiptLineLinks.lineKey,
          ],
          set: {
            itemId: plan.line.itemId!,
            unitsPerCount: plan.line.unitsPerCount!,
            useCount: sql`${receiptLineLinks.useCount} + 1`,
            lastUsedAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }

    await tx
      .update(receiptScans)
      .set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(receiptScans.id, scanId));
  });

  emitInventoryEvent(householdId, { action: 'quantity_changed' });

  logger.info(
    { scanId, stockCreated: plans.length, ignoredCount },
    'Receipt scan confirmed'
  );

  return { stockCreated: plans.length, linksSaved: plans.length, ignoredCount };
}
```

Import `emitInventoryEvent` using the same specifier `inventory.routes.ts` uses — check its import block rather than guessing the path.

- [ ] **Step 4: Add the confirm route**

In `backend/src/modules/receipts/receipts.routes.ts`, add `confirmScan` to the service import and register:

```ts
  app.post<{ Params: { id: string } }>(
    '/scans/:id/confirm',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const result = await confirmScan(request.params.id, request.user!.householdId);
      return { success: true, data: result };
    }
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipts.confirm.test.ts`
Expected: PASS, 9 tests.

If the "already confirmed" case returns 400 instead of 409, check that `Errors.conflict` maps to 409 in `src/lib/errors.ts` — do not change the test to match a wrong status.

- [ ] **Step 6: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipts.service.ts \
  backend/src/modules/receipts/receipts.routes.ts \
  backend/test/receipts/receipts.confirm.test.ts
git commit -m "feat(receipts): confirm a scan into stock and save learned links"
```

---

### Task 9: Learned-link management routes

**Files:**
- Modify: `backend/src/modules/receipts/receipts.routes.ts` — add `/links` routes
- Modify: `backend/src/modules/receipts/receipts.schemas.ts` — add `updateLinkSchema`
- Test: `backend/test/receipts/receipts.links.test.ts`

**Interfaces:**
- Consumes: `receiptLineLinks` (Task 1), `requireItem` helper (Task 7).
- Produces: `GET /links`, `PATCH /links/:id`, `DELETE /links/:id`.

A wrong learned mapping is invisible and self-perpetuating — it silently auto-resolves every future scan of that product. These routes are the only way a user can see or undo one.

- [ ] **Step 1: Add the schema**

Append to `backend/src/modules/receipts/receipts.schemas.ts`:

```ts
export const updateLinkSchema = z.object({
  itemId: z.string().uuid().optional(),
  unitsPerCount: z.number().positive().optional(),
});

export const listLinksQuerySchema = z.object({
  merchant: z.string().trim().max(120).optional(),
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
```

- [ ] **Step 2: Write the failing test**

Create `backend/test/receipts/receipts.links.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import { inventoryItems, receiptLineLinks } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

let ctx: RouteTestContext;
let user: TestUser;
let oilId: string;
let spinachId: string;

async function seedLink(merchant: string, lineKey: string, itemId: string): Promise<string> {
  const [link] = await db
    .insert(receiptLineLinks)
    .values({
      householdId: user.householdId,
      merchant,
      lineKey,
      keyKind: 'code',
      itemId,
      unitsPerCount: '2000.000',
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

  it('filters by merchant', async () => {
    await seedLink('safeway', 'code-list-2', spinachId);
    const res = await user.fetch('/api/v1/receipts/links?merchant=safeway');
    const body = await res.json();
    expect(body.data.links.every((l: { merchant: string }) => l.merchant === 'safeway')).toBe(true);
  });
});

describe('PATCH /api/v1/receipts/links/:id', () => {
  it('repoints a link at a different item', async () => {
    const linkId = await seedLink('costco', 'code-patch-1', oilId);
    const res = await user.fetch(`/api/v1/receipts/links/${linkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipts.links.test.ts`
Expected: FAIL — the `/links` routes 404.

- [ ] **Step 4: Implement the routes**

Add to `backend/src/modules/receipts/receipts.routes.ts` (extend the imports with `receiptLineLinks`, `ilike`, and the two new schemas):

```ts
  app.get<{ Querystring: { merchant?: string; search?: string; limit?: number } }>(
    '/links',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const query = listLinksQuerySchema.parse(request.query);

      const conditions = [eq(receiptLineLinks.householdId, request.user!.householdId)];
      if (query.merchant) {
        conditions.push(eq(receiptLineLinks.merchant, query.merchant.toLowerCase()));
      }
      if (query.search) {
        conditions.push(ilike(receiptLineLinks.lineKey, `%${query.search}%`));
      }

      const links = await db
        .select({
          id: receiptLineLinks.id,
          merchant: receiptLineLinks.merchant,
          lineKey: receiptLineLinks.lineKey,
          keyKind: receiptLineLinks.keyKind,
          itemId: receiptLineLinks.itemId,
          itemName: inventoryItems.name,
          unitsPerCount: receiptLineLinks.unitsPerCount,
          itemUnit: inventoryItems.defaultUnit,
          useCount: receiptLineLinks.useCount,
          lastUsedAt: receiptLineLinks.lastUsedAt,
        })
        .from(receiptLineLinks)
        .innerJoin(inventoryItems, eq(inventoryItems.id, receiptLineLinks.itemId))
        .where(and(...conditions))
        .orderBy(desc(receiptLineLinks.useCount))
        .limit(query.limit);

      return { success: true, data: { links } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/links/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const link = await db.query.receiptLineLinks.findFirst({
        where: and(
          eq(receiptLineLinks.id, request.params.id),
          eq(receiptLineLinks.householdId, request.user!.householdId)
        ),
      });
      if (!link) throw Errors.notFound('Receipt line link', request.params.id);

      const input = updateLinkSchema.parse(request.body);
      if (input.itemId) {
        await requireItem(input.itemId, request.user!.householdId);
      }

      await db
        .update(receiptLineLinks)
        .set({
          ...(input.itemId ? { itemId: input.itemId } : {}),
          ...(input.unitsPerCount ? { unitsPerCount: input.unitsPerCount.toFixed(3) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(receiptLineLinks.id, link.id));

      return { success: true, data: { message: 'Link updated' } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/links/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const deleted = await db
        .delete(receiptLineLinks)
        .where(
          and(
            eq(receiptLineLinks.id, request.params.id),
            eq(receiptLineLinks.householdId, request.user!.householdId)
          )
        )
        .returning({ id: receiptLineLinks.id });

      if (deleted.length === 0) {
        throw Errors.notFound('Receipt line link', request.params.id);
      }

      return { success: true, data: { message: 'Link forgotten' } };
    }
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipts.links.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipts.routes.ts \
  backend/src/modules/receipts/receipts.schemas.ts \
  backend/test/receipts/receipts.links.test.ts
git commit -m "feat(receipts): list, repoint, and forget learned line links"
```

---

### Task 9b: Give learned links a human-readable description

Added after Task 9's review. `receipt_line_links` stores only `lineKey`, which for
code-keyed links — every Costco link, the primary target — is an opaque product
number. The link manager is the only place a user can catch a mapping that is
silently auto-applying to every scan, and it currently shows a number they cannot
recognize. Retention makes it worse: scans are swept after 30 days while links live
forever, so the original text disappears and the mapping becomes permanently
unauditable.

**Files:**
- Create: `backend/drizzle/0011_receipt_link_description.sql` + journal entry + snapshot
- Modify: `backend/src/db/schema/receipts.ts` — add the column
- Modify: `backend/src/modules/receipts/receipts.service.ts` — write it in `confirmScan`'s upsert
- Modify: `backend/src/modules/receipts/receipts.routes.ts` — select it in `GET /links`
- Test: extend `backend/test/receipts/receipts.confirm.test.ts` and `receipts.links.test.ts`

**Interfaces:**
- Consumes: `receiptLineLinks` (Task 1), `confirmScan` (Task 8), `GET /links` (Task 9).
- Produces: `receiptLineLinks.lastRawText` (nullable `varchar(500)`), surfaced as `lastRawText` on each `GET /links` row.

Nullable, because links created before this migration have no text to backfill —
the column fills in naturally the next time each mapping is used.

Write it on **every** upsert, insert and update alike, so a store reformatting its
printed description keeps the label current rather than freezing whatever text was
on the first receipt.

Migration follows the same hand-authored pattern as `0010` (drizzle-kit generate is
broken here): the `.sql`, an `entries` append in `meta/_journal.json`, and a
`meta/0011_snapshot.json` copied from `0010_snapshot.json` with `id` /`prevId`
updated and the new column added.

### Task 10: Retention cleanup

**Files:**
- Modify: `backend/src/jobs/cleanup.worker.ts` — add `old_receipt_scans` case
- Modify: `backend/src/jobs/index.ts` — add the type to `CleanupJobData['type']` and to whatever schedules cleanup jobs
- Test: `backend/test/receipts/receipts.cleanup.test.ts`

**Interfaces:**
- Consumes: `receiptScans` (Task 1), `config.RECEIPT_IMAGE_RETENTION_DAYS`, `config.RECEIPT_SCAN_RETENTION_DAYS` (Task 4).
- Produces: `cleanupOldReceiptScans(): Promise<void>` (module-private; reached via the `old_receipt_scans` job type).

Two different clocks: a confirmed scan's *image* is dead weight after a week, but the scan record and its OCR text are cheap history worth keeping. An abandoned review is swept at 30 days.

- [ ] **Step 1: Write the failing test**

Create `backend/test/receipts/receipts.cleanup.test.ts`:

```ts
import { randomUUID } from 'crypto';
import { mkdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import { households, users, receiptScans } from '../../src/db/schema/index.js';
import { processCleanupJob } from '../../src/jobs/cleanup.worker.js';

const workDir = join(tmpdir(), 'basis-receipt-cleanup-test');
let householdId: string;
let userId: string;

async function seedScan(opts: {
  status: 'review' | 'confirmed';
  ageDays: number;
  imagePath: string | null;
}): Promise<string> {
  const when = new Date(Date.now() - opts.ageDays * 24 * 60 * 60 * 1000);
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId,
      scannedBy: userId,
      status: opts.status,
      imagePath: opts.imagePath,
      createdAt: when,
      updatedAt: when,
      confirmedAt: opts.status === 'confirmed' ? when : null,
    })
    .returning({ id: receiptScans.id });
  return scan.id;
}

async function makeImage(name: string): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, 'fake image bytes');
  return path;
}

beforeAll(async () => {
  await mkdir(workDir, { recursive: true });
  householdId = randomUUID();
  userId = randomUUID();
  await db.insert(households).values({ id: householdId, name: `Cleanup ${householdId.slice(0, 8)}` });
  await db.insert(users).values({
    id: userId,
    householdId,
    email: `${userId}@test.local`,
    name: 'Cleaner',
    passwordHash: 'x',
    role: 'admin',
  });
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

describe('old_receipt_scans cleanup', () => {
  it('deletes the image of a long-confirmed scan but keeps the record', async () => {
    const imagePath = await makeImage('confirmed-old.jpg');
    const scanId = await seedScan({ status: 'confirmed', ageDays: 30, imagePath });

    await processCleanupJob({ id: 'test', data: { type: 'old_receipt_scans' } } as never);

    await expect(access(imagePath)).rejects.toThrow();
    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan).toBeDefined();
    expect(scan?.imagePath).toBeNull();
  });

  it('keeps the image of a recently confirmed scan', async () => {
    const imagePath = await makeImage('confirmed-new.jpg');
    await seedScan({ status: 'confirmed', ageDays: 1, imagePath });

    await processCleanupJob({ id: 'test', data: { type: 'old_receipt_scans' } } as never);

    await expect(access(imagePath)).resolves.toBeUndefined();
  });

  it('deletes an abandoned review outright', async () => {
    const imagePath = await makeImage('abandoned.jpg');
    const scanId = await seedScan({ status: 'review', ageDays: 45, imagePath });

    await processCleanupJob({ id: 'test', data: { type: 'old_receipt_scans' } } as never);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan).toBeUndefined();
    await expect(access(imagePath)).rejects.toThrow();
  });

  it('leaves a review from yesterday alone', async () => {
    const scanId = await seedScan({ status: 'review', ageDays: 1, imagePath: null });

    await processCleanupJob({ id: 'test', data: { type: 'old_receipt_scans' } } as never);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, scanId) });
    expect(scan).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipts.cleanup.test.ts`
Expected: FAIL — `old_receipt_scans` is not a known cleanup type, so nothing happens and the first assertion fails.

- [ ] **Step 3: Implement the cleanup**

In `backend/src/jobs/index.ts`, add `'old_receipt_scans'` to the `type` union on `CleanupJobData`. Then in `backend/src/jobs/cleanup.worker.ts`, add the case to the switch:

```ts
      case 'old_receipt_scans':
        await cleanupOldReceiptScans();
        break;
```

And the implementation beside the other cleanup functions:

```ts
/**
 * Receipt scans age on two clocks. A confirmed scan's image is dead weight
 * after a week, but the record and its OCR text are cheap history worth
 * keeping. An abandoned review is swept whole after 30 days — unlike
 * image-parse sessions there is no hard expiry, because coming back to a
 * half-reviewed receipt is the normal case.
 */
async function cleanupOldReceiptScans(): Promise<void> {
  const now = Date.now();
  const imageCutoff = new Date(now - config.RECEIPT_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const scanCutoff = new Date(now - config.RECEIPT_SCAN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Abandoned reviews (and failed parses) go away entirely.
  const stale = await db
    .delete(receiptScans)
    .where(
      and(
        inArray(receiptScans.status, ['review', 'processing', 'failed']),
        lt(receiptScans.updatedAt, scanCutoff)
      )
    )
    .returning({ id: receiptScans.id, imagePath: receiptScans.imagePath });

  for (const scan of stale) {
    if (!scan.imagePath) continue;
    try {
      await unlink(scan.imagePath);
    } catch {
      // Already gone; nothing to do.
    }
  }

  // Confirmed scans keep their record, lose their image.
  const confirmed = await db
    .select({ id: receiptScans.id, imagePath: receiptScans.imagePath })
    .from(receiptScans)
    .where(
      and(
        eq(receiptScans.status, 'confirmed'),
        lt(receiptScans.confirmedAt, imageCutoff),
        isNotNull(receiptScans.imagePath)
      )
    );

  for (const scan of confirmed) {
    // Null the row BEFORE unlinking, the same ordering rule the delete branch
    // follows. Both operations can't be atomic, so fail toward an orphaned file:
    // wasted disk is harmless, whereas a row still pointing at a vanished file
    // breaks GET /scans/:id/image.
    await db
      .update(receiptScans)
      .set({ imagePath: null })
      .where(eq(receiptScans.id, scan.id));

    if (scan.imagePath) {
      try {
        await unlink(scan.imagePath);
      } catch {
        // Already gone.
      }
    }
  }

  logger.info(
    { deletedScans: stale.length, imagesPruned: confirmed.length },
    'Cleaned up old receipt scans'
  );
}
```

Extend the file's imports with `unlink` from `fs/promises`, `and`/`inArray`/`isNotNull` from `drizzle-orm`, `receiptScans` from the schema, and `config`.

- [ ] **Step 4: Schedule it**

Find where the other cleanup types are enqueued (grep `old_leftovers` across `backend/src/`) and add `old_receipt_scans` to the same schedule at the same cadence.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipts.cleanup.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: PASS. This is the first point where every backend piece is in place — treat a failure here as a real regression, not a flake.

- [ ] **Step 7: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/jobs/cleanup.worker.ts backend/src/jobs/index.ts \
  backend/test/receipts/receipts.cleanup.test.ts
git commit -m "feat(receipts): retention sweep for scan images and abandoned reviews"
```

---

### Task 11: Frontend API client and upload dialog

**Files:**
- Create: `frontend/src/api/receipts.ts`
- Create: `frontend/src/components/inventory/ReceiptUploadDialog.tsx`
- Modify: `frontend/src/pages/inventory/InventoryPage.tsx` — add the entry button

**Interfaces:**
- Consumes: the Task 7–9 endpoints; `apiGet`/`apiPost`/`apiPatch`/`apiDelete`/`apiUpload` from `@/api/client`.
- Produces: `receiptsApi` with `uploadScan`, `listScans`, `getScan`, `getScanStatus`, `updateScan`, `updateLine`, `createItemForLine`, `reprocessScan`, `confirmScan`, `deleteScan`, `listLinks`, `updateLink`, `deleteLink`; types `ReceiptScan`, `ReceiptScanLine`, `ReceiptLineSuggestion`, `ReceiptLineLink`.

Reminder: this workspace has **no test runner**. Verification is `npm run typecheck`, `npm run lint`, and Playwright.

- [ ] **Step 1: Write the API module**

Create `frontend/src/api/receipts.ts`:

```ts
import { apiGet, apiPost, apiPatch, apiDelete, apiUpload } from './client';

export type ReceiptScanStatus = 'processing' | 'review' | 'confirmed' | 'cancelled' | 'failed';
export type ReceiptLineResolution = 'unresolved' | 'link' | 'ignore';
export type ReceiptProcessingStage = 'queued' | 'ocr' | 'structuring' | 'matching' | 'done';

export interface ReceiptLineSuggestion {
  itemId: string;
  name: string;
  confidence: number;
  matchReason: 'exact' | 'synonym' | 'contains' | 'fuzzy';
}

export interface ReceiptScanLine {
  id: string;
  lineIndex: number;
  rawText: string;
  merchantCode: string | null;
  count: string;
  price: string | null;
  ocrConfidence: string | null;
  resolution: ReceiptLineResolution;
  itemId: string | null;
  unitsPerCount: string | null;
  targetAreaId: string | null;
  suggestions: ReceiptLineSuggestion[];
}

export interface ReceiptScan {
  id: string;
  merchant: string | null;
  purchasedAt: string | null;
  status: ReceiptScanStatus;
  processingStage: ReceiptProcessingStage | null;
  parseWarnings: string[];
  errorMessage: string | null;
  defaultAreaId: string | null;
  rawOcrText: string | null;
  createdAt: string;
  confirmedAt: string | null;
  lines: ReceiptScanLine[];
}

export interface ReceiptLineLink {
  id: string;
  merchant: string;
  lineKey: string;
  keyKind: 'code' | 'text';
  itemId: string;
  itemName: string;
  itemUnit: string | null;
  unitsPerCount: string;
  useCount: number;
  lastUsedAt: string | null;
}

export interface ConfirmResult {
  stockCreated: number;
  linksSaved: number;
  ignoredCount: number;
}

export interface UpdateLineRequest {
  resolution?: ReceiptLineResolution;
  itemId?: string | null;
  unitsPerCount?: number | null;
  targetAreaId?: string | null;
  count?: number;
  price?: number | null;
  rawText?: string;
}

export interface CreateItemForLineRequest {
  name: string;
  category?: string;
  defaultUnit?: string;
  defaultAreaId?: string;
  unitsPerCount: number;
}

export const receiptsApi = {
  getStatus: () =>
    apiGet<{ available: boolean; ocrAvailable: boolean; structurerAvailable: boolean }>(
      '/receipts/status'
    ),

  uploadScan: (file: File, onProgress?: (progress: number) => void) =>
    apiUpload<{ id: string; status: ReceiptScanStatus }>('/receipts/scans', file, { onProgress }),

  listScans: (status?: ReceiptScanStatus) =>
    apiGet<{ scans: Omit<ReceiptScan, 'lines'>[] }>('/receipts/scans', {
      params: status ? { status } : undefined,
    }),

  getScan: (id: string) => apiGet<{ scan: ReceiptScan }>(`/receipts/scans/${id}`),

  // Cheap poll while parsing — does not recompute per-line suggestions.
  getScanStatus: (id: string) =>
    apiGet<{
      status: ReceiptScanStatus;
      processingStage: ReceiptProcessingStage | null;
      errorMessage: string | null;
    }>(`/receipts/scans/${id}/status`),

  updateScan: (
    id: string,
    data: { merchant?: string; purchasedAt?: string | null; defaultAreaId?: string | null }
  ) => apiPatch<{ scan: ReceiptScan }>(`/receipts/scans/${id}`, data),

  updateLine: (scanId: string, lineId: string, data: UpdateLineRequest) =>
    apiPatch<{ scan: ReceiptScan }>(`/receipts/scans/${scanId}/lines/${lineId}`, data),

  createItemForLine: (scanId: string, lineId: string, data: CreateItemForLineRequest) =>
    apiPost<{ item: { id: string; name: string }; scan: ReceiptScan }>(
      `/receipts/scans/${scanId}/lines/${lineId}/create-item`,
      data
    ),

  reprocessScan: (id: string) =>
    apiPost<{ id: string; status: ReceiptScanStatus }>(`/receipts/scans/${id}/reprocess`, {}),

  confirmScan: (id: string) => apiPost<ConfirmResult>(`/receipts/scans/${id}/confirm`, {}),

  deleteScan: (id: string) => apiDelete<{ message: string }>(`/receipts/scans/${id}`),

  listLinks: (params?: { merchant?: string; search?: string }) =>
    apiGet<{ links: ReceiptLineLink[] }>('/receipts/links', { params }),

  updateLink: (id: string, data: { itemId?: string; unitsPerCount?: number }) =>
    apiPatch<{ message: string }>(`/receipts/links/${id}`, data),

  deleteLink: (id: string) => apiDelete<{ message: string }>(`/receipts/links/${id}`),
};
```

Check `apiUpload`'s form field name (`frontend/src/api/client.ts:234` appends as `file`) matches what `request.file()` reads on the backend — it does, but confirm rather than assume. If you need to send `defaultAreaId` with the upload, set it afterwards with `updateScan` instead of extending `apiUpload`.

- [ ] **Step 2: Write the upload dialog**

Create `frontend/src/components/inventory/ReceiptUploadDialog.tsx`. It captures a file, uploads, then polls `getScanStatus` until the scan leaves `processing`, and navigates to the review page.

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Upload, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { receiptsApi, type ReceiptProcessingStage } from '@/api/receipts';

interface ReceiptUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STAGE_LABELS: Record<ReceiptProcessingStage, string> = {
  queued: 'Waiting for a free slot…',
  ocr: 'Reading the receipt…',
  structuring: 'Working out the line items…',
  matching: 'Matching against your inventory…',
  done: 'Done',
};

export function ReceiptUploadDialog({ open, onOpenChange }: ReceiptUploadDialogProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stage, setStage] = useState<ReceiptProcessingStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  // Set when the dialog closes or unmounts, so work that resolves afterwards
  // knows to stay quiet. stopPolling alone is not enough: during the upload
  // await there is no interval yet for it to clear.
  const cancelledRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      stopPolling();
    },
    [stopPolling]
  );

  const reset = useCallback(() => {
    cancelledRef.current = true;
    stopPolling();
    setUploadProgress(0);
    setStage(null);
    setBusy(false);
    setError(null);
  }, [stopPolling]);

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    cancelledRef.current = false;

    try {
      const { id } = await receiptsApi.uploadScan(file, setUploadProgress);

      // Closing the dialog or leaving the page during the upload itself resolves
      // nothing — the promise above still settles. Without this guard we would
      // start an interval nobody is tracking and, minutes later, yank the
      // browser to the review page for a dialog the user already dismissed.
      if (cancelledRef.current) return;

      setStage('queued');

      pollRef.current = window.setInterval(async () => {
        try {
          const status = await receiptsApi.getScanStatus(id);
          setStage(status.processingStage);

          if (status.status === 'review') {
            stopPolling();
            reset();
            onOpenChange(false);
            navigate(`/inventory/receipts/${id}`);
          } else if (status.status === 'failed') {
            stopPolling();
            setBusy(false);
            setError(status.errorMessage ?? 'The receipt could not be read.');
          }
        } catch {
          stopPolling();
          setBusy(false);
          setError('Lost contact with the server while the receipt was processing.');
        }
      }, 2000);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan a receipt</DialogTitle>
          <DialogDescription>
            Photograph a grocery receipt and we'll match its lines to your inventory. Items you
            match once are remembered for next time.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {busy ? (
          <div className="space-y-3 py-4">
            <Progress value={uploadProgress < 100 ? uploadProgress : undefined} />
            <p className="text-sm text-muted-foreground">
              {uploadProgress < 100
                ? `Uploading… ${uploadProgress}%`
                : stage
                  ? STAGE_LABELS[stage]
                  : 'Processing…'}
            </p>
            <p className="text-xs text-muted-foreground">
              A long receipt can take a couple of minutes. You can close this and come back to it
              from the receipts list.
            </p>
          </div>
        ) : (
          <div className="py-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button className="w-full" onClick={() => fileInputRef.current?.click()}>
              <Camera className="mr-2 h-4 w-4" />
              Take photo or choose a file
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {busy ? 'Close (keeps processing)' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Add the entry point and routes**

In `frontend/src/pages/inventory/InventoryPage.tsx`, add state and a button beside Bulk Add (around line 1241):

```tsx
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReceiptDialogOpen(true)}
            >
              <Receipt className="mr-2 h-4 w-4" />
              Scan Receipt
            </Button>
```

with `const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);` beside the other dialog state (~line 154), `Receipt` added to the `lucide-react` import, and `<ReceiptUploadDialog open={receiptDialogOpen} onOpenChange={setReceiptDialogOpen} />` rendered beside `<BulkAddDialog />` (~line 1722).

No `App.tsx` changes in this task. The dialog navigates to `/inventory/receipts/:id`, which Task 12 registers — until then the navigation dead-ends on the not-found page, which is expected at this checkpoint. Task 13 registers `/inventory/receipts`.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/receipts.ts \
  frontend/src/components/inventory/ReceiptUploadDialog.tsx \
  frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "feat(receipts): receipt upload dialog and API client"
```

---

### Task 12: Review page

**Files:**
- Create: `frontend/src/components/inventory/ReceiptLineRow.tsx`
- Create: `frontend/src/pages/inventory/ReceiptScanPage.tsx`
- Modify: `frontend/src/App.tsx` — register the route

**Interfaces:**
- Consumes: `receiptsApi` and its types (Task 11); `AreaCombobox`, `CategoryCombobox`, `UnitCombobox` from `@/components/inventory/fields`; `inventoryApi` for item search.
- Produces: `ReceiptScanPage` (default-exported route component), `ReceiptLineRow`.

The grouping is the ergonomics of the whole feature: a repeat Costco run should open showing two rows, not forty.

- [ ] **Step 1: Write the line row**

Create `frontend/src/components/inventory/ReceiptLineRow.tsx`:

```tsx
import { useState } from 'react';
import { Check, X, Plus, Link2Off, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { AreaCombobox } from '@/components/inventory/fields';
import type { ReceiptScanLine, ReceiptLineSuggestion } from '@/api/receipts';
import type { StorageArea, InventoryItem } from '@/types/models';

interface ReceiptLineRowProps {
  line: ReceiptScanLine;
  items: InventoryItem[];
  areas: StorageArea[];
  onLink: (lineId: string, itemId: string, unitsPerCount: number) => void;
  onIgnore: (lineId: string) => void;
  onUnlink: (lineId: string) => void;
  onSetArea: (lineId: string, areaId: string | null) => void;
  onCreateItem: (lineId: string) => void;
  disabled?: boolean;
}

/** A confidence low enough that the OCR read is worth eyeballing. */
const LOW_CONFIDENCE = 0.6;

export function ReceiptLineRow({
  line,
  items,
  areas,
  onLink,
  onIgnore,
  onUnlink,
  onSetArea,
  onCreateItem,
  disabled,
}: ReceiptLineRowProps) {
  const linkedItem = items.find((item) => item.id === line.itemId);
  const [conversion, setConversion] = useState(line.unitsPerCount ?? '1');
  const [search, setSearch] = useState('');

  const lowConfidence =
    line.ocrConfidence !== null && Number(line.ocrConfidence) < LOW_CONFIDENCE;

  const searchResults = search.trim()
    ? items
        .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  const commitConversion = (value: string) => {
    const parsed = Number(value);
    if (line.itemId && Number.isFinite(parsed) && parsed > 0) {
      onLink(line.id, line.itemId, parsed);
    }
  };

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm">{line.rawText}</span>
            {lowConfidence && (
              <Badge variant="outline" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Low confidence — check against the photo
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {line.merchantCode && <span className="mr-2">#{line.merchantCode}</span>}
            <span className="mr-2">×{Number(line.count)}</span>
            {line.price && <span>${Number(line.price).toFixed(2)}</span>}
          </p>
        </div>

        {line.resolution !== 'ignore' && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onIgnore(line.id)}>
            <X className="mr-1 h-3 w-3" />
            Ignore
          </Button>
        )}
      </div>

      {line.resolution === 'link' && linkedItem ? (
        <div className="flex flex-wrap items-end gap-3">
          <Badge className="gap-1">
            <Check className="h-3 w-3" />
            {linkedItem.name}
          </Badge>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              1 × this line =
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                step="any"
                className="w-24"
                value={conversion}
                disabled={disabled}
                onChange={(e) => setConversion(e.target.value)}
                onBlur={(e) => commitConversion(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">
                {linkedItem.defaultUnit ?? 'units'}
              </span>
            </div>
          </div>

          <div className="space-y-1 w-[180px]">
            <Label className="text-xs text-muted-foreground">Storage area</Label>
            <AreaCombobox
              areas={areas}
              value={line.targetAreaId ?? ''}
              onValueChange={(v) => onSetArea(line.id, v || null)}
              placeholder="Use default"
              allowClear
              clearLabel="Use default"
            />
          </div>

          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onUnlink(line.id)}>
            <Link2Off className="mr-1 h-3 w-3" />
            Unlink
          </Button>
        </div>
      ) : line.resolution === 'ignore' ? (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Ignored</Badge>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onUnlink(line.id)}>
            Undo
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {line.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {line.suggestions.slice(0, 3).map((suggestion: ReceiptLineSuggestion) => (
                <Button
                  key={suggestion.itemId}
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onLink(line.id, suggestion.itemId, Number(conversion) || 1)}
                >
                  {suggestion.name}
                  <Badge variant="secondary" className="ml-2">
                    {Math.round(suggestion.confidence * 100)}% {suggestion.matchReason}
                  </Badge>
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search your inventory…"
              className="w-[240px]"
              value={search}
              disabled={disabled}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onCreateItem(line.id)}>
              <Plus className="mr-1 h-3 w-3" />
              Create item
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {searchResults.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    setSearch('');
                    onLink(line.id, item.id, Number(conversion) || 1);
                  }}
                >
                  {item.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the review page**

Create `frontend/src/pages/inventory/ReceiptScanPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AreaCombobox } from '@/components/inventory/fields';
import { ReceiptLineRow } from '@/components/inventory/ReceiptLineRow';
import { receiptsApi } from '@/api/receipts';
import { inventoryApi } from '@/api/inventory';
import { useToast } from '@/components/ui/use-toast';

export default function ReceiptScanPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [merchantDraft, setMerchantDraft] = useState<string | null>(null);
  const [showMatched, setShowMatched] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  const scanQuery = useQuery({
    queryKey: ['receipt-scan', id],
    queryFn: () => receiptsApi.getScan(id),
  });

  const itemsQuery = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryApi.getItems(),
  });

  const areasQuery = useQuery({
    queryKey: ['inventory-areas'],
    queryFn: () => inventoryApi.getAreas(),
  });

  const scan = scanQuery.data?.scan;
  const items = itemsQuery.data?.items ?? [];
  const areas = areasQuery.data?.areas ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['receipt-scan', id] });

  const updateLine = useMutation({
    mutationFn: ({ lineId, data }: { lineId: string; data: Parameters<typeof receiptsApi.updateLine>[2] }) =>
      receiptsApi.updateLine(id, lineId, data),
    onSuccess: invalidate,
    onError: (error: Error) =>
      toast({ title: 'Could not update the line', description: error.message, variant: 'destructive' }),
  });

  const updateScan = useMutation({
    mutationFn: (data: Parameters<typeof receiptsApi.updateScan>[1]) =>
      receiptsApi.updateScan(id, data),
    onSuccess: invalidate,
  });

  const confirm = useMutation({
    mutationFn: () => receiptsApi.confirmScan(id),
    onSuccess: (result) => {
      toast({
        title: 'Receipt added to inventory',
        description: `${result.stockCreated} item(s) stocked, ${result.linksSaved} mapping(s) remembered.`,
      });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
      navigate('/inventory');
    },
    onError: (error: Error) =>
      toast({ title: 'Could not confirm', description: error.message, variant: 'destructive' }),
  });

  const groups = useMemo(() => {
    const lines = scan?.lines ?? [];
    return {
      unresolved: lines.filter((line) => line.resolution === 'unresolved'),
      matched: lines.filter((line) => line.resolution === 'link'),
      ignored: lines.filter((line) => line.resolution === 'ignore'),
    };
  }, [scan]);

  if (scanQuery.isLoading) return <div className="p-6">Loading…</div>;
  if (!scan) return <div className="p-6">Receipt not found.</div>;

  if (scan.status === 'failed') {
    return (
      <div className="p-6 space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{scan.errorMessage ?? 'This receipt could not be read.'}</AlertDescription>
        </Alert>
        <Button onClick={() => receiptsApi.reprocessScan(id).then(invalidate)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }

  const resolvedCount = groups.matched.length + groups.ignored.length;
  const blocked = groups.unresolved.length > 0 || !(merchantDraft ?? scan.merchant ?? '').trim();

  const lineProps = {
    items,
    areas,
    disabled: updateLine.isPending || confirm.isPending,
    onLink: (lineId: string, itemId: string, unitsPerCount: number) =>
      updateLine.mutate({ lineId, data: { resolution: 'link', itemId, unitsPerCount } }),
    onIgnore: (lineId: string) => updateLine.mutate({ lineId, data: { resolution: 'ignore' } }),
    onUnlink: (lineId: string) => updateLine.mutate({ lineId, data: { resolution: 'unresolved' } }),
    onSetArea: (lineId: string, areaId: string | null) =>
      updateLine.mutate({ lineId, data: { targetAreaId: areaId } }),
    onCreateItem: (lineId: string) => {
      const line = scan.lines.find((l) => l.id === lineId);
      if (!line) return;
      void receiptsApi
        .createItemForLine(id, lineId, { name: line.rawText, unitsPerCount: 1 })
        .then(invalidate);
    },
  };

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Review receipt</h1>
          <Badge variant={blocked ? 'secondary' : 'default'}>
            {resolvedCount} of {scan.lines.length} resolved
          </Badge>
        </div>

        {scan.parseWarnings.map((warning) => (
          <Alert key={warning}>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ))}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Merchant</Label>
            <Input
              value={merchantDraft ?? scan.merchant ?? ''}
              onChange={(e) => setMerchantDraft(e.target.value)}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== scan.merchant) updateScan.mutate({ merchant: value });
              }}
              placeholder="Costco"
            />
          </div>
          <div className="space-y-1">
            <Label>Purchase date</Label>
            <Input
              type="date"
              value={scan.purchasedAt ? scan.purchasedAt.slice(0, 10) : ''}
              onChange={(e) =>
                updateScan.mutate({
                  purchasedAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Default storage area</Label>
            <AreaCombobox
              areas={areas}
              value={scan.defaultAreaId ?? ''}
              onValueChange={(v) => updateScan.mutate({ defaultAreaId: v || null })}
              placeholder="Pick an area"
              allowClear
              clearLabel="None"
            />
          </div>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="font-medium">Needs attention ({groups.unresolved.length})</h2>
        {groups.unresolved.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Everything on this receipt is resolved.
          </p>
        ) : (
          groups.unresolved.map((line) => (
            <ReceiptLineRow key={line.id} line={line} {...lineProps} />
          ))
        )}
      </section>

      <Collapsible open={showMatched} onOpenChange={setShowMatched}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="px-0">
            {showMatched ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
            Matched ({groups.matched.length})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          {groups.matched.map((line) => (
            <ReceiptLineRow key={line.id} line={line} {...lineProps} />
          ))}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={showIgnored} onOpenChange={setShowIgnored}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="px-0">
            {showIgnored ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
            Ignored ({groups.ignored.length})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          {groups.ignored.map((line) => (
            <ReceiptLineRow key={line.id} line={line} {...lineProps} />
          ))}
        </CollapsibleContent>
      </Collapsible>

      <div className="sticky bottom-0 border-t bg-background py-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {groups.unresolved.length > 0
            ? `${groups.unresolved.length} line(s) still need a decision.`
            : !(merchantDraft ?? scan.merchant ?? '').trim()
              ? 'Set a merchant before confirming.'
              : 'Ready to add to inventory.'}
        </p>
        <Button disabled={blocked || confirm.isPending} onClick={() => confirm.mutate()}>
          {confirm.isPending ? 'Adding…' : 'Add to inventory'}
        </Button>
      </div>
    </div>
  );
}
```

Check the real shapes before running: `inventoryApi.getItems()` and `getAreas()` return names may differ (`items` / `areas`), and the toast import path may be `@/hooks/use-toast`. Grep `InventoryPage.tsx` for both and match it.

- [ ] **Step 3: Register the route**

In `frontend/src/App.tsx`, beside the other inventory routes:

```tsx
<Route path="/inventory/receipts/:id" element={<ReceiptScanPage />} />
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Walk it in a browser**

Start the stack with `./dev.sh start`, then with Playwright: open `/inventory`, click **Scan Receipt**, upload a receipt photo, wait for the review page, and confirm that (a) unresolved lines appear first, (b) linking a line moves it into Matched, (c) the confirm button stays disabled until nothing is unresolved, and (d) confirming lands the stock on `/inventory`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/inventory/ReceiptScanPage.tsx \
  frontend/src/components/inventory/ReceiptLineRow.tsx frontend/src/App.tsx
git commit -m "feat(receipts): receipt review page grouped by what needs attention"
```

---

### Task 13: Image panel, scan history, and link manager

**Files:**
- Modify: `backend/src/modules/receipts/receipts.routes.ts` — add `GET /scans/:id/image`
- Modify: `frontend/src/api/receipts.ts` — add `getImageUrl`
- Modify: `frontend/src/pages/inventory/ReceiptScanPage.tsx` — add the image panel
- Create: `frontend/src/pages/inventory/ReceiptsPage.tsx`
- Create: `frontend/src/components/inventory/ReceiptLinkManager.tsx`
- Modify: `frontend/src/App.tsx` — register `/inventory/receipts`
- Test: `backend/test/receipts/receipts.image.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 7–12.
- Produces: `GET /api/v1/receipts/scans/:id/image`; `receiptsApi.getImageUrl(id)`; `ReceiptsPage`; `ReceiptLinkManager`.

OCR errors are only catchable against the original, so the review page needs the photo beside the lines. Closest existing pattern is the bug-report screenshot viewer (`7115423`).

- [ ] **Step 1: Write the failing test for the image route**

Create `backend/test/receipts/receipts.image.test.ts`:

```ts
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import { receiptScans } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

let ctx: RouteTestContext;
let user: TestUser;
let imagePath: string;

// A 1x1 JPEG is enough — we assert on transport, not pixels.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  user = await ctx.createUser(householdId);

  const dir = join(tmpdir(), 'basis-receipt-image-test');
  await mkdir(dir, { recursive: true });
  imagePath = join(dir, 'receipt.jpg');
  await writeFile(imagePath, TINY_JPEG);
});

afterAll(async () => {
  await ctx.close();
});

async function seedScan(path: string | null): Promise<string> {
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId: user.householdId,
      scannedBy: user.id,
      status: 'review',
      imagePath: path,
      imageMimeType: 'image/jpeg',
    })
    .returning({ id: receiptScans.id });
  return scan.id;
}

describe('GET /api/v1/receipts/scans/:id/image', () => {
  it('serves the stored image', async () => {
    const scanId = await seedScan(imagePath);
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBe(TINY_JPEG.length);
  });

  it('404s once the image has been pruned', async () => {
    const scanId = await seedScan(null);
    const res = await user.fetch(`/api/v1/receipts/scans/${scanId}/image`);
    expect(res.status).toBe(404);
  });

  it('404s for another household', async () => {
    const otherId = await ctx.createHousehold();
    const otherUser = await ctx.createUser(otherId);
    const scanId = await seedScan(imagePath);

    const res = await otherUser.fetch(`/api/v1/receipts/scans/${scanId}/image`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/receipts/receipts.image.test.ts`
Expected: FAIL — route 404s in all three cases, so the first two assertions fail.

- [ ] **Step 3: Add the image route**

In `backend/src/modules/receipts/receipts.routes.ts` (add `readFile` from `fs/promises` to the imports):

```ts
  app.get<{ Params: { id: string } }>(
    '/scans/:id/image',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request, reply) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      if (!scan.imagePath) {
        // Pruned by the retention sweep, or never stored.
        throw Errors.notFound('Receipt image', request.params.id);
      }

      try {
        const buffer = await readFile(scan.imagePath);
        return reply
          .header('Content-Type', scan.imageMimeType ?? 'image/jpeg')
          .header('Cache-Control', 'private, max-age=3600')
          .send(buffer);
      } catch {
        throw Errors.notFound('Receipt image', request.params.id);
      }
    }
  );
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx vitest run test/receipts/receipts.image.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the image panel to the review page**

In `frontend/src/api/receipts.ts`, add to `receiptsApi`:

```ts
  // The <img> element fetches this directly; cookies ride along on same-origin.
  getImageUrl: (id: string) => `/api/v1/receipts/scans/${id}/image`,
```

In `ReceiptScanPage.tsx`, wrap the line sections and the photo in a two-column layout on wide screens. Replace the outer `<div className="p-6 space-y-6">` body so the sections sit in the left column and this sits in the right:

```tsx
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-2">
            <Label className="text-xs text-muted-foreground">Original receipt</Label>
            <img
              src={receiptsApi.getImageUrl(id)}
              alt="Scanned receipt"
              className="w-full rounded-lg border max-h-[80vh] object-contain"
              onError={(e) => {
                // Pruned after confirmation — hide rather than show a broken frame.
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        </aside>
```

with the surrounding grid as `<div className="grid gap-6 lg:grid-cols-[1fr,360px]">`.

- [ ] **Step 6: Write the scan history page**

Create `frontend/src/pages/inventory/ReceiptsPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { receiptsApi, type ReceiptScanStatus } from '@/api/receipts';

const STATUS_VARIANT: Record<ReceiptScanStatus, 'default' | 'secondary' | 'destructive'> = {
  processing: 'secondary',
  review: 'default',
  confirmed: 'secondary',
  cancelled: 'secondary',
  failed: 'destructive',
};

export default function ReceiptsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['receipt-scans'],
    queryFn: () => receiptsApi.listScans(),
  });

  if (isLoading) return <div className="p-6">Loading…</div>;

  const scans = data?.scans ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Receipt scans</h1>
        <Button variant="outline" onClick={() => navigate('/inventory')}>
          Back to inventory
        </Button>
      </div>

      {scans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No receipts scanned yet. Use <strong>Scan Receipt</strong> on the inventory page.
        </p>
      ) : (
        <div className="space-y-2">
          {scans.map((scan) => (
            <Card
              key={scan.id}
              className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/40"
              onClick={() => navigate(`/inventory/receipts/${scan.id}`)}
            >
              <div className="flex items-center gap-3">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">{scan.merchant ?? 'Unknown merchant'}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(scan.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <Badge variant={STATUS_VARIANT[scan.status]}>{scan.status}</Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write the link manager**

Create `frontend/src/components/inventory/ReceiptLinkManager.tsx`. Mount it on the inventory settings surface — find where inventory settings live (grep `frontend/src/pages/settings/` for an inventory tab) and add it there.

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { receiptsApi } from '@/api/receipts';
import { useToast } from '@/components/ui/use-toast';

/**
 * A wrong learned mapping is invisible and self-perpetuating — it silently
 * auto-resolves every future scan of that product. This is the only place a
 * user can see or undo one.
 */
export function ReceiptLinkManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['receipt-links', search],
    queryFn: () => receiptsApi.listLinks(search ? { search } : undefined),
  });

  const forget = useMutation({
    mutationFn: (id: string) => receiptsApi.deleteLink(id),
    onSuccess: () => {
      toast({ title: 'Mapping forgotten' });
      queryClient.invalidateQueries({ queryKey: ['receipt-links'] });
    },
  });

  const links = data?.links ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Remembered receipt lines</h3>
        <p className="text-sm text-muted-foreground">
          Lines you've matched before. These are applied automatically on future scans.
        </p>
      </div>

      <Input
        placeholder="Search remembered lines…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing remembered yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Merchant</TableHead>
              <TableHead>Receipt line</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Conversion</TableHead>
              <TableHead>Used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((link) => (
              <TableRow key={link.id}>
                <TableCell>{link.merchant}</TableCell>
                <TableCell className="font-mono text-xs">
                  {link.lineKey}
                  <Badge variant="outline" className="ml-2">
                    {link.keyKind}
                  </Badge>
                </TableCell>
                <TableCell>{link.itemName}</TableCell>
                <TableCell>
                  1 → {Number(link.unitsPerCount)} {link.itemUnit ?? ''}
                </TableCell>
                <TableCell>{link.useCount}×</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => forget.mutate(link.id)}
                    aria-label={`Forget mapping for ${link.lineKey}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

Wrap the forget action in the codebase's `ConfirmDialog` if one exists on the branch you're building against — grep `frontend/src/components/` for it. Forgetting is cheap to redo, so a plain button is acceptable if there's no established pattern.

- [ ] **Step 8: Register the route and verify**

Add to `frontend/src/App.tsx`:

```tsx
<Route path="/inventory/receipts" element={<ReceiptsPage />} />
```

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipts.routes.ts backend/test/receipts/receipts.image.test.ts \
  frontend/src/api/receipts.ts frontend/src/pages/inventory/ReceiptScanPage.tsx \
  frontend/src/pages/inventory/ReceiptsPage.tsx \
  frontend/src/components/inventory/ReceiptLinkManager.tsx frontend/src/App.tsx
git commit -m "feat(receipts): receipt image panel, scan history, and link manager"
```

---

### Task 14: Cross-household isolation

**Files:**
- Create: `backend/test/receipts/tenancy.test.ts`

**Interfaces:**
- Consumes: every route from Tasks 7–9 and 13.
- Produces: nothing. This is the gate CLAUDE.md requires for new routes.

Every mutation is attempted by household A against household B's data and must 404 without side effects, each followed by a positive control proving the same call works within the caller's own household. Follow `backend/test/inventory/tenancy.test.ts` — read it first and mirror its structure.

- [ ] **Step 1: Write the test**

Create `backend/test/receipts/tenancy.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  inventoryAreas,
  inventoryItems,
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
} from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * Cross-household isolation for the receipts routes. A receipt scan carries a
 * household's purchase history and its learned mappings — a leak here would
 * expose what another household buys and let an attacker inject stock into
 * their inventory.
 */

let ctx: RouteTestContext;
let userA: TestUser;
let userB: TestUser;

// Household B fixtures (the victim)
let bScanId: string;
let bLineId: string;
let bLinkId: string;
let bItemId: string;

// Household A fixtures (positive controls)
let aScanId: string;
let aLineId: string;
let aItemId: string;
let aAreaId: string;

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

  const b = await seedHousehold(userB);
  bScanId = b.scanId;
  bLineId = b.lineId;
  bLinkId = b.linkId;
  bItemId = b.itemId;
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
    expect((await userA.fetch(`/api/v1/receipts/scans/${bScanId}/image`)).status).toBe(404);
  });

  it('never lists another household\'s scans', async () => {
    const res = await userA.fetch('/api/v1/receipts/scans');
    const body = await res.json();
    expect(body.data.scans.some((s: { id: string }) => s.id === bScanId)).toBe(false);
  });

  it('never lists another household\'s links', async () => {
    const res = await userA.fetch('/api/v1/receipts/links');
    const body = await res.json();
    expect(body.data.links.some((l: { id: string }) => l.id === bLinkId)).toBe(false);
  });
});

describe('receipts tenancy — mutations', () => {
  it('cannot edit another household\'s scan', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${bScanId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchant: 'Safeway' }),
        })
      ).status
    ).toBe(200);
  });

  it('cannot edit another household\'s line', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${bScanId}/lines/${bLineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'link', itemId: bItemId, unitsPerCount: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('cannot create an item against another household\'s line', async () => {
    const res = await userA.fetch(
      `/api/v1/receipts/scans/${bScanId}/lines/${bLineId}/create-item`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  });

  it('cannot delete another household\'s scan', async () => {
    const res = await userA.fetch(`/api/v1/receipts/scans/${bScanId}`, { method: 'DELETE' });
    expect(res.status).toBe(404);

    const scan = await db.query.receiptScans.findFirst({ where: eq(receiptScans.id, bScanId) });
    expect(scan).toBeDefined();
  });

  it('cannot repoint another household\'s link', async () => {
    const res = await userA.fetch(`/api/v1/receipts/links/${bLinkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
    const bArea = await db.query.inventoryAreas.findFirst({
      where: eq(inventoryAreas.householdId, userB.householdId),
    });

    const res = await userA.fetch(`/api/v1/receipts/scans/${aScanId}/lines/${aLineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetAreaId: bArea!.id }),
    });
    expect(res.status).toBe(404);

    // Positive control with the caller's own area.
    expect(
      (
        await userA.fetch(`/api/v1/receipts/scans/${aScanId}/lines/${aLineId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetAreaId: aAreaId }),
        })
      ).status
    ).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd backend && npx vitest run test/receipts/tenancy.test.ts`
Expected: PASS, 15 tests.

Any failure here is a real security bug, not a test to adjust. The usual cause is a route reading a row by id before filtering on `householdId` — fix the route.

- [ ] **Step 3: Run the full suite**

Run: `cd backend && npm test && cd ../frontend && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add backend/test/receipts/tenancy.test.ts
git commit -m "test(receipts): cross-household isolation for scans, lines, and links"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin receipt-ocr-import
gh pr create --title "Receipt OCR → inventory import" --body "$(cat <<'EOF'
Photograph a grocery receipt and turn it into inventory stock. Tesseract
transcribes, the local LLM structures the lines, and each line resolves against
learned links, then aliases, then fuzzy matching.

Confirmed matches are saved as (merchant, line_key) -> item mappings with a
conversion factor, so the second scan of the same shop is near zero-decision.
Costco's item numbers make those mappings exact.

Design: docs/superpowers/specs/2026-08-08-receipt-ocr-inventory-import-design.md
Plan: docs/superpowers/plans/2026-08-08-receipt-ocr-inventory-import.md

Also drops the dead receipt_scans table flagged for deletion in 0008.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01NGHSbYTTSbKsAp88Fd6EGb
EOF
)"
```

---

## Deferred / out of scope

Named here so they aren't mistaken for oversights — all from the spec's out-of-scope list:

- Barcode scanning (`inventory_items.barcode` exists but nothing populates it)
- CSV / spreadsheet import
- Digital receipt ingestion (costco.com shopping history, emailed receipts)
- Cross-household or community-shared line mappings
- Spend reporting beyond `inventory_stock.pricePerUnit`

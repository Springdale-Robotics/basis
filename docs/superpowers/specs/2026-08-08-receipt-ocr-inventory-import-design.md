# Receipt OCR → Inventory Import

**Date:** 2026-08-08
**Status:** Design approved, not implemented

## Problem

The only bulk path into the inventory catalog today is manual typing. `POST
/api/v1/inventory/items/batch` accepts 1–50 items and `BulkAddDialog` offers a
table and a paste-a-list tab, but every item still has to be entered by hand,
and the endpoint creates catalog entries only — never stock. There is no file
import, no OCR path into inventory, and no barcode scanning.

We want to photograph a grocery receipt and have it become stock, with the
matching effort paid once per product rather than once per shopping trip.

## Prior art in the repo

Three things already exist and shape the design:

- **A dead `receipt_scans` table** (`backend/src/db/schema/inventory.ts:227`)
  with roughly this shape and zero code references.
  `drizzle/0008_rls_all_tables.sql:21` marks it "slated for deletion." We drop
  it rather than revive it: `imageData` is a base64 blob in a text column, and
  it has no merchant, no per-line code, and nowhere to record a conversion.
- **A matching engine.** `recipes/ingredient-matching.service.ts` scores
  normalize → synonym → substring → token-overlap → Levenshtein and returns
  ranked suggestions with a `matchReason`. `matchSingleIngredient()` is reused
  directly.
- **An OCR pipeline.** `image-parse/` has session lifecycle, a provider
  abstraction (HandwritingOCR API, VLM+LLM via Ollama), and a BullMQ worker.
  We reuse the provider layer and the worker pattern.

## Research: there is no Costco item database

Costco receipts print an internal item number plus a heavily abbreviated
description (`KS ORG EVOO`). Costco publishes no key to either. The only
sources are paid scrapers (Unwrangle) and GitHub scrapers of costco.com. Open
Food Facts is free and large but keyed on UPC/EAN barcodes, which Costco
receipts do not print — so it cannot resolve a receipt line.

The item number is, however, an exact and stable identifier. Keying learned
mappings on `(merchant, item number)` makes the household's own confirmed
links more reliable than any scraped database would be. **The learned mappings
are the database.**

## Decisions

| Decision | Choice |
|---|---|
| What confirm does | Adds stock, creating catalog items as needed |
| Receipt quantity | A unitless count. The parser never infers pack size from line text |
| Pack sizes | A one-time conversion on the *link*, not a pack-size variant item |
| Missing conversion | Blocks confirm |
| Merchant handling | Generic extraction plus a merchant tag; code used as the key when present |
| OCR | Tesseract for transcription, existing LLM for structuring |
| Module | New `receipts` module reusing the `image-parse` provider layer |

### Why not pack-size variant items

Storing "2-pack of X" and "12-pack of X" as separate catalog items would let
the receipt's intermediate unit survive into the catalog and fragment it. So
the conversion lives on the link: stock is always written in the item's
`defaultUnit`. Where the user hasn't supplied the conversion, we cannot guess
with enough certainty, so confirm blocks.

### Why blocking confirm is workable

Every line must be *resolved* — linked with a conversion, or explicitly
ignored — so a line can be dismissed but never left silently undecided. Because
links are learned, the cost is paid once per product: the first Costco run is
~40 decisions, subsequent runs are near zero.

### Why a new module (Approach A)

An image-parse session is a short-lived, one-shot "picture → entity" with a
hard `expiresAt`. A receipt review is decision-heavy across dozens of lines and
must survive being abandoned and resumed. `image-parse.service.ts` is already
821 lines with a four-way switch in both `updateContent` and `confirmSession`;
receipts would be the largest branch by far. Adding a receipt type would also
give `type-detector.ts` a new way to be wrong, and a receipt misrouted to
`list` is a confusing failure.

Rejected alternatives: a fifth type inside `image-parse` (cheapest, but the
session table has no home for per-line link decisions and expiry fights the
review flow); a fully standalone module with its own OCR (clean boundary, but
discards a working provider abstraction and creates two answers to "how do I
read an image").

## Data model

Three new tables replace the dropped `receipt_scans`.

### `receipt_scans`

One row per scanned image.

`id`, `household_id`, `scanned_by`, `image_path`, `merchant` (extracted,
user-editable), `purchased_at`, `raw_ocr_text`, `status`
(`processing｜review｜confirmed｜cancelled｜failed`), `processing_stage`,
`parse_warnings` jsonb, `error_message`, `default_area_id`, `created_at`,
`updated_at`, `confirmed_at`.

### `receipt_scan_lines`

One row per receipt line — real rows rather than the old jsonb blob, because
the review screen edits each one and they need a real FK to `inventory_items`.

- From OCR: `line_index`, `raw_text`, `merchant_code` (null where the merchant
  prints none), `count` (unitless), `price`, `ocr_confidence`
- From review: `resolution` (`unresolved｜link｜ignore`), `item_id`,
  `units_per_count`, `target_area_id`
- `household_id` denormalized so RLS can police it directly

There is no `create` resolution. "Create item" calls the existing
`/items/quick-create` immediately and links the line, collapsing creation into
`link`. This keeps one code path for confirm and preserves partial work.
Tradeoff: abandoning a scan can leave a catalog item with no stock — harmless,
and explicitly requested by the user.

### `receipt_line_links`

The learned mapping, and the point of the feature.

`household_id`, `merchant` (normalized), `line_key`, `key_kind`
(`code｜text`), `item_id`, `units_per_count`, `use_count`, `last_used_at`,
unique on `(household_id, merchant, line_key)`.

`line_key` is `merchant_code` when present, else the normalized `raw_text`.
Code-keyed links are exact and stable — a dictionary lookup forever after.
Text-keyed links are exact-match on normalized text: narrower, still correct
when they hit.

Deliberately not reusing `ingredient_aliases`: it has no factor column, and its
`(household, alias_name)` uniqueness is household-wide, which would collide the
same description across two merchants.

## Pipeline

`receipts.worker.ts` → `receipts.service.ts`, mirroring `image-parse.worker.ts`.

1. **Upload** — image written to `STORAGE_PATH/receipts/<scanId>.<ext>`, row
   created `status=processing`, BullMQ job enqueued.
2. **`ocr`** — Tesseract transcribes into `raw_ocr_text`.
3. **`structuring`** — the existing Ollama LLM client produces
   `{merchant, purchasedAt, lines[{rawText, code?, count, price?}]}`. The LLM
   only sees text Tesseract read, so it can reorganize but not invent.
4. **`matching`** — each line resolved, then `status=review`.

### Line matching precedence

| Order | Source | Result |
|---|---|---|
| 1 | `receipt_line_links` on `(merchant, line_key)` | **auto-resolved**, item + conversion prefilled |
| 2 | `ingredient_aliases` on expanded text | suggestion @ 0.92, stays unresolved (no factor known) |
| 3 | `matchSingleIngredient()` fuzzy | top-5 ranked suggestions, unresolved |
| 4 | nothing | unresolved and empty — user searches or creates |

Only tier 1 auto-resolves.

### `receipt-line-normalizer.ts`

Strips leading item numbers and trailing `A`/`E` tax flags, expands an
abbreviation dictionary (`KS`→Kirkland Signature, `ORG`→organic,
`CHKN`→chicken), then hands off to the existing `normalizeIngredientName`.
Without it, `KS ORG EVOO` scores near zero against `olive oil`.

## API

All routes under `/api/v1/receipts`, behind `requireInventoryAccess('edit')`.

```
POST   /scans                                multipart → {id, status}
GET    /scans                                list, filter by status
GET    /scans/:id                            full scan + lines + suggestions
PATCH  /scans/:id                            merchant, purchasedAt, defaultAreaId
PATCH  /scans/:id/lines/:lineId              resolution, itemId, unitsPerCount, targetAreaId, count, price
POST   /scans/:id/lines/:lineId/create-item  quick-create + link, one round trip
POST   /scans/:id/reprocess                  retry after a failed parse
POST   /scans/:id/confirm
DELETE /scans/:id
GET    /scans/:id/status                     lightweight progress poll ({status, processingStage}) while parsing
GET    /status                               OCR/LLM provider availability
GET    /links   ·   PATCH /links/:id   ·   DELETE /links/:id
```

The `/links` endpoints matter more than they look: a wrong learned mapping is
invisible and self-perpetuating, silently auto-resolving every future scan.
Users need somewhere to see and forget them.

### Confirm

One transaction.

- 400 if any line is `unresolved`, if `merchant` is blank (it is half the link
  key), or if any line resolves to no area — each returning the offending line
  ids. Unlike `/shopping-list/put-away`, which silently skips these, confirm
  refuses.
- Per linked line: insert `inventory_stock` with
  `quantity = count × units_per_count`, `unit = item.defaultUnit`,
  `source='purchase'`, `pricePerUnit = price / quantity`,
  `addedAt = purchased_at`.
- Upsert the link on `(household, merchant, line_key)`, updating `item_id` and
  `units_per_count`, bumping `use_count`. Ignored lines write neither stock nor
  a link — ignoring is a per-scan decision, not a learned one, so the same
  product will surface again next time rather than being silently dropped
  forever.
- `status='confirmed'`, emit the inventory event. Re-confirming returns 409.

Area resolution follows put-away's precedence: line `target_area_id` → item
`defaultAreaId` → scan `default_area_id`.

## Review UI

A dedicated route rather than a dialog — a modal works for "confirm one
recipe," but a 40-line receipt needs scroll, grouping, and resumability.

**`/inventory/receipts/:id`** — `ReceiptScanPage.tsx`

- **Header:** merchant (editable, required), purchase date, default storage
  area, resolved counter ("38 of 40 resolved")
- **Body, grouped by what needs attention:** *Needs attention* (unresolved,
  open by default), *Auto-matched* (collapsed with a count), *Ignored*
  (collapsed). This grouping is the ergonomics of the feature — a repeat run
  should open showing two rows, not forty.
- **Unresolved row:** raw line text, item code, count and price on the left;
  top three suggestions as chips with confidence and `matchReason` badge, an
  item search combobox, **Create item**, and **Ignore** on the right
- **Matched row:** the item, the conversion inline
  (`1 × KS ORG EVOO = [ 2 ] bottle`, suffixed with the item's `defaultUnit`),
  an area override, and unlink
- **Image panel:** the receipt photo alongside, since OCR errors are only
  catchable against the original. Closest existing pattern is the bug-report
  screenshot viewer (commit `7115423`).
- **Sticky footer:** confirm, disabled while anything is unresolved, naming
  what blocks it

**Supporting pieces:**

- `ReceiptUploadDialog.tsx` — capture/upload and processing progress,
  mirroring `ImageParseDialog` and the `useBatchImageProcessing` polling hook
- A "Scan Receipt" button beside Bulk Add on `InventoryPage` (`:1241`)
- `ReceiptsPage.tsx` — scan history, so an interrupted review is findable
- `ReceiptLinkManager` — learned mappings in inventory settings
- `frontend/src/api/receipts.ts` alongside the other domain modules

Reused as-is: `AreaCombobox`, `CategoryCombobox`, `UnitCombobox` from
`fields.tsx`, and `/items/quick-create` behind the Create action.

## Error handling

| Failure | Behavior |
|---|---|
| Tesseract returns nothing usable | `status=failed` + warning; `POST /scans/:id/reprocess` to retry |
| LLM unavailable | `status=failed` with a clear message; `GET /receipts/status` lets the UI disable the entry point up front |
| Low per-line OCR confidence | Surfaced and flagged in review. Auto-resolve allowed for `key_kind='code'` links, withheld for `key_kind='text'` links below threshold — a misread description must not silently ride a learned link into stock |
| Linked item deleted | FK cascade removes the link |
| Store changed pack size | User edits the conversion at review; confirm's upsert overwrites the stored factor |
| Same receipt scanned twice | Warning at review when merchant + date match a confirmed scan. A warning, not a block — same-day repeat trips happen |
| Review abandoned | Stays in `review` indefinitely (no hard expiry, unlike image-parse — resumability is the point); `cleanup.worker` sweeps after 30 days. Images deleted 7 days post-confirm; `raw_ocr_text` kept |

## Dependency: tesseract.js

Use `tesseract.js` (WASM, pure npm) over `node-tesseract-ocr` (system binary).
Prod is a native systemd install with a guided installer; a system package
means installer changes and a new way for installs to fail. tesseract.js costs
memory and speed in exchange for installing like any other dependency.

## Migration

Hand-authored as `0010_receipt_scanning.sql` plus journal and snapshot entries,
since drizzle-kit generate is broken on this repo's ESM specifiers.

Order matters. Dropping a table does not drop its enum type, and the existing
`receipt_scan_status` type has different values (`processing`,
`pending_review`, `confirmed`, `cancelled`) from the ones we need. So:

1. `DROP TABLE receipt_scans`
2. `DROP TYPE receipt_scan_status`, then recreate it with
   `processing｜review｜confirmed｜cancelled｜failed`
3. `CREATE TYPE receipt_line_resolution` as `unresolved｜link｜ignore`
4. Create the three tables and their indexes
5. Add RLS policies for all three following the `0008_rls_all_tables.sql`
   pattern — every one is household-scoped

Column types: `count` and `units_per_count` are `decimal(10,3)`, matching
`inventory_stock.quantity`. `count` is decimal rather than integer because
some merchants price by weight and print a fractional quantity; it stays
unitless either way, and the conversion still applies unchanged.

## Testing

- **Unit:** normalizer (abbreviation expansion, tax-flag and item-number
  stripping); matching precedence (link > alias > fuzzy); conversion and
  price-per-unit math
- **Integration:** confirm writes correct stock and upserts links; a second
  scan of the same receipt auto-resolves end to end; confirm returns 400 with
  offending line ids on unresolved / blank-merchant / no-area, and 409 on
  re-confirm
- **Tenancy:** `backend/test/receipts/tenancy.test.ts`, following
  `backend/test/inventory/tenancy.test.ts`
- **RLS:** a check in `backend/test/rls/` covering the three tables

Tests run against frozen `raw_ocr_text` fixtures, not images. Structuring and
matching are the logic worth regression-testing and they should be
deterministic. Tesseract accuracy gets one separate, optionally-skipped test
with a sample image — otherwise every CI run is hostage to a WASM OCR engine.

## Out of scope

- Barcode scanning (the `barcode` column exists but nothing populates it)
- CSV/spreadsheet import
- Digital receipt ingestion (costco.com shopping history, emailed receipts)
- Cross-household or community-shared line mappings
- Price history and spend reporting beyond `inventory_stock.pricePerUnit`

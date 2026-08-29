# Google Calendar Sync — Phase 2: Two-Way Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a household edit a Google-synced calendar in Basis — from the web app or from their phone's calendar app over CalDAV — and have the change appear in Google.

**Architecture:** The three outbound functions in `google-sync.service.ts` already exist and have never been called. Rather than hooking every route that writes an event, outbound work is *discovered* from database state and from the change journal the Postgres triggers already write: a row with no `external_id` has never been to Google, a row whose `updated_at` is newer than its `remote_updated` has been edited locally since Google last saw it, and deletes come off the `calendar_changes` journal. That catches all three write paths — REST, CalDAV, and anything added later — without a single per-route hook.

**Tech Stack:** Fastify + TypeScript, Drizzle ORM, PostgreSQL (triggers in hand-authored SQL), BullMQ + Redis, vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-google-calendar-sync-design.md` — read "The sync engine" in full before starting, and "What the repo has today" for why the discovery is shaped this way.

**Prerequisite:** Phase 1 (`2026-08-28-gcal-phase1-relay.md`) is not a hard dependency — this phase changes no OAuth code — but connecting a calendar to test with is far easier once it has shipped.

## Global Constraints

- **`drizzle-kit generate` is broken in this repo** — it emits ESM `.js` specifiers it then cannot read. **Every migration in this plan is hand-authored**, three files each: the `.sql` in `backend/drizzle/`, an entry appended to `backend/drizzle/meta/_journal.json`, and a `backend/drizzle/meta/NNNN_snapshot.json`. Do not run `npm run db:generate`. This is the single most likely way to get stuck; the migration tasks restate it.
- **Migrations are idempotent.** Follow `0004_calendar_sync_triggers.sql`: `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`, `ADD COLUMN IF NOT EXISTS`.
- **Multi-tenancy:** every query filters by `householdId` from `request.user!.householdId`, and caller-supplied ids are verified against it. New household-scoped tables need an RLS policy following `drizzle/0008_rls_all_tables.sql` plus a check in `backend/test/rls/`. *This plan adds no tables* — only columns on existing ones, which the existing policies already cover.
- **Workers run as the DB owner and bypass RLS by design.** The outbound worker is a worker: it must filter by calendar explicitly, because nothing else will.
- **User-facing copy says "Basis"**, never "homemanager".
- **Deploys are repo → deploy.** Steps marked **[OPS]** are for the owner.

## Out of Scope

- **basis#101** — the CalDAV handlers' missing `isReadOnly` check. This phase supersedes it (the answer becomes "CalDAV writes sync" rather than "CalDAV writes are refused"), but do not attempt an interim fix here; it ships on its own timeline.
- **Outlook stays read-only.** It has no outbound path, and unlocking it would recreate basis#101 on a different provider. Every unlock in this plan is conditional on `sync_provider = 'google'`.
- Per-occurrence edits of a synced recurring series going outbound. Masters sync; editing one occurrence of a synced series is v2. Inbound already handles master/exception.
- Attendee/RSVP sync, reminder sync, calendar ACL sync, and any conflict-resolution UI.
- Push notifications. Paid tier, phase 3.
- **ICS import into a synced calendar** — see Task 5, which deliberately keeps it refused.

---

### Task 1: Schema and triggers

Four schema changes and a trigger rewrite, in one migration because the trigger rewrite depends on the new columns.

The trigger work is the delicate part. `sync-reconcile.ts` documents what happens when it goes wrong: unconditional rewrites "bumped each row's revision via the CalDAV triggers, churning ETags (clients re-download everything) and appending unbounded `calendar_changes` journal rows." A write that touches only `remote_updated` would today do exactly that — twice per outbound push, once for the user's edit and once for recording what Google returned. Both triggers must ignore it.

The journal also has to start carrying `external_id`. It currently records `COALESCE(recurring_event_id, id)` and a change type; on a delete the row is gone and `external_id` with it, so there would be nothing to call `deleteGoogleEvent` with.

**Note this migration does NOT unlock anything.** It is pure schema and safe to deploy at any time. The `is_read_only` flip is a separate migration in Task 5, deliberately ordered last — flipping it before the outbound worker exists would give every existing Google calendar editable status with no path to Google, which is basis#101 across the whole fleet, by migration.

**Files:**
- Create: `backend/drizzle/0018_calendar_outbound_sync.sql`
- Modify: `backend/drizzle/meta/_journal.json`
- Create: `backend/drizzle/meta/0018_snapshot.json`
- Modify: `backend/src/db/schema/calendars.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, relied on by every later task:
  - `calendarEvents.remoteUpdated` → `remote_updated timestamp` (nullable)
  - `calendarChanges.externalId` → `external_id varchar(255)` (nullable)
  - `calendars.outboundCursor` → `outbound_cursor integer NOT NULL DEFAULT 0` — the highest `calendar_changes.sync_token` the outbound worker has processed for this calendar.
  - `calendars.lastOutboundAt` → `last_outbound_at timestamp` (nullable) — when this calendar last pushed anything.

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/outbound-triggers.test.ts`. This tests database behaviour, so it needs a live DB — the same one the rest of `backend/test` uses.

```typescript
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  calendarChanges,
  calendarEvents,
  calendars,
  households,
} from '../../src/db/schema/index.js';

let householdId: string;
let calendarId: string;

beforeAll(async () => {
  const [household] = await db
    .insert(households)
    .values({ name: `trigger-test-${randomUUID()}` })
    .returning();
  householdId = household.id;

  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Trigger fixture',
      type: 'synced',
      isSynced: true,
      syncProvider: 'google',
      syncCalendarId: 'fixture@group.calendar.google.com',
    })
    .returning();
  calendarId = calendar.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

async function makeEvent(externalId: string | null) {
  const [event] = await db
    .insert(calendarEvents)
    .values({
      calendarId,
      title: 'Fixture',
      startTime: new Date('2026-09-01T10:00:00Z'),
      endTime: new Date('2026-09-01T11:00:00Z'),
      externalId,
    })
    .returning();
  return event;
}

describe('calendar triggers and remote_updated', () => {
  it('ignores a remote_updated-only update: no revision bump, no journal row', async () => {
    const event = await makeEvent('google-event-1');
    const before = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    const journalBefore = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendarId));

    await db
      .update(calendarEvents)
      .set({ remoteUpdated: new Date('2026-08-28T12:00:00Z') })
      .where(eq(calendarEvents.id, event.id));

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    const calAfter = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    const journalAfter = await db
      .select()
      .from(calendarChanges)
      .where(eq(calendarChanges.calendarId, calendarId));

    expect(after!.revision).toBe(event.revision);
    expect(calAfter!.syncToken).toBe(before!.syncToken);
    expect(calAfter!.ctag).toBe(before!.ctag);
    expect(journalAfter.length).toBe(journalBefore.length);
  });

  it('still bumps revision when a real field changes alongside remote_updated', async () => {
    const event = await makeEvent('google-event-2');

    await db
      .update(calendarEvents)
      .set({ title: 'Changed', remoteUpdated: new Date('2026-08-28T12:00:00Z') })
      .where(eq(calendarEvents.id, event.id));

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    expect(after!.revision).toBeGreaterThan(event.revision);
  });

  it('captures external_id onto the journal row when an event is deleted', async () => {
    const event = await makeEvent('google-event-3');

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const [row] = await db
      .select()
      .from(calendarChanges)
      .where(
        and(eq(calendarChanges.calendarId, calendarId), eq(calendarChanges.changeType, 'delete'))
      )
      .orderBy(desc(calendarChanges.syncToken))
      .limit(1);

    expect(row.externalId).toBe('google-event-3');
  });

  it('leaves external_id null on the journal row for a local-only event', async () => {
    const event = await makeEvent(null);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const [row] = await db
      .select()
      .from(calendarChanges)
      .where(
        and(eq(calendarChanges.calendarId, calendarId), eq(calendarChanges.changeType, 'delete'))
      )
      .orderBy(desc(calendarChanges.syncToken))
      .limit(1);

    expect(row.externalId).toBeNull();
  });

  it('has an outbound cursor on every calendar, starting at zero', async () => {
    const calendar = await db.query.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    expect(calendar!.outboundCursor).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/calendars/outbound-triggers.test.ts`
Expected: FAIL — `remoteUpdated` does not exist on the insert type, and the columns are missing.

- [ ] **Step 3: Write the migration SQL**

**Hand-author this. Do not run `npm run db:generate`** — `drizzle-kit generate` is broken in this repo.

Create `backend/drizzle/0018_calendar_outbound_sync.sql`:

```sql
-- Two-way Google Calendar sync: the columns and trigger behaviour the
-- outbound path needs.
--
-- remote_updated is Google's `updated` timestamp for an event, stored on
-- every push and every pull. It is what tells a pull "this row is already
-- what Google has, skip it", and what tells the outbound sweep "this row has
-- been edited locally since Google last saw it" (updated_at > remote_updated).
--
-- calendar_changes.external_id exists because a delete destroys the row, and
-- with it the only handle Google knows the event by. The journal is how the
-- outbound sweep learns about deletes at all, so the id has to be captured
-- on the way past.
--
-- calendars.outbound_cursor is how far through that journal the outbound
-- worker has read. The journal is also consumed by CalDAV's sync-token
-- replay, so rows are never deleted by the worker — only walked.
--
-- This migration changes no calendar's is_read_only. Unlocking happens in a
-- later migration, after the outbound worker exists; unlocking first would
-- make every existing Google calendar editable with nowhere for the edits to
-- go.

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS remote_updated timestamp;
--> statement-breakpoint
ALTER TABLE calendar_changes ADD COLUMN IF NOT EXISTS external_id varchar(255);
--> statement-breakpoint
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS outbound_cursor integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- When this calendar last had local changes pushed. Read by the five-minute
-- tick to decide which calendars are "active". It cannot be derived from
-- calendars.updated_at, which the sync trigger bumps for the pull's own
-- writes too, nor from "has unpushed work", which goes false the instant the
-- sweep succeeds — collapsing the spec's one-hour window to one sweep.
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS last_outbound_at timestamp;
--> statement-breakpoint

-- Discovery index: the outbound sweep asks each synced calendar for rows that
-- have never been to Google, or have changed since they last were.
CREATE INDEX IF NOT EXISTS calendar_events_outbound_idx
  ON calendar_events (calendar_id, external_id, remote_updated);
--> statement-breakpoint

-- The sweep walks the journal from the calendar's cursor forward.
CREATE INDEX IF NOT EXISTS calendar_changes_outbound_idx
  ON calendar_changes (calendar_id, sync_token);
--> statement-breakpoint

-- Replaces the function from 0004. Two changes:
--   1. A write that touches only remote_updated is invisible: no sync_token
--      bump, no ctag reroll, no journal row. Otherwise every outbound push
--      would re-sync every subscribed CalDAV client and grow the journal
--      without bound — the exact trap sync-reconcile.ts documents.
--   2. Delete rows carry OLD.external_id.
CREATE OR REPLACE FUNCTION calendar_event_sync_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
DECLARE
  new_token integer;
  resource_uid uuid;
  cal_id uuid;
  op_type calendar_change_type;
  ext_id varchar(255);
BEGIN
  -- A write that touches only remote_updated changes nothing a client could
  -- observe, so it must not bump the token, reroll the ctag, or journal a
  -- row. Comparing the rows as jsonb with that one key removed keeps this
  -- correct as columns are added later, and needs no extension.
  IF TG_OP = 'UPDATE'
     AND NEW.remote_updated IS DISTINCT FROM OLD.remote_updated
     AND (to_jsonb(NEW) - 'remote_updated') = (to_jsonb(OLD) - 'remote_updated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    cal_id := OLD.calendar_id;
    resource_uid := COALESCE(OLD.recurring_event_id, OLD.id);
    op_type := 'delete';
    ext_id := OLD.external_id;
  ELSE
    cal_id := NEW.calendar_id;
    resource_uid := COALESCE(NEW.recurring_event_id, NEW.id);
    op_type := CASE WHEN TG_OP = 'INSERT' THEN 'add'::calendar_change_type
                    ELSE 'update'::calendar_change_type END;
    ext_id := NEW.external_id;
  END IF;

  UPDATE calendars
  SET sync_token = sync_token + 1,
      ctag = md5(random()::text),
      updated_at = now()
  WHERE id = cal_id
  RETURNING sync_token INTO new_token;

  INSERT INTO calendar_changes (calendar_id, event_uid, change_type, sync_token, external_id)
  VALUES (cal_id, resource_uid::text, op_type, new_token, ext_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
--> statement-breakpoint

-- Replaces the function from 0004: a remote_updated-only write must not bump
-- the revision, because revision is what CalDAV ETags are built from and a
-- bump makes every subscribed client re-download the event.
CREATE OR REPLACE FUNCTION calendar_event_revision_bump()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
  -- Same guard as the sync trigger, for the same reason: revision is what
  -- CalDAV ETags are built from, and a bump makes every subscribed client
  -- re-download the event.
  IF NEW.remote_updated IS DISTINCT FROM OLD.remote_updated
     AND (to_jsonb(NEW) - 'remote_updated') = (to_jsonb(OLD) - 'remote_updated') THEN
    RETURN NEW;
  END IF;

  IF OLD.revision = NEW.revision THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$function$;
```

A note on that guard, since it is the subtle part. Postgres cannot mask one column out of a whole-row comparison without an extension, so the rows are compared as `jsonb` with the key removed. Write `to_jsonb(NEW)`, **not** `to_jsonb(NEW.*)` — in PL/pgSQL, `NEW` is a record variable and the `.*` expansion is not valid in an expression there.

Confirm it parses before going further:

```bash
./dev.sh db
```

then paste the `CREATE OR REPLACE FUNCTION calendar_event_revision_bump()` block. A syntax error surfaces immediately; a clean `CREATE FUNCTION` means the form is right. Step 7 exercises the behaviour.

- [ ] **Step 4: Register the migration in the journal**

Append to the `entries` array in `backend/drizzle/meta/_journal.json`, after the `0017_scan_label` entry. `when` is epoch milliseconds; use `1787106000000` (2026-08-28).

```json
  {
   "idx": 18,
   "version": "7",
   "when": 1787106000000,
   "tag": "0018_calendar_outbound_sync",
   "breakpoints": true
  }
```

- [ ] **Step 5: Create the snapshot**

Copy `backend/drizzle/meta/0017_snapshot.json` to `backend/drizzle/meta/0018_snapshot.json`, then hand-edit it to add the three columns. Change the snapshot's own `id` to a fresh UUID and set `prevId` to the `id` value from `0017_snapshot.json`.

In the `calendar_events` table's `columns` object add:

```json
        "remote_updated": {
          "name": "remote_updated",
          "type": "timestamp",
          "primaryKey": false,
          "notNull": false
        },
```

In `calendar_changes`:

```json
        "external_id": {
          "name": "external_id",
          "type": "varchar(255)",
          "primaryKey": false,
          "notNull": false
        },
```

In `calendars`:

```json
        "outbound_cursor": {
          "name": "outbound_cursor",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "last_outbound_at": {
          "name": "last_outbound_at",
          "type": "timestamp",
          "primaryKey": false,
          "notNull": false
        },
```

- [ ] **Step 6: Add the columns to the Drizzle schema**

In `backend/src/db/schema/calendars.ts`:

In the `calendarEvents` table, beside `externalId`:

```typescript
  // Google's `updated` timestamp for this event, stored on every push and
  // every pull. A row whose updatedAt is newer has been edited locally since
  // Google last saw it — that is how the outbound sweep finds work.
  remoteUpdated: timestamp('remote_updated'),
```

In `calendarChanges`, beside `eventUid`:

```typescript
  // The provider's id for the event, captured on delete rows only — the row
  // itself is gone by the time the outbound sweep reads this, so this is the
  // only handle left to delete it at the provider by.
  externalId: varchar('external_id', { length: 255 }),
```

In `calendars`, beside `syncToken`:

```typescript
  // How far the outbound sweep has read this calendar's change journal.
  outboundCursor: integer('outbound_cursor').notNull().default(0),
  // When the sweep last pushed anything for this calendar. Drives the
  // five-minute polling tick; see shouldSyncOnActiveTick.
  lastOutboundAt: timestamp('last_outbound_at'),
```

- [ ] **Step 7: Run the migration and the tests**

```bash
cd backend && npm run db:migrate && npx vitest run test/calendars/outbound-triggers.test.ts
```

Expected: migration applies cleanly, all five tests PASS.

If the `remote_updated`-only test fails with the revision still bumping, the `to_jsonb` guard is in the wrong place or the `IS DISTINCT FROM` operands are reversed. Inspect the live function with `\sf calendar_event_revision_bump` in `./dev.sh db`.

- [ ] **Step 8: Verify nothing else regressed**

Run: `cd backend && npx vitest run test/caldav/ test/calendars/`
Expected: PASS. The CalDAV suite is the one that would notice a broken trigger — it asserts on ETags and sync tokens.

- [ ] **Step 9: Commit**

```bash
git add backend/drizzle/0018_calendar_outbound_sync.sql backend/drizzle/meta/_journal.json backend/drizzle/meta/0018_snapshot.json backend/src/db/schema/calendars.ts backend/test/calendars/outbound-triggers.test.ts
git commit -m "feat(calendars): schema and triggers for outbound sync

remote_updated on events, external_id on the change journal, and an
outbound cursor per calendar. Both calendar triggers now ignore a write
that touches only remote_updated — otherwise every push would bump the
revision, re-syncing every CalDAV client, and append a journal row.

No calendar is unlocked by this migration."
```

---

### Task 2: Echo suppression on the pull

A change pushed to Google comes straight back on the next pull looking like a remote change. `remote_updated` is what breaks that loop: after a push it equals Google's timestamp, so the pull recognises the row as already current.

There is a second, sharper loop to close in the same task. The pull's insert path lets `updated_at` default to `now()`, while `remote_updated` gets Google's `updated` — which is in the past. So `updated_at > remote_updated` is immediately true and every freshly pulled event would look locally edited and be pushed straight back. **The pull's inserts must set `updatedAt` explicitly to the same instant as `remoteUpdated`.**

The pull's *updates* are already safe: `syncCalendarFromGoogle` does `.set(eventData)`, which does not include `updatedAt`, so a pull leaves it at whatever the last local edit set. That is the behaviour the invariant needs — do not "fix" it.

**Files:**
- Modify: `backend/src/modules/calendars/google-sync.service.ts` (the insert at ~323, the update at ~318, the exception insert at ~395)
- Modify: `backend/src/modules/calendars/sync-reconcile.ts` (`syncedEventUnchanged`)
- Test: `backend/test/calendars/echo-suppression.test.ts`

**Interfaces:**
- Consumes: `calendarEvents.remoteUpdated` (Task 1).
- Produces: the invariant every later task depends on —
  `updated_at > remote_updated` ⟺ this row has local edits Google has not seen.
  `external_id IS NULL` ⟺ this row has never been to Google.

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/echo-suppression.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { syncedEventUnchanged } from '../../src/modules/calendars/sync-reconcile.js';

const base = {
  title: 'Standup',
  description: null,
  location: null,
  startTime: new Date('2026-09-01T09:00:00Z'),
  endTime: new Date('2026-09-01T09:15:00Z'),
  allDay: false,
  externalId: 'g-1',
};

describe('syncedEventUnchanged with remote_updated', () => {
  it('treats a row whose remote_updated matches Google as unchanged', () => {
    const stamp = new Date('2026-08-28T12:00:00Z');
    expect(
      syncedEventUnchanged({ ...base, remoteUpdated: stamp }, { ...base, remoteUpdated: stamp })
    ).toBe(true);
  });

  it('treats a newer Google timestamp as changed even if fields look equal', () => {
    expect(
      syncedEventUnchanged(
        { ...base, remoteUpdated: new Date('2026-08-28T12:00:00Z') },
        { ...base, remoteUpdated: new Date('2026-08-28T13:00:00Z') }
      )
    ).toBe(false);
  });

  it('still detects a field change when the timestamps agree', () => {
    const stamp = new Date('2026-08-28T12:00:00Z');
    expect(
      syncedEventUnchanged(
        { ...base, remoteUpdated: stamp },
        { ...base, title: 'Standup (moved)', remoteUpdated: stamp }
      )
    ).toBe(false);
  });

  it('treats a row that has never been pulled as changed', () => {
    expect(
      syncedEventUnchanged(
        { ...base, remoteUpdated: null },
        { ...base, remoteUpdated: new Date('2026-08-28T12:00:00Z') }
      )
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/calendars/echo-suppression.test.ts`
Expected: FAIL — `remoteUpdated` is not part of the compared shape, so the second test returns `true`.

- [ ] **Step 3: Teach the comparison about remote_updated**

In `backend/src/modules/calendars/sync-reconcile.ts`, add `remoteUpdated` to both the `SyncedEventRow` and `IncomingEventData` interfaces:

```typescript
  remoteUpdated?: Date | null;
```

Then, in `syncedEventUnchanged`, compare it first — a differing provider timestamp means the provider changed something, whether or not the fields Basis mirrors happen to differ:

```typescript
  // Google's own `updated` stamp is the authoritative "did anything change
  // over there" signal, including changes to fields Basis does not mirror.
  if (!sameInstant(existing.remoteUpdated, incoming.remoteUpdated)) {
    return false;
  }
```

Place it at the top of the function body, before the field comparisons. `sameInstant` already handles the null cases.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/calendars/echo-suppression.test.ts`
Expected: PASS.

- [ ] **Step 5: Store Google's timestamp on every pull**

In `backend/src/modules/calendars/google-sync.service.ts`, in `syncCalendarFromGoogle`, the `eventData` object built for each Google event (around line 306, where `externalId: googleEvent.id` is set) gains:

```typescript
      remoteUpdated: googleEvent.updated ? new Date(googleEvent.updated) : null,
```

Do the same for the exception/recurrence `eventData` built around line 381.

Then, at **the insert sites only** (around lines 323 and 395), add `updatedAt` alongside:

```typescript
      const [inserted] = await db.insert(calendarEvents).values({
        calendarId,
        ...eventData,
        // Pin updatedAt to the provider's timestamp on insert. Left to
        // default to now(), a freshly pulled event would satisfy
        // `updated_at > remote_updated` and be pushed straight back to
        // Google on the next outbound sweep.
        updatedAt: eventData.remoteUpdated ?? new Date(),
      })
```

**Do not add `updatedAt` to the update path.** `.set(eventData)` deliberately leaves `updated_at` alone so a pull does not make a row look locally edited.

- [ ] **Step 6: Verify the full pull still behaves**

Run: `cd backend && npx vitest run test/calendars/`
Expected: PASS, including the existing `sync-reconcile.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/calendars/sync-reconcile.ts backend/src/modules/calendars/google-sync.service.ts backend/test/calendars/echo-suppression.test.ts
git commit -m "feat(calendars): echo suppression via remote_updated

Store Google's own updated timestamp on every pulled event and compare it
first, so a pull that follows a push is a no-op rather than a phantom
remote change.

Pull inserts pin updatedAt to the provider timestamp. Left at now(), every
freshly pulled event would look locally edited and be pushed back."
```

---

### Task 3: Outbound discovery

Three queries that answer "what does this calendar owe Google?" without any route ever having said so. Kept in their own module so they can be tested against a database without a worker or a Google client anywhere near them.

`updated_at > remote_updated` is NULL-safe in the direction that matters: when `remote_updated` is NULL the comparison is NULL, which is not true, so the row is not an update candidate. Such a row is a *create* candidate only if `external_id` is also NULL. A row with an `external_id` but no `remote_updated` is one that predates this migration; the first pull after deploy fills it in.

**Files:**
- Create: `backend/src/modules/calendars/outbound-discovery.ts`
- Test: `backend/test/calendars/outbound-discovery.test.ts`

**Interfaces:**
- Consumes: the columns from Task 1 and the invariant from Task 2.
- Produces:
  - `findCreates(calendarId: string): Promise<CalendarEvent[]>`
  - `findUpdates(calendarId: string): Promise<CalendarEvent[]>`
  - `findDeletes(calendarId: string, cursor: number): Promise<Array<{ syncToken: number; externalId: string | null }>>`
  - `isOutboundCalendar(calendar: Calendar): boolean`

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/outbound-discovery.test.ts`:

```typescript
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendarEvents, calendars, households } from '../../src/db/schema/index.js';
import {
  findCreates,
  findDeletes,
  findUpdates,
  isOutboundCalendar,
} from '../../src/modules/calendars/outbound-discovery.js';

let householdId: string;
let calendarId: string;

beforeAll(async () => {
  const [household] = await db
    .insert(households)
    .values({ name: `discovery-${randomUUID()}` })
    .returning();
  householdId = household.id;

  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Discovery fixture',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'fixture@group.calendar.google.com',
    })
    .returning();
  calendarId = calendar.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

const times = {
  start: new Date('2026-09-01T10:00:00Z'),
  end: new Date('2026-09-01T11:00:00Z'),
};

describe('findCreates', () => {
  it('finds rows that have never been to Google', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Never synced', ...times, externalId: null })
      .returning();

    const creates = await findCreates(calendarId);
    expect(creates.map((e) => e.id)).toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('ignores rows that already have a Google id', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Already there', ...times, externalId: 'g-99' })
      .returning();

    const creates = await findCreates(calendarId);
    expect(creates.map((e) => e.id)).not.toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });
});

describe('findUpdates', () => {
  it('finds a row edited since Google last saw it', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Edited locally',
        ...times,
        externalId: 'g-100',
        remoteUpdated: new Date('2026-08-28T10:00:00Z'),
        updatedAt: new Date('2026-08-28T11:00:00Z'),
      })
      .returning();

    const updates = await findUpdates(calendarId);
    expect(updates.map((e) => e.id)).toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('ignores a row Google has seen since its last local edit', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Google is current',
        ...times,
        externalId: 'g-101',
        remoteUpdated: new Date('2026-08-28T12:00:00Z'),
        updatedAt: new Date('2026-08-28T11:00:00Z'),
      })
      .returning();

    const updates = await findUpdates(calendarId);
    expect(updates.map((e) => e.id)).not.toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('ignores a row with a null remote_updated — that is a create, not an update', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'No provider stamp',
        ...times,
        externalId: 'g-102',
        remoteUpdated: null,
      })
      .returning();

    const updates = await findUpdates(calendarId);
    expect(updates.map((e) => e.id)).not.toContain(event.id);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });
});

describe('findDeletes', () => {
  it('returns journal deletes after the cursor, carrying the Google id', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'To delete', ...times, externalId: 'g-200' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const deletes = await findDeletes(calendarId, 0);
    expect(deletes.some((d) => d.externalId === 'g-200')).toBe(true);
  });

  it('respects the cursor', async () => {
    const deletes = await findDeletes(calendarId, 1_000_000);
    expect(deletes).toEqual([]);
  });
});

describe('isOutboundCalendar', () => {
  it('accepts a writable synced Google calendar', () => {
    expect(
      isOutboundCalendar({
        isSynced: true,
        isReadOnly: false,
        syncProvider: 'google',
      } as never)
    ).toBe(true);
  });

  it.each([
    [{ isSynced: true, isReadOnly: false, syncProvider: 'outlook' }, 'outlook has no outbound path'],
    [{ isSynced: true, isReadOnly: true, syncProvider: 'google' }, 'still read-only'],
    [{ isSynced: false, isReadOnly: false, syncProvider: 'google' }, 'not synced'],
  ])('rejects %o (%s)', (calendar) => {
    expect(isOutboundCalendar(calendar as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/calendars/outbound-discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the discovery module**

Create `backend/src/modules/calendars/outbound-discovery.ts`:

```typescript
import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { calendarChanges, calendarEvents } from '../../db/schema/index.js';
import type { Calendar, CalendarEvent } from '../../db/schema/calendars.js';

/**
 * What a synced calendar owes its provider, derived from state rather than
 * from hooks on the routes that write events.
 *
 * The routes are the wrong place. Basis has three write paths into
 * calendar_events — the REST routes (~20 direct writes in
 * calendars.routes.ts), CalDAV (events.service.ts and the DELETE handler),
 * and the pull itself — and they share no service layer to hang a hook on.
 * basis#101 is what that costs: a check added to one path and missed on
 * another. State cannot be missed. A row with no external_id has never been
 * to Google no matter who wrote it.
 *
 * Deletes are the one thing state cannot express, because the row is gone.
 * Those come off the calendar_changes journal, which the Postgres trigger
 * writes for every path equally.
 */

/** Only a writable, synced, Google calendar has anywhere to push to. */
export function isOutboundCalendar(calendar: Calendar): boolean {
  return (
    calendar.isSynced === true &&
    calendar.isReadOnly === false &&
    calendar.syncProvider === 'google'
  );
}

/** Rows that have never been to Google. */
export function findCreates(calendarId: string): Promise<CalendarEvent[]> {
  return db.query.calendarEvents.findMany({
    where: and(eq(calendarEvents.calendarId, calendarId), isNull(calendarEvents.externalId)),
  });
}

/**
 * Rows edited locally since Google last saw them.
 *
 * NULL-safe by construction: when remote_updated is NULL the comparison is
 * NULL, which is not true, so the row is skipped here. Such a row is either a
 * create (no external_id) or one that predates this feature, which the next
 * pull will stamp.
 */
export function findUpdates(calendarId: string): Promise<CalendarEvent[]> {
  return db.query.calendarEvents.findMany({
    where: and(
      eq(calendarEvents.calendarId, calendarId),
      isNotNull(calendarEvents.externalId),
      isNotNull(calendarEvents.remoteUpdated),
      sql`${calendarEvents.updatedAt} > ${calendarEvents.remoteUpdated}`
    ),
  });
}

/**
 * Deletes recorded in the journal since the calendar's cursor.
 *
 * The journal is shared with CalDAV's sync-token replay, so nothing here
 * deletes rows — the cursor is advanced instead.
 */
export function findDeletes(
  calendarId: string,
  cursor: number
): Promise<Array<{ syncToken: number; externalId: string | null }>> {
  return db
    .select({
      syncToken: calendarChanges.syncToken,
      externalId: calendarChanges.externalId,
    })
    .from(calendarChanges)
    .where(
      and(
        eq(calendarChanges.calendarId, calendarId),
        eq(calendarChanges.changeType, 'delete'),
        gt(calendarChanges.syncToken, cursor)
      )
    )
    .orderBy(asc(calendarChanges.syncToken));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/calendars/outbound-discovery.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/calendars/outbound-discovery.ts backend/test/calendars/outbound-discovery.test.ts
git commit -m "feat(calendars): discover outbound work from state, not route hooks

Creates are rows with no external_id, updates are rows whose updated_at is
newer than remote_updated, deletes come off the change journal. That
catches every write path — REST, CalDAV, and anything added later —
without a hook on any of them, which is the bug class basis#101 belongs to."
```

---

### Task 4: The outbound worker

A BullMQ worker that sweeps one calendar at a time, in order.

**On ordering and debouncing.** BullMQ has no per-group concurrency without the Pro edition, so per-calendar serialisation comes from the job id: a sweep for calendar X is enqueued as `calendar-outbound:X`, and BullMQ refuses a second job with a live id. That dedupe has a hole — once a job is *active*, an enqueue with the same id is dropped silently, so an edit made mid-sweep would wait for the next trigger. The sweep therefore **loops until discovery comes back empty** before exiting, which closes the window without a second queue.

**On the first sweep after deploy.** basis#101 left stray rows in production: events created through CalDAV on a synced calendar, which have no `external_id` and have never reached Google. The first sweep will push them. That is the right outcome — they are real events a household created and expected to sync — but it is a visible behaviour change, and events may appear in Google that a household forgot they made. Say so in the release notes.

**Files:**
- Create: `backend/src/jobs/calendar-outbound.worker.ts`
- Modify: `backend/src/jobs/index.ts`
- Test: `backend/test/calendars/outbound-worker.test.ts`

**Interfaces:**
- Consumes: `findCreates`, `findUpdates`, `findDeletes`, `isOutboundCalendar` (Task 3); `createGoogleEvent`, `updateGoogleEvent`, `deleteGoogleEvent` from `google-sync.service.ts`.
- Produces:
  - `processCalendarOutboundJob(job: Job<CalendarOutboundJobData>): Promise<OutboundResult>`
  - `interface CalendarOutboundJobData { calendarId: string }`
  - `interface OutboundResult { created: number; updated: number; deleted: number; failed: number }`
  - `queueOutboundSweep(calendarId: string): Promise<void>` exported from `jobs/index.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/outbound-worker.test.ts`. Mock the Google calls — this tests the sweep's logic, not Google's API:

```typescript
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const createGoogleEvent = vi.fn();
const updateGoogleEvent = vi.fn();
const deleteGoogleEvent = vi.fn();

vi.mock('../../src/modules/calendars/google-sync.service.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createGoogleEvent: (...args: unknown[]) => createGoogleEvent(...args),
  updateGoogleEvent: (...args: unknown[]) => updateGoogleEvent(...args),
  deleteGoogleEvent: (...args: unknown[]) => deleteGoogleEvent(...args),
}));

const { db } = await import('../../src/config/database.js');
const { calendarEvents, calendars, households } = await import(
  '../../src/db/schema/index.js'
);
const { processCalendarOutboundJob } = await import(
  '../../src/jobs/calendar-outbound.worker.js'
);

let householdId: string;
let calendarId: string;

const times = {
  startTime: new Date('2026-09-01T10:00:00Z'),
  endTime: new Date('2026-09-01T11:00:00Z'),
};

const runSweep = () =>
  processCalendarOutboundJob({ id: 'test', data: { calendarId } } as never);

beforeAll(async () => {
  const [household] = await db
    .insert(households)
    .values({ name: `outbound-${randomUUID()}` })
    .returning();
  householdId = household.id;

  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Outbound fixture',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'fixture@group.calendar.google.com',
      syncCredentials: 'unused-in-this-test',
    })
    .returning();
  calendarId = calendar.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

beforeEach(async () => {
  createGoogleEvent.mockReset();
  updateGoogleEvent.mockReset();
  deleteGoogleEvent.mockReset();
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, calendarId));
});

describe('outbound sweep', () => {
  it('creates an event at Google and stores the returned id', async () => {
    createGoogleEvent.mockResolvedValue({ id: 'g-new', updated: '2026-08-28T12:00:00.000Z' });

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'New locally', ...times })
      .returning();

    const result = await runSweep();

    expect(createGoogleEvent).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    expect(after!.externalId).toBe('g-new');
    expect(after!.remoteUpdated).toEqual(new Date('2026-08-28T12:00:00.000Z'));
  });

  it('does not re-push an event it just created', async () => {
    createGoogleEvent.mockResolvedValue({ id: 'g-new', updated: '2026-08-28T12:00:00.000Z' });
    await db.insert(calendarEvents).values({ calendarId, title: 'Once only', ...times });

    await runSweep();
    createGoogleEvent.mockClear();
    await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
  });

  it('pushes a local edit and advances remote_updated past updated_at', async () => {
    updateGoogleEvent.mockResolvedValue({ id: 'g-1', updated: '2026-08-28T14:00:00.000Z' });

    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Edited',
        ...times,
        externalId: 'g-1',
        remoteUpdated: new Date('2026-08-28T10:00:00Z'),
        updatedAt: new Date('2026-08-28T11:00:00Z'),
      })
      .returning();

    const result = await runSweep();

    expect(updateGoogleEvent).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1);

    const after = await db.query.calendarEvents.findFirst({
      where: eq(calendarEvents.id, event.id),
    });
    expect(after!.remoteUpdated!.getTime()).toBeGreaterThan(after!.updatedAt.getTime());
  });

  it('deletes at Google using the id captured on the journal row', async () => {
    deleteGoogleEvent.mockResolvedValue(undefined);

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Doomed', ...times, externalId: 'g-del' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const result = await runSweep();

    expect(deleteGoogleEvent).toHaveBeenCalledWith(expect.anything(), 'g-del');
    expect(result.deleted).toBe(1);
  });

  it('treats a 404 from Google on delete as success — already gone', async () => {
    deleteGoogleEvent.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Already gone', ...times, externalId: 'g-404' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    const result = await runSweep();
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('skips journal deletes for events that never reached Google', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Local only', ...times, externalId: null })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    await runSweep();
    expect(deleteGoogleEvent).not.toHaveBeenCalled();
  });

  it('advances the cursor so a second sweep re-does nothing', async () => {
    deleteGoogleEvent.mockResolvedValue(undefined);

    const [event] = await db
      .insert(calendarEvents)
      .values({ calendarId, title: 'Doomed twice', ...times, externalId: 'g-cursor' })
      .returning();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));

    await runSweep();
    deleteGoogleEvent.mockClear();
    await runSweep();

    expect(deleteGoogleEvent).not.toHaveBeenCalled();
  });

  it('does nothing for a read-only calendar', async () => {
    await db
      .update(calendars)
      .set({ isReadOnly: true })
      .where(eq(calendars.id, calendarId));
    await db.insert(calendarEvents).values({ calendarId, title: 'Locked', ...times });

    const result = await runSweep();

    expect(createGoogleEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, failed: 0 });

    await db
      .update(calendars)
      .set({ isReadOnly: false })
      .where(eq(calendars.id, calendarId));
  });

  it('picks up work that appears mid-sweep instead of waiting for the next trigger', async () => {
    let calls = 0;
    createGoogleEvent.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        // An edit lands while the first item is in flight.
        await db.insert(calendarEvents).values({ calendarId, title: 'Late arrival', ...times });
      }
      return { id: `g-${calls}`, updated: '2026-08-28T12:00:00.000Z' };
    });

    await db.insert(calendarEvents).values({ calendarId, title: 'First', ...times });

    const result = await runSweep();
    expect(result.created).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/calendars/outbound-worker.test.ts`
Expected: FAIL — worker module not found.

- [ ] **Step 3: Write the worker**

Create `backend/src/jobs/calendar-outbound.worker.ts`:

```typescript
import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { calendarEvents, calendars } from '../db/schema/index.js';
import {
  createGoogleEvent,
  createOAuth2Client,
  deleteGoogleEvent,
  updateGoogleEvent,
} from '../modules/calendars/google-sync.service.js';
import {
  findCreates,
  findDeletes,
  findUpdates,
  isOutboundCalendar,
} from '../modules/calendars/outbound-discovery.js';
import { decrypt } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

export interface CalendarOutboundJobData {
  calendarId: string;
}

export interface OutboundResult {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
}

/** Google says "already gone" in more than one dialect. */
function isAlreadyGone(err: unknown): boolean {
  const code = (err as { code?: number; status?: number })?.code
    ?? (err as { status?: number })?.status;
  return code === 404 || code === 410;
}

/**
 * Push one calendar's pending changes to Google.
 *
 * Serialisation is by job id — a sweep is enqueued as
 * `calendar-outbound:<calendarId>`, and BullMQ will not run two jobs with the
 * same id. That dedupe stops applying once a job goes active, so an edit made
 * mid-sweep would otherwise sit until something else triggered a sweep. Hence
 * the loop: keep going until discovery comes back empty.
 */
export async function processCalendarOutboundJob(
  job: Job<CalendarOutboundJobData>
): Promise<OutboundResult> {
  const { calendarId } = job.data;
  const log = logger.child({ jobId: job.id, calendarId });
  const result: OutboundResult = { created: 0, updated: 0, deleted: 0, failed: 0 };

  const calendar = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
  });
  if (!calendar || !isOutboundCalendar(calendar) || !calendar.syncCredentials) {
    return result;
  }

  const credentials = JSON.parse(decrypt(calendar.syncCredentials));
  // Zero-arg is correct here — createOAuth2Client(redirectUri?) takes the
  // client id and secret from config, and a redirect URI matters only during
  // an authorization-code exchange, which this is not. Phase 3 changes this:
  // a calendar connected with the Basis-owned client needs that client's
  // credentials, not the box's config.
  const auth = createOAuth2Client();
  auth.setCredentials(credentials);

  // Bounded so a persistently failing item cannot spin forever.
  for (let pass = 0; pass < 10; pass += 1) {
    const [creates, updates, deletes] = await Promise.all([
      findCreates(calendarId),
      findUpdates(calendarId),
      findDeletes(calendarId, calendar.outboundCursor),
    ]);

    if (creates.length === 0 && updates.length === 0 && deletes.length === 0) {
      return result;
    }

    for (const event of creates) {
      try {
        const remote = await createGoogleEvent(auth, calendar.syncCalendarId!, event);
        // Clamped past updatedAt for the same reason as the update path: if
        // Google's clock is behind ours, an unclamped stamp leaves the row
        // satisfying `updated_at > remote_updated` and it gets a pointless
        // update push on the next pass before it self-heals.
        const created = remote.updated ? new Date(remote.updated) : new Date();
        await db
          .update(calendarEvents)
          .set({
            externalId: remote.id,
            remoteUpdated:
              created > event.updatedAt ? created : new Date(event.updatedAt.getTime() + 1),
          })
          .where(eq(calendarEvents.id, event.id));
        result.created += 1;
      } catch (err) {
        log.warn({ err, eventId: event.id }, 'Outbound create failed');
        result.failed += 1;
      }
    }

    for (const event of updates) {
      try {
        const remote = await updateGoogleEvent(
          auth,
          calendar.syncCalendarId!,
          event.externalId!,
          event
        );
        // Past updatedAt, so the row stops qualifying as a local edit even if
        // Google hands back a timestamp older than our own clock.
        const stamp = remote?.updated ? new Date(remote.updated) : new Date();
        await db
          .update(calendarEvents)
          .set({
            remoteUpdated:
              stamp > event.updatedAt ? stamp : new Date(event.updatedAt.getTime() + 1),
          })
          .where(eq(calendarEvents.id, event.id));
        result.updated += 1;
      } catch (err) {
        log.warn({ err, eventId: event.id }, 'Outbound update failed');
        result.failed += 1;
      }
    }

    let cursor = calendar.outboundCursor;
    for (const change of deletes) {
      // A row that never reached Google has nothing to delete there.
      if (change.externalId) {
        try {
          await deleteGoogleEvent(auth, calendar.syncCalendarId!, change.externalId);
          result.deleted += 1;
        } catch (err) {
          if (isAlreadyGone(err)) {
            result.deleted += 1;
          } else {
            log.warn({ err, externalId: change.externalId }, 'Outbound delete failed');
            result.failed += 1;
            break; // Stop advancing the cursor past something unresolved.
          }
        }
      }
      cursor = change.syncToken;
    }

    if (cursor !== calendar.outboundCursor) {
      await db
        .update(calendars)
        .set({ outboundCursor: cursor })
        .where(eq(calendars.id, calendarId));
      calendar.outboundCursor = cursor;
    }

    if (result.created + result.updated + result.deleted > 0) {
      // Marks the calendar "active" for the five-minute tick. Recorded here
      // rather than inferred from outstanding work, which goes false the
      // moment this sweep succeeds.
      await db
        .update(calendars)
        .set({ lastOutboundAt: new Date() })
        .where(eq(calendars.id, calendarId));
    }
  }

  log.warn({ result }, 'Outbound sweep hit its pass limit with work outstanding');
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/calendars/outbound-worker.test.ts`
Expected: PASS, all ten cases.

If `createGoogleEvent` is called with a different argument shape than the test asserts, read its real signature at `google-sync.service.ts:433` and adjust the *worker* to match it — the existing function is the contract, not the plan.

- [ ] **Step 5: Register the queue and worker**

In `backend/src/jobs/index.ts`, following the pattern already used for `calendarSyncQueue`:

- create a `calendarOutboundQueue`,
- start its worker with `processCalendarOutboundJob`,
- export the enqueue helper:

```typescript
/**
 * Ask for a calendar's pending changes to be pushed to Google.
 *
 * The fixed job id serialises sweeps per calendar: BullMQ will not queue a
 * second job with a live id, so two edits in quick succession collapse into
 * one sweep. The sweep itself loops until it finds nothing, which covers the
 * edit that lands while a sweep is already running.
 */
export async function queueOutboundSweep(calendarId: string): Promise<void> {
  await calendarOutboundQueue.add(
    'sweep',
    { calendarId },
    { jobId: `calendar-outbound:${calendarId}`, removeOnComplete: 50, removeOnFail: 50 }
  );
}
```

Match the surrounding `removeOnComplete`/`removeOnFail` values if they differ from 50.

- [ ] **Step 6: Sweep every writable calendar on the existing hourly tick**

In `backend/src/jobs/calendar-sync.worker.ts`, after the pull for each calendar completes, enqueue a sweep for it. That gives outbound a floor without a second scheduler, and the pull-then-push order means a sweep always works from fresh `remote_updated` values.

- [ ] **Step 7: Verify**

Run: `cd backend && npm run typecheck && npx vitest run test/calendars/`
Expected: clean, PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/jobs/calendar-outbound.worker.ts backend/src/jobs/index.ts backend/src/jobs/calendar-sync.worker.ts backend/test/calendars/outbound-worker.test.ts
git commit -m "feat(calendars): outbound sweep worker

Wires the three long-dormant Google write functions to the state-derived
discovery. Serialised per calendar by job id, and loops until discovery is
empty so an edit landing mid-sweep is not left until the next tick.

Deletes tolerate 404/410 — already gone is the outcome we wanted."
```

---

### Task 5: Unlock Google calendars

The flip. Everything up to here has been inert; this is where a household can edit.

Two parts, and the second is a migration that must be the **last** one in this phase: `sync.routes.ts:206` stops setting `isReadOnly: true` for new Google connections, and a migration clears the flag on the ones already out there. `0006_synced_calendars_readonly.sql` is the precedent, in reverse — it set the flag *because* no outbound path existed.

**ICS import stays refused.** `ics.service.ts:164` currently refuses on `isReadOnly`, which is the only thing keeping ICS UIDs out of `external_id` on a synced calendar. Once the flag clears, that guard opens — and an ICS import would stamp ICS UIDs into `external_id`, which outbound would then read as "already in Google", skipping the create and later calling `updateGoogleEvent` with an id Google has never heard of. Change that guard to refuse on synced calendars instead.

**Files:**
- Modify: `backend/src/modules/calendars/sync.routes.ts:206`
- Modify: `backend/src/modules/calendars/ics.service.ts:164`
- Create: `backend/drizzle/0019_unlock_google_calendars.sql`
- Modify: `backend/drizzle/meta/_journal.json`
- Create: `backend/drizzle/meta/0019_snapshot.json`
- Test: `backend/test/calendars/unlock.test.ts`

**Interfaces:**
- Consumes: the worker from Task 4 must exist and be registered before this runs.
- Produces: nothing importable.

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/unlock.test.ts`:

```typescript
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendars, households } from '../../src/db/schema/index.js';
import { importIcsToCalendar } from '../../src/modules/calendars/ics.service.js';

let householdId: string;
let googleCalendarId: string;
let outlookCalendarId: string;

beforeAll(async () => {
  const [household] = await db
    .insert(households)
    .values({ name: `unlock-${randomUUID()}` })
    .returning();
  householdId = household.id;

  const [google] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Google',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'g@group.calendar.google.com',
    })
    .returning();
  googleCalendarId = google.id;

  const [outlook] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Outlook',
      type: 'synced',
      isSynced: true,
      isReadOnly: true,
      syncProvider: 'outlook',
      syncCalendarId: 'o-1',
    })
    .returning();
  outlookCalendarId = outlook.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

describe('unlock', () => {
  it('leaves Outlook calendars read-only — they have no outbound path', async () => {
    const outlook = await db.query.calendars.findFirst({
      where: eq(calendars.id, outlookCalendarId),
    });
    expect(outlook!.isReadOnly).toBe(true);
  });

  it('refuses an ICS import into a synced calendar even once it is writable', async () => {
    await expect(
      importIcsToCalendar({
        calendarId: googleCalendarId,
        householdId,
        createdById: null,
        icsContent: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
      } as never)
    ).rejects.toThrow(/synced/i);
  });
});
```

Adjust the `importIcsToCalendar` call to the real signature in `ics.service.ts` — read it first.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/calendars/unlock.test.ts`
Expected: FAIL on the ICS case — it currently throws "Calendar is read-only" only when the flag is set, and the fixture is writable.

- [ ] **Step 3: Change the ICS guard**

In `backend/src/modules/calendars/ics.service.ts`, replace:

```typescript
  if (calendar.isReadOnly) {
    throw new Error('Calendar is read-only');
  }
```

with:

```typescript
  if (calendar.isReadOnly) {
    throw new Error('Calendar is read-only');
  }

  // A synced calendar's external_id column belongs to the provider. An ICS
  // import would fill it with ICS UIDs, which the outbound sweep would then
  // read as "Google already has this" — skipping the create, and later
  // calling updateGoogleEvent with an id Google has never seen. Bulk import
  // into a synced calendar is not part of two-way sync.
  if (calendar.isSynced) {
    throw new Error('This calendar is synced with an external provider — import into a local calendar instead');
  }
```

- [ ] **Step 4: Stop locking new Google connections**

In `backend/src/modules/calendars/sync.routes.ts` at ~line 206, the Google branch currently reads:

```typescript
          // Pull-only: no push-to-provider path exists, so local edits would
          // be silently clobbered by the next hourly pull. Read-only until
          // real two-way sync ships.
          isReadOnly: true,
```

Replace with:

```typescript
          // Two-way as of phase 2: local edits are discovered from state and
          // pushed by the outbound sweep. See outbound-discovery.ts.
          isReadOnly: false,
```

**Leave the Outlook branch at ~line 534 exactly as it is.** Outlook has no outbound path; unlocking it would recreate basis#101 on a different provider.

- [ ] **Step 5: Write the unlock migration**

**Hand-author. Do not run `npm run db:generate`.**

Create `backend/drizzle/0019_unlock_google_calendars.sql`:

```sql
-- Google-synced calendars become editable.
--
-- 0006 set this flag because no push-to-provider path existed and local edits
-- were silently clobbered by the next hourly pull. That path now exists —
-- outbound-discovery.ts plus calendar-outbound.worker.ts — so the flag comes
-- off for Google.
--
-- This migration MUST come after the outbound worker is deployed. Unlocking a
-- calendar with no worker behind it is basis#101 across every household at
-- once: edits accepted, then reverted by the next pull.
--
-- Outlook is deliberately untouched. It has no outbound path.

UPDATE calendars
SET is_read_only = false
WHERE is_synced = true
  AND sync_provider = 'google';
```

- [ ] **Step 6: Journal and snapshot**

Append to `backend/drizzle/meta/_journal.json`:

```json
  {
   "idx": 19,
   "version": "7",
   "when": 1787109600000,
   "tag": "0019_unlock_google_calendars",
   "breakpoints": true
  }
```

Copy `0018_snapshot.json` to `0019_snapshot.json`, give it a fresh `id`, and set its `prevId` to `0018_snapshot.json`'s `id`. No column definitions change — this migration is data only — so the rest of the snapshot is identical.

- [ ] **Step 7: Run and verify**

```bash
cd backend && npm run db:migrate && npx vitest run test/calendars/ test/caldav/
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/calendars/sync.routes.ts backend/src/modules/calendars/ics.service.ts backend/drizzle/0019_unlock_google_calendars.sql backend/drizzle/meta/_journal.json backend/drizzle/meta/0019_snapshot.json backend/test/calendars/unlock.test.ts
git commit -m "feat(calendars): unlock Google-synced calendars for editing

New connections are no longer read-only, and existing Google calendars are
unlocked by migration. Outlook stays locked — it has no outbound path.

ICS import into a synced calendar is now refused outright: it would write
ICS UIDs into external_id, which the outbound sweep reads as Google ids."
```

---

### Task 6: Conflict policy

Both sides changed since the last sync. Last writer wins, by timestamp: local `updated_at` against Google's `updated`. No merge, no UI — this is what every consumer calendar sync does and a household calendar does not justify more.

The spec says the outcome is "recorded in the sync log so a surprised user can see what happened". **There is no sync log table in this repo** and this plan does not add one; structured logger output satisfies the requirement. Do not invent a table.

**Files:**
- Modify: `backend/src/modules/calendars/google-sync.service.ts` (the pull's update branch)
- Test: `backend/test/calendars/conflict.test.ts`

**Interfaces:**
- Consumes: the invariant from Task 2.
- Produces: `resolveConflict(local: { updatedAt: Date; remoteUpdated: Date | null }, remoteUpdated: Date): 'local' | 'remote'` from `google-sync.service.ts`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/conflict.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { resolveConflict } from '../../src/modules/calendars/google-sync.service.js';

const t = (iso: string) => new Date(iso);

describe('resolveConflict', () => {
  it('keeps the local edit when it is newer than Google\'s', () => {
    expect(
      resolveConflict(
        { updatedAt: t('2026-08-28T12:00:00Z'), remoteUpdated: t('2026-08-28T10:00:00Z') },
        t('2026-08-28T11:00:00Z')
      )
    ).toBe('local');
  });

  it('takes Google when its change is newer', () => {
    expect(
      resolveConflict(
        { updatedAt: t('2026-08-28T11:00:00Z'), remoteUpdated: t('2026-08-28T10:00:00Z') },
        t('2026-08-28T12:00:00Z')
      )
    ).toBe('remote');
  });

  it('takes Google when there is no local edit outstanding', () => {
    expect(
      resolveConflict(
        { updatedAt: t('2026-08-28T10:00:00Z'), remoteUpdated: t('2026-08-28T10:00:00Z') },
        t('2026-08-28T12:00:00Z')
      )
    ).toBe('remote');
  });

  it('takes Google on an exact tie — the provider is the tiebreak', () => {
    expect(
      resolveConflict(
        { updatedAt: t('2026-08-28T12:00:00Z'), remoteUpdated: t('2026-08-28T10:00:00Z') },
        t('2026-08-28T12:00:00Z')
      )
    ).toBe('remote');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/calendars/conflict.test.ts`
Expected: FAIL — `resolveConflict` is not exported.

- [ ] **Step 3: Write it**

Add to `backend/src/modules/calendars/google-sync.service.ts`:

```typescript
/**
 * Both sides changed since the last sync — who wins?
 *
 * Last writer, by timestamp. There is no merge and no UI: it is the policy
 * every consumer calendar sync uses, and a household calendar does not
 * justify more. A tie goes to the provider, so the two sides converge rather
 * than ping-ponging.
 *
 * A row with no outstanding local edit (updatedAt <= remoteUpdated) is not a
 * conflict at all and always takes the remote.
 */
export function resolveConflict(
  local: { updatedAt: Date; remoteUpdated: Date | null },
  remoteUpdated: Date
): 'local' | 'remote' {
  if (!local.remoteUpdated || local.updatedAt <= local.remoteUpdated) {
    return 'remote';
  }
  return local.updatedAt > remoteUpdated ? 'local' : 'remote';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/calendars/conflict.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the pull, and log what happened**

In `syncCalendarFromGoogle`, in the branch that updates an existing event (around line 310-320), consult it before overwriting a row that has local edits outstanding:

```typescript
      const remoteStamp = googleEvent.updated ? new Date(googleEvent.updated) : null;
      if (remoteStamp && resolveConflict(existing, remoteStamp) === 'local') {
        // The household's edit is newer. Leave the row alone; the outbound
        // sweep will push it and Google will end up matching.
        log.info(
          {
            eventId: existing.id,
            localUpdatedAt: existing.updatedAt,
            remoteUpdated: remoteStamp,
          },
          'Conflict resolved in favour of the local edit; outbound sweep will push it'
        );
        continue;
      }
```

Place it immediately before the `syncedEventUnchanged` check.

- [ ] **Step 6: Verify**

Run: `cd backend && npx vitest run test/calendars/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/calendars/google-sync.service.ts backend/test/calendars/conflict.test.ts
git commit -m "feat(calendars): last-writer-wins conflict policy

When both sides changed, the newer timestamp wins and a tie goes to
Google so the two converge. The losing side is logged with both
timestamps — there is no sync log table, and this plan does not add one."
```

---

### Task 7: Tighten the polling cadence

The hourly pull is the floor for everyone. A calendar someone is actively editing deserves better, and echo suppression has made an unchanged pull cheap — it reads Google and writes nothing.

**Files:**
- Modify: `backend/src/jobs/index.ts` (schedule a second repeat)
- Modify: `backend/src/jobs/calendar-sync.worker.ts` (select which calendars a tick covers)
- Test: `backend/test/calendars/sync-cadence.test.ts`

**Interfaces:**
- Consumes: `calendars.lastOutboundAt` (Task 1), stamped by the sweep (Task 4).
- Produces, both from `calendar-sync.worker.ts`:
  - `shouldSyncOnActiveTick(calendar: { lastOutboundAt: Date | null }, now: Date): boolean`
  - `'sync_active'` added to the `CalendarSyncJobData['type']` union.

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/sync-cadence.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { shouldSyncOnActiveTick } from '../../src/jobs/calendar-sync.worker.js';

const now = new Date('2026-08-28T12:00:00Z');

describe('shouldSyncOnActiveTick', () => {
  it('includes a calendar that pushed in the last hour', () => {
    expect(
      shouldSyncOnActiveTick({ lastOutboundAt: new Date('2026-08-28T11:30:00Z') } as never, now)
    ).toBe(true);
  });

  it('excludes one that last pushed two hours ago', () => {
    expect(
      shouldSyncOnActiveTick({ lastOutboundAt: new Date('2026-08-28T10:00:00Z') } as never, now)
    ).toBe(false);
  });

  it('excludes one that has never pushed', () => {
    expect(shouldSyncOnActiveTick({ lastOutboundAt: null } as never, now)).toBe(false);
  });

  it('stays active for the full hour after a push, not just until the work clears', () => {
    // The window is a recorded timestamp, not "has outstanding work" — a
    // calendar whose sweep has already succeeded is still worth polling.
    expect(
      shouldSyncOnActiveTick({ lastOutboundAt: new Date('2026-08-28T11:59:00Z') } as never, now)
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/calendars/sync-cadence.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Read `calendars.lastOutboundAt`, the column Task 1 added and Task 4's worker stamps.

Two nearby signals are wrong, and it is worth knowing why. `calendars.updatedAt` is bumped by the sync trigger on *every* event change, including ones the pull itself made, so it cannot distinguish local from remote. And "has outstanding outbound work" — a `findCreates`/`findUpdates` count — goes false the instant the sweep succeeds, which would collapse the spec's one-hour active window to a single sweep. A recorded timestamp is the only one of the three that means what the spec asks for.

Add to `backend/src/jobs/calendar-sync.worker.ts`:

```typescript
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Is this calendar worth polling every five minutes rather than hourly?
 *
 * Only if someone has edited it here recently. Echo suppression makes an
 * unchanged pull nearly free, but "nearly free" times every calendar times
 * twelve is not free.
 */
export function shouldSyncOnActiveTick(
  calendar: { lastOutboundAt: Date | null },
  now: Date
): boolean {
  if (!calendar.lastOutboundAt) return false;
  return now.getTime() - calendar.lastOutboundAt.getTime() < ACTIVE_WINDOW_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/calendars/sync-cadence.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the five-minute tick**

In `backend/src/jobs/index.ts`, beside the existing hourly `calendar:sync_all`:

```typescript
  // Active calendars — anything edited locally in the last hour — get a
  // tighter loop. Echo suppression makes an unchanged pull a no-op.
  await calendarSyncQueue.add(
    'sync_active',
    { type: 'sync_active' },
    {
      repeat: { pattern: '*/5 * * * *' },
      jobId: 'calendar:sync_active',
    }
  );
```

Add `'sync_active'` to the `CalendarSyncJobData['type']` union and handle it in `processCalendarSyncJob` by filtering the calendar list through `shouldSyncOnActiveTick`.

- [ ] **Step 6: Verify**

Run: `cd backend && npm run typecheck && npx vitest run test/calendars/`
Expected: clean, PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/jobs/index.ts backend/src/jobs/calendar-sync.worker.ts backend/test/calendars/sync-cadence.test.ts
git commit -m "feat(calendars): poll actively-edited calendars every five minutes

The hourly tick stays the floor for everything. A calendar with local
edits Google has not seen gets a five-minute loop until it goes quiet."
```

---

### Task 8: Write-path coverage

The test that would have caught basis#101, and the one that keeps the discovery honest when someone adds a fourth way to write an event.

One assertion — *an edit made through this path becomes outbound work* — run once per path. It tests discovery, not Google, so no mocking of the API is needed.

**Files:**
- Create: `backend/test/calendars/write-paths.test.ts`

**Interfaces:**
- Consumes: `findCreates`, `findUpdates`, `findDeletes` (Task 3); the CalDAV route handlers; the REST route handlers.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `backend/test/calendars/write-paths.test.ts`. Use `setupRouteTest` from `backend/test/helpers/route-harness.js` — read `backend/test/inventory/tenancy.test.ts` for how it is set up and torn down.

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendarEvents, calendars } from '../../src/db/schema/index.js';
import {
  findCreates,
  findDeletes,
} from '../../src/modules/calendars/outbound-discovery.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

/**
 * Every way to write an event must produce outbound work.
 *
 * This is the test that would have caught basis#101: the REST routes
 * refused writes to a synced calendar and CalDAV did not, so a check added
 * to one path was simply absent from the other. Outbound discovery reads
 * state rather than hooking routes precisely so that a new write path is
 * covered for free — this test is what proves that claim, per path.
 */

let ctx: RouteTestContext;
let user: TestUser;
let calendarId: string;

beforeAll(async () => {
  ctx = await setupRouteTest();
  user = ctx.users[0];

  const [calendar] = await db
    .insert(calendars)
    .values({
      householdId: user.householdId,
      ownerId: user.id,
      name: 'Write paths',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'wp@group.calendar.google.com',
    })
    .returning();
  calendarId = calendar.id;
});

afterAll(async () => {
  await ctx.teardown();
});

describe('every write path produces outbound work', () => {
  it('REST create', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      // Events are created under their calendar: app.post('/:calendarId/events')
      // at calendars.routes.ts:385, mounted at /api/v1/calendars.
      url: `/api/v1/calendars/${calendarId}/events`,
      cookies: user.cookies,
      payload: {
        title: 'Made over REST',
        startTime: '2026-09-02T10:00:00.000Z',
        endTime: '2026-09-02T11:00:00.000Z',
      },
    });
    expect(response.statusCode).toBe(201);

    const creates = await findCreates(calendarId);
    expect(creates.some((e) => e.title === 'Made over REST')).toBe(true);
  });

  it('CalDAV PUT', async () => {
    const uid = 'caldav-write-path-1';
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      'DTSTART:20260902T120000Z',
      'DTEND:20260902T130000Z',
      'SUMMARY:Made over CalDAV',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/dav/calendars/${user.id}/${calendarId}/${uid}.ics`,
      headers: {
        authorization: user.caldavAuthHeader,
        'content-type': 'text/calendar',
      },
      payload: ics,
    });
    expect([201, 204]).toContain(response.statusCode);

    const creates = await findCreates(calendarId);
    expect(creates.some((e) => e.title === 'Made over CalDAV')).toBe(true);
  });

  it('CalDAV DELETE of a synced event becomes an outbound delete', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Deleted over CalDAV',
        startTime: new Date('2026-09-03T10:00:00Z'),
        endTime: new Date('2026-09-03T11:00:00Z'),
        externalId: 'g-caldav-del',
      })
      .returning();

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/dav/calendars/${user.id}/${calendarId}/${event.id}.ics`,
      headers: { authorization: user.caldavAuthHeader },
    });
    expect([200, 204]).toContain(response.statusCode);

    const deletes = await findDeletes(calendarId, 0);
    expect(deletes.some((d) => d.externalId === 'g-caldav-del')).toBe(true);
  });
});
```

Read the real shapes before running this, and adjust the test to them rather than the other way round:

- `backend/test/helpers/route-harness.ts` — the harness may not expose `cookies` or `caldavAuthHeader` under those names.
- `backend/test/caldav/` — how the existing CalDAV tests authenticate. Do not add a new auth mechanism for this test.
- The CalDAV routes are mounted at **`/dav`**, not `/caldav` (`app.ts:272`: `app.register(caldavRoutes, { prefix: '/dav' })`). The URLs above use `/dav`; confirm against `app.ts` before running.
- `calendars.routes.ts:385` — the create route's exact payload schema (`createEventSchema`, defined at line 49). The fields above are the minimum; if it requires more, add them.

The assertion is what matters here, not the request shape.

- [ ] **Step 2: Run it**

Run: `cd backend && npx vitest run test/calendars/write-paths.test.ts`
Expected: PASS on all three. A failure on the CalDAV cases means the trigger is not firing for that path — check `0018`'s guard is not swallowing real writes.

- [ ] **Step 3: Commit**

```bash
git add backend/test/calendars/write-paths.test.ts
git commit -m "test(calendars): every write path produces outbound work

REST and CalDAV, create and delete. This is the assertion that would have
caught basis#101, and the one that keeps state-derived discovery honest
when a fourth write path shows up."
```

---

## Done when

- An event created, edited, or deleted in Basis — through the web app or through a phone's calendar app over CalDAV — appears that way in Google within five minutes.
- An event created or edited in Google appears in Basis within the hour, and does not bounce back out again.
- A pull that follows a push writes nothing: no revision bump, no ETag churn, no journal growth.
- Outlook calendars are still read-only.
- The full suite passes: `cd backend && npm test`.

## Release note

Two behaviour changes worth telling households about:

1. **Google calendars are now editable in Basis**, and edits sync both ways. Outlook calendars stay read-only for now.
2. **Events created on a Google calendar through a phone's calendar app will appear in Google for the first time.** Because of basis#101 those events have been sitting in Basis, invisible to Google, sometimes for months. The first sync after this release pushes them. Nothing is lost, but a household may see events in Google they had forgotten making.

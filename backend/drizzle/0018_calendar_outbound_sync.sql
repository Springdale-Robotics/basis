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
  -- re-download the event. This function is only ever bound BEFORE UPDATE
  -- (see the trigger definition in 0004), so TG_OP = 'UPDATE' always holds
  -- here in practice — but the check is spelled out anyway so the guard is
  -- correct to read on its own, without knowing that binding.
  IF TG_OP = 'UPDATE'
     AND NEW.remote_updated IS DISTINCT FROM OLD.remote_updated
     AND (to_jsonb(NEW) - 'remote_updated') = (to_jsonb(OLD) - 'remote_updated') THEN
    RETURN NEW;
  END IF;

  IF OLD.revision = NEW.revision THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$function$;

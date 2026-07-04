-- CalDAV sync triggers.
--
-- These two triggers had only ever been applied to the dev database via
-- `drizzle-kit push` and were never captured in a migration, so a fresh install
-- via `db:migrate` was missing them entirely — meaning calendar_changes stayed
-- empty and calendars.sync_token / event revisions never advanced, silently
-- breaking CalDAV two-way sync. Captured here so migrated (production) databases
-- match. Idempotent: CREATE OR REPLACE for the functions, DROP IF EXISTS before
-- (re)creating the triggers.

CREATE OR REPLACE FUNCTION calendar_event_sync_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
DECLARE
  new_token integer;
  resource_uid uuid;
  cal_id uuid;
  op_type calendar_change_type;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cal_id := OLD.calendar_id;
    resource_uid := COALESCE(OLD.recurring_event_id, OLD.id);
    op_type := 'delete';
  ELSE
    cal_id := NEW.calendar_id;
    resource_uid := COALESCE(NEW.recurring_event_id, NEW.id);
    op_type := CASE WHEN TG_OP = 'INSERT' THEN 'add'::calendar_change_type
                    ELSE 'update'::calendar_change_type END;
  END IF;

  UPDATE calendars
  SET sync_token = sync_token + 1,
      ctag = md5(random()::text),
      updated_at = now()
  WHERE id = cal_id
  RETURNING sync_token INTO new_token;

  INSERT INTO calendar_changes (calendar_id, event_uid, change_type, sync_token)
  VALUES (cal_id, resource_uid::text, op_type, new_token);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION calendar_event_revision_bump()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.revision = NEW.revision THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS calendar_event_sync_trg ON calendar_events;
--> statement-breakpoint
CREATE TRIGGER calendar_event_sync_trg
  AFTER INSERT OR DELETE OR UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION calendar_event_sync_trigger();
--> statement-breakpoint
DROP TRIGGER IF EXISTS calendar_event_revision_trg ON calendar_events;
--> statement-breakpoint
CREATE TRIGGER calendar_event_revision_trg
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION calendar_event_revision_bump();

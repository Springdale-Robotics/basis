-- External-sync calendars are pull-only: no push-to-provider path exists, so
-- local edits were silently clobbered by the next hourly pull. New synced
-- calendars are created read-only; flip existing ones to match.
UPDATE calendars SET is_read_only = true WHERE is_synced = true;

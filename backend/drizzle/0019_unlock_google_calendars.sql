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

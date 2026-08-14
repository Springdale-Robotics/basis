-- Import sessions had no way to record that parsing failed. When a URL
-- couldn't be fetched or a PDF couldn't be read, the route threw, the request
-- 500'd, and the row stayed in 'parsing' forever — invisible to the user, not
-- retryable, and never cleaned up.
--
-- 'failed' lets the session hold the reason (in parse_warnings) so the UI can
-- show what actually went wrong instead of "Internal server error", and lets
-- retention sweep dead sessions.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in Postgres
-- versions before 12; we target 15+, where it is allowed, but it still cannot
-- be used in the same transaction that then references the new value. Nothing
-- here does, so a plain statement is fine.

ALTER TYPE "import_status" ADD VALUE IF NOT EXISTS 'failed';

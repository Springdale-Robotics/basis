-- Bug reports: user-submitted reports captured from the floating bug button,
-- queued for delivery to GitHub Issues by jobs/bug-report.worker.ts.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bug_report_status') THEN
    CREATE TYPE bug_report_status AS ENUM ('pending', 'sent', 'failed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS bug_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    description text NOT NULL,
    url text NOT NULL,
    user_agent text,
    app_version varchar(50),
    console_log jsonb NOT NULL DEFAULT '[]'::jsonb,
    screenshot text,
    viewport jsonb,
    status bug_report_status NOT NULL DEFAULT 'pending',
    github_issue_number integer,
    github_issue_url text,
    last_error text,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT NOW(),
    updated_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_household_created
    ON bug_reports (household_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status
    ON bug_reports (status)
    WHERE status <> 'sent';

COMMIT;

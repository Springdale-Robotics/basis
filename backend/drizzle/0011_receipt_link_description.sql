-- Learned links show only lineKey today, which for code-keyed links (every
-- Costco link, the primary target) is an opaque product number. Store the
-- receipt line's raw text alongside the link so the link manager can show a
-- human-readable label — and so the label survives receipt_scans/lines being
-- swept by retention 30 days after confirmation.
--
-- Nullable: links created before this migration have nothing to backfill;
-- the column fills in naturally the next time each mapping is used.

ALTER TABLE "receipt_line_links" ADD COLUMN "last_raw_text" varchar(500);

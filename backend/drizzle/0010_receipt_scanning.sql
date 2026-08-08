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
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);

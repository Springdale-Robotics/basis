-- A photographing session you can walk away from.
--
-- Parsing already runs in a worker, so closing the browser has never stopped
-- it — but nothing recorded that a group of scans belonged together, so there
-- was nothing to come back to. The dialog owned the lifecycle, and losing the
-- dialog meant losing the thread.
--
-- A batch is that thread: photograph a binder, close the laptop, and find the
-- work again from a phone. Deliberately thin — progress is counted from the
-- scans themselves rather than duplicated here, because two records of the
-- same thing drift.
CREATE TABLE "recipe_import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "name" varchar(200),
  -- 'open' while it is being captured or reviewed; 'closed' when finished or
  -- abandoned. Anything finer is derivable from the scans.
  "status" varchar(20) DEFAULT 'open' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_import_batches"
  ADD CONSTRAINT "recipe_import_batches_household_id_households_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "recipe_import_batches"
  ADD CONSTRAINT "recipe_import_batches_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Scans keep working without one, so nothing existing has to change.
ALTER TABLE "image_parse_sessions" ADD COLUMN "batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "image_parse_sessions"
  ADD CONSTRAINT "image_parse_sessions_batch_id_recipe_import_batches_id_fk"
  FOREIGN KEY ("batch_id") REFERENCES "recipe_import_batches"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "image_parse_sessions_batch_idx" ON "image_parse_sessions" ("batch_id");
--> statement-breakpoint
CREATE INDEX "recipe_import_batches_household_idx" ON "recipe_import_batches" ("household_id", "status");
--> statement-breakpoint
-- Household-scoped, so it needs a policy like every other such table.
ALTER TABLE recipe_import_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recipe_import_batches_household ON recipe_import_batches
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_import_batches TO basis_rls;

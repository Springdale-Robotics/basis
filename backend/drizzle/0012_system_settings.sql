-- Box-level settings. Not household-scoped and intentionally without an RLS
-- policy: an installed model is a property of the machine, not tenant data.
CREATE TABLE "system_settings" (
  "key" varchar(100) PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

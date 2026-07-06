-- RLS foundation (stage 1): prove the mechanism on the inventory module.
--
-- The app's login role owns the tables and (in dev) is a superuser, so it
-- BYPASSES RLS — which is exactly what we want for migrations, background
-- workers, backups, and the pre-auth session lookup. Request handlers instead
-- `SET ROLE basis_rls` (a plain, non-owner role RLS applies to) and set the
-- `app.household_id` GUC; policies then filter to that household. See
-- docs/product-review-2026-07/RLS-PLAN.md.
--
-- Enabling RLS here is non-disruptive: nothing sets ROLE basis_rls yet, so the
-- owner-connected app and workers keep seeing every row until stage 2 wires the
-- per-request context in.

-- Idempotent role creation. NOTE (deploy): needs CREATEROLE/superuser on the
-- migration DB user; create basis_rls out-of-band first if prod's user lacks it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basis_rls') THEN
    CREATE ROLE basis_rls NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO basis_rls;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO basis_rls;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO basis_rls;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO basis_rls;
--> statement-breakpoint
-- Let the login role assume basis_rls (SET ROLE requires membership).
GRANT basis_rls TO CURRENT_USER;
--> statement-breakpoint

-- inventory_items: scoped directly by household_id.
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_items_household ON inventory_items
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint

-- inventory_stock: no household_id column — scoped via its parent item.
ALTER TABLE inventory_stock ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_stock_household ON inventory_stock
  USING (
    item_id IN (
      SELECT id FROM inventory_items
      WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid
    )
  )
  WITH CHECK (
    item_id IN (
      SELECT id FROM inventory_items
      WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid
    )
  );

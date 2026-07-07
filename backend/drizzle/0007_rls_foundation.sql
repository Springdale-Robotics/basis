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

-- Ensure the `basis_rls` role exists and the app (login) user can assume it.
--
-- Creating a role and granting role membership need superuser/CREATEROLE. In
-- CI and dev the migrate user IS a superuser, so this self-provisions. On a
-- real box the app DB user (e.g. `basis`) owns the tables but is NOT a
-- superuser, so it can't — there the role is provisioned out of band:
--   * Fresh install: deploy/native/install.sh creates it + grants it to `basis`
--     in its postgres-superuser block, before the app ever migrates.
--   * Existing box: run once as a superuser (see RLS-PLAN.md):
--       CREATE ROLE basis_rls NOLOGIN;  GRANT basis_rls TO basis;
--
-- This block does the create/grant when it can, and otherwise fails CLOSED with
-- an actionable message instead of a cryptic "permission denied to create role".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'basis_rls') THEN
    BEGIN
      CREATE ROLE basis_rls NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'Row-level security requires the "basis_rls" role, which does not exist and this DB user cannot create.'
        USING HINT = 'Create it once as a superuser, then re-run the update:  CREATE ROLE basis_rls NOLOGIN;  GRANT basis_rls TO ' || quote_ident(current_user) || ';';
    END;
  END IF;

  -- Let the login user assume the role (SET ROLE needs membership). Idempotent.
  -- A non-superuser can't self-grant; there membership must already exist from
  -- the out-of-band step, so verify it rather than error opaquely.
  IF NOT pg_has_role(current_user, 'basis_rls', 'USAGE') THEN
    BEGIN
      EXECUTE 'GRANT basis_rls TO ' || quote_ident(current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'DB user "%" is not a member of basis_rls and cannot self-grant.', current_user
        USING HINT = 'As a superuser: GRANT basis_rls TO ' || quote_ident(current_user) || ';';
    END;
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO basis_rls;
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

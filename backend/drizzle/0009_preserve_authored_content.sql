-- Preserve authored shared content when a household member is removed.
--
-- Review finding (auth HIGH): removing a member did `db.delete(users)`, and
-- these authored-content FKs cascaded — so it silently destroyed every recipe,
-- list, task, group they created, every file they uploaded, and every
-- permission grant they authored (incl. household-wide defaults, changing
-- other members' access). Switch them to ON DELETE SET NULL (as calendars
-- already did): the content survives with a null author. Personal data
-- (sessions, rewards, notifications, media interactions, group memberships)
-- deliberately stays ON DELETE CASCADE — that should die with the user.
--
-- The FK constraint name is looked up dynamically per (table, column) rather
-- than hardcoded: the same logical FK has different constraint names across
-- environments (e.g. `tasks_created_by_fkey` vs `tasks_created_by_users_id_fk`
-- depending on whether the table was created by a hand-authored or a
-- drizzle-generated migration). This makes the migration robust everywhere.
DO $$
DECLARE
  target RECORD;
  fk_name text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('recipes','created_by'), ('lists','created_by'), ('list_items','created_by'),
      ('tasks','created_by'), ('groups','created_by'), ('permissions','created_by'),
      ('member_invites','invited_by'), ('files','uploaded_by'), ('folders','created_by'),
      ('albums','created_by'), ('playlists','created_by'), ('smart_albums','created_by'),
      ('leftovers','created_by'), ('shopping_list','added_by')
    ) AS t(tbl, col)
  LOOP
    -- Allow the author reference to become null.
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', target.tbl, target.col);

    -- Find the existing FK on (tbl, col) -> users, whatever it's named.
    SELECT tc.constraint_name INTO fk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = target.tbl
      AND kcu.column_name = target.col
      AND ccu.table_name = 'users'
    LIMIT 1;

    IF fk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target.tbl, fk_name);
    END IF;

    -- Recreate with ON DELETE SET NULL under a stable drizzle-style name.
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL',
      target.tbl, target.tbl || '_' || target.col || '_users_id_fk', target.col
    );
  END LOOP;
END $$;

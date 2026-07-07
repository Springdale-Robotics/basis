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

ALTER TABLE albums ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE albums DROP CONSTRAINT albums_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE albums ADD CONSTRAINT albums_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE files ALTER COLUMN uploaded_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE files DROP CONSTRAINT files_uploaded_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE files ADD CONSTRAINT files_uploaded_by_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE folders ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE folders DROP CONSTRAINT folders_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE folders ADD CONSTRAINT folders_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE groups ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE groups DROP CONSTRAINT groups_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE groups ADD CONSTRAINT groups_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE leftovers ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE leftovers DROP CONSTRAINT leftovers_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE leftovers ADD CONSTRAINT leftovers_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE list_items ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE list_items DROP CONSTRAINT list_items_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE list_items ADD CONSTRAINT list_items_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE lists ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE lists DROP CONSTRAINT lists_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE lists ADD CONSTRAINT lists_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE member_invites ALTER COLUMN invited_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE member_invites DROP CONSTRAINT member_invites_invited_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE member_invites ADD CONSTRAINT member_invites_invited_by_users_id_fk FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE permissions ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE permissions DROP CONSTRAINT permissions_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE permissions ADD CONSTRAINT permissions_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE playlists ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE playlists DROP CONSTRAINT playlists_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE playlists ADD CONSTRAINT playlists_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE recipes ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE recipes DROP CONSTRAINT recipes_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE recipes ADD CONSTRAINT recipes_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE shopping_list ALTER COLUMN added_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE shopping_list DROP CONSTRAINT shopping_list_added_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE shopping_list ADD CONSTRAINT shopping_list_added_by_users_id_fk FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE smart_albums ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE smart_albums DROP CONSTRAINT smart_albums_created_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE smart_albums ADD CONSTRAINT smart_albums_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE tasks ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE tasks DROP CONSTRAINT tasks_created_by_fkey;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

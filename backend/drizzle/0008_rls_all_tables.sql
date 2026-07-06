-- RLS stage 3: roll household policies across the core data tables.
--
-- Direct policies where the table has household_id; join policies (through the
-- parent) for child tables that don't. Uniform with 0007: NULLIF(...,'') makes
-- an unset context fail CLOSED. Enabling RLS stays non-disruptive — owner-
-- connected workers/migrations bypass; only basis_rls request connections are
-- filtered.
--
-- Deliberately NOT covered (kept app-level only; see RLS-PLAN.md):
--   * permissions — polymorphic resource_type/resource_id, no clean policy
--     (hardened at the app layer in the P0 pass)
--   * user-scoped/personal: sessions, app_passwords, user_settings,
--     watch_progress, listen_history, favorites, ratings, play_queues,
--     play_queue_items (app scopes these by user_id, not household)
--   * cloud/remote/integration, possibly cross-household by design:
--     connected_households, connection_invites, synced_resources,
--     shared_resources, sync_queue, music_integrations, ddns_config, extensions
--   * ops/system (admin + worker only): backups, backup_schedules,
--     backup_storage, backup_partners, passphrase_escrow, device_settings,
--     hls_streams, media_processing_jobs
--   * dead tables slated for deletion: receipt_scans, custom_units

ALTER TABLE households ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY households_self ON households
  USING (id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE inventory_areas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_areas_household ON inventory_areas
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE shopping_list ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shopping_list_household ON shopping_list
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE leftovers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY leftovers_household ON leftovers
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lists_household ON lists
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tasks_household ON tasks
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rewards_household ON rewards
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendars_household ON calendars
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recipes_household ON recipes
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY meal_plans_household ON meal_plans
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY files_household ON files
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY folders_household ON folders
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE albums ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY albums_household ON albums
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY playlists_household ON playlists
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE movies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY movies_household ON movies
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE tv_shows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tv_shows_household ON tv_shows
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY artists_household ON artists
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE music_albums ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY music_albums_household ON music_albums
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY groups_household ON groups
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY devices_household ON devices
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_household ON notifications
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE member_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY member_invites_household ON member_invites
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE feature_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY feature_permissions_household ON feature_permissions
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE ingredient_aliases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ingredient_aliases_household ON ingredient_aliases
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE smart_albums ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY smart_albums_household ON smart_albums
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE media_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY media_settings_household ON media_settings
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE image_parse_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY image_parse_sessions_household ON image_parse_sessions
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE recipe_import_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recipe_import_sessions_household ON recipe_import_sessions
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bug_reports_household ON bug_reports
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_household ON users
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_household ON audit_log
  USING (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid)
  WITH CHECK (household_id = NULLIF(current_setting('app.household_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY list_items_household ON list_items
  USING (list_id IN (SELECT id FROM lists WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (list_id IN (SELECT id FROM lists WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recipe_ingredients_household ON recipe_ingredients
  USING (recipe_id IN (SELECT id FROM recipes WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (recipe_id IN (SELECT id FROM recipes WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_events_household ON calendar_events
  USING (calendar_id IN (SELECT id FROM calendars WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (calendar_id IN (SELECT id FROM calendars WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE calendar_access ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_access_household ON calendar_access
  USING (calendar_id IN (SELECT id FROM calendars WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (calendar_id IN (SELECT id FROM calendars WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE calendar_visibility ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_visibility_household ON calendar_visibility
  USING (calendar_id IN (SELECT id FROM calendars WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (calendar_id IN (SELECT id FROM calendars WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE calendar_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_changes_household ON calendar_changes
  USING (calendar_id IN (SELECT id FROM calendars WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (calendar_id IN (SELECT id FROM calendars WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE reward_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reward_history_household ON reward_history
  USING (reward_id IN (SELECT id FROM rewards WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (reward_id IN (SELECT id FROM rewards WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE album_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY album_files_household ON album_files
  USING (album_id IN (SELECT id FROM albums WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (album_id IN (SELECT id FROM albums WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE playlist_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY playlist_items_household ON playlist_items
  USING (playlist_id IN (SELECT id FROM playlists WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (playlist_id IN (SELECT id FROM playlists WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tracks_household ON tracks
  USING (file_id IN (SELECT id FROM files WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (file_id IN (SELECT id FROM files WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE tv_episodes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tv_episodes_household ON tv_episodes
  USING (show_id IN (SELECT id FROM tv_shows WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (show_id IN (SELECT id FROM tv_shows WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE photo_metadata ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY photo_metadata_household ON photo_metadata
  USING (file_id IN (SELECT id FROM files WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (file_id IN (SELECT id FROM files WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE thumbnails ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY thumbnails_household ON thumbnails
  USING (file_id IN (SELECT id FROM files WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (file_id IN (SELECT id FROM files WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE device_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY device_rules_household ON device_rules
  USING (device_id IN (SELECT id FROM devices WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (device_id IN (SELECT id FROM devices WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY group_members_household ON group_members
  USING (group_id IN (SELECT id FROM groups WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (group_id IN (SELECT id FROM groups WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE active_cooking_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY active_cooking_sessions_household ON active_cooking_sessions
  USING (recipe_id IN (SELECT id FROM recipes WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (recipe_id IN (SELECT id FROM recipes WHERE household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE event_attendees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY event_attendees_household ON event_attendees
  USING (event_id IN (SELECT m.id FROM calendar_events m JOIN calendars p ON p.id = m.calendar_id WHERE p.household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (event_id IN (SELECT m.id FROM calendar_events m JOIN calendars p ON p.id = m.calendar_id WHERE p.household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE event_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY event_reminders_household ON event_reminders
  USING (event_id IN (SELECT m.id FROM calendar_events m JOIN calendars p ON p.id = m.calendar_id WHERE p.household_id = NULLIF(current_setting('app.household_id', true), '')::uuid))
  WITH CHECK (event_id IN (SELECT m.id FROM calendar_events m JOIN calendars p ON p.id = m.calendar_id WHERE p.household_id = NULLIF(current_setting('app.household_id', true), '')::uuid));

CREATE INDEX IF NOT EXISTS "users_household_id_idx" ON "users" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_household_id_idx" ON "devices" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_permissions_household_id_idx" ON "feature_permissions" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_members_user_id_idx" ON "group_members" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "groups_household_id_idx" ON "groups" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_passwords_user_id_idx" ON "app_passwords" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_access_calendar_id_idx" ON "calendar_access" ("calendar_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_changes_calendar_id_idx" ON "calendar_changes" ("calendar_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_calendar_id_idx" ON "calendar_events" ("calendar_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_visibility_calendar_id_idx" ON "calendar_visibility" ("calendar_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendars_household_id_idx" ON "calendars" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_attendees_user_id_idx" ON "event_attendees" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_attendees_event_id_idx" ON "event_attendees" ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_reminders_user_id_idx" ON "event_reminders" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_reminders_event_id_idx" ON "event_reminders" ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_cooking_sessions_user_id_idx" ON "active_cooking_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_cooking_sessions_recipe_id_idx" ON "active_cooking_sessions" ("recipe_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_plans_household_id_idx" ON "meal_plans" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_plans_recipe_id_idx" ON "meal_plans" ("recipe_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_import_sessions_household_id_idx" ON "recipe_import_sessions" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_import_sessions_user_id_idx" ON "recipe_import_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients" ("recipe_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipes_household_id_idx" ON "recipes" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_units_household_id_idx" ON "custom_units" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingredient_aliases_household_id_idx" ON "ingredient_aliases" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_areas_household_id_idx" ON "inventory_areas" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_household_id_idx" ON "inventory_items" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_stock_area_id_idx" ON "inventory_stock" ("area_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_stock_item_id_idx" ON "inventory_stock" ("item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leftovers_household_id_idx" ON "leftovers" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leftovers_area_id_idx" ON "leftovers" ("area_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_scans_household_id_idx" ON "receipt_scans" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopping_list_household_id_idx" ON "shopping_list" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopping_list_recipe_id_idx" ON "shopping_list" ("recipe_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopping_list_item_id_idx" ON "shopping_list" ("item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_history_task_id_idx" ON "reward_history" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rewards_household_id_idx" ON "rewards" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rewards_user_id_idx" ON "rewards" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_household_id_idx" ON "tasks" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_user_id_idx" ON "tasks" ("assignee_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_files_file_id_idx" ON "album_files" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_files_album_id_idx" ON "album_files" ("album_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "albums_household_id_idx" ON "albums" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_household_id_idx" ON "files" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_folder_id_idx" ON "files" ("folder_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_household_id_type_idx" ON "files" ("household_id", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_household_id_idx" ON "folders" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playlist_items_file_id_idx" ON "playlist_items" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playlists_household_id_idx" ON "playlists" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_items_assignee_user_id_idx" ON "list_items" ("assignee_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_items_list_id_idx" ON "list_items" ("list_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lists_household_id_idx" ON "lists" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_household_id_idx" ON "notifications" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_id_idx" ON "notifications" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_schedules_household_id_idx" ON "backup_schedules" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backups_household_id_idx" ON "backups" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ddns_config_household_id_idx" ON "ddns_config" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extensions_household_id_idx" ON "extensions" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_integrations_household_id_idx" ON "music_integrations" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_integrations_user_id_idx" ON "music_integrations" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_settings_user_id_idx" ON "user_settings" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_partners_household_id_idx" ON "backup_partners" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_storage_household_id_idx" ON "backup_storage" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passphrase_escrow_household_id_idx" ON "passphrase_escrow" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_household_id_idx" ON "audit_log" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_id_idx" ON "audit_log" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_invites_household_id_idx" ON "member_invites" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artists_household_id_idx" ON "artists" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_file_id_idx" ON "favorites" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_user_id_idx" ON "favorites" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hls_streams_file_id_idx" ON "hls_streams" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listen_history_user_id_idx" ON "listen_history" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listen_history_track_id_idx" ON "listen_history" ("track_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_processing_jobs_file_id_idx" ON "media_processing_jobs" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_settings_household_id_idx" ON "media_settings" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movies_household_id_idx" ON "movies" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movies_file_id_idx" ON "movies" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_albums_household_id_idx" ON "music_albums" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_albums_artist_id_idx" ON "music_albums" ("artist_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_metadata_file_id_idx" ON "photo_metadata" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "play_queue_items_track_id_idx" ON "play_queue_items" ("track_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "play_queues_user_id_idx" ON "play_queues" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ratings_file_id_idx" ON "ratings" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ratings_user_id_idx" ON "ratings" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_albums_household_id_idx" ON "smart_albums" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thumbnails_file_id_idx" ON "thumbnails" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_file_id_idx" ON "tracks" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_album_id_idx" ON "tracks" ("album_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_artist_id_idx" ON "tracks" ("artist_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tv_episodes_file_id_idx" ON "tv_episodes" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tv_episodes_show_id_idx" ON "tv_episodes" ("show_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tv_shows_household_id_idx" ON "tv_shows" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watch_progress_file_id_idx" ON "watch_progress" ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watch_progress_user_id_idx" ON "watch_progress" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_parse_sessions_household_id_idx" ON "image_parse_sessions" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_parse_sessions_user_id_idx" ON "image_parse_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bug_reports_household_id_idx" ON "bug_reports" ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bug_reports_user_id_idx" ON "bug_reports" ("user_id");

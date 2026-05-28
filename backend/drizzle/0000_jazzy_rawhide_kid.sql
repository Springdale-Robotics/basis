CREATE TYPE "public"."user_role" AS ENUM('admin', 'member', 'kid', 'visitor');--> statement-breakpoint
CREATE TYPE "public"."device_rule_type" AS ENUM('time_based', 'user_based', 'always');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('mobile', 'tablet', 'tv', 'desktop');--> statement-breakpoint
CREATE TYPE "public"."feature" AS ENUM('recipes', 'inventory', 'meal_plan', 'shopping_list', 'files', 'calendars', 'lists', 'tasks', 'settings');--> statement-breakpoint
CREATE TYPE "public"."grantee_type" AS ENUM('user', 'role', 'group', 'household', 'external', 'device');--> statement-breakpoint
CREATE TYPE "public"."permission_level" AS ENUM('view', 'view_busy', 'edit', 'admin', 'none');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('calendar', 'recipe', 'task', 'file', 'album', 'list', 'page', 'inventory_area', 'feature');--> statement-breakpoint
CREATE TYPE "public"."member_type" AS ENUM('user', 'connected_household_user');--> statement-breakpoint
CREATE TYPE "public"."calendar_access_level" AS ENUM('view_busy', 'view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."calendar_access_principal" AS ENUM('user', 'group', 'role');--> statement-breakpoint
CREATE TYPE "public"."calendar_change_type" AS ENUM('add', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."calendar_type" AS ENUM('individual', 'group', 'synced');--> statement-breakpoint
CREATE TYPE "public"."recurrence_status" AS ENUM('master', 'exception', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reminder_type" AS ENUM('notification', 'email', 'push');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('pending', 'accepted', 'declined', 'maybe');--> statement-breakpoint
CREATE TYPE "public"."sync_provider" AS ENUM('google', 'outlook');--> statement-breakpoint
CREATE TYPE "public"."visibility_scope_type" AS ENUM('user', 'device', 'household');--> statement-breakpoint
CREATE TYPE "public"."import_source_type" AS ENUM('url', 'image', 'pdf', 'text');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('parsing', 'pending_review', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."alias_type" AS ENUM('exact', 'variant', 'brand');--> statement-breakpoint
CREATE TYPE "public"."leftover_source" AS ENUM('recipe', 'restaurant', 'homemade', 'other');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('pantry', 'fridge', 'freezer', 'other');--> statement-breakpoint
CREATE TYPE "public"."receipt_scan_status" AS ENUM('processing', 'pending_review', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shopping_list_source" AS ENUM('manual', 'meal_plan', 'low_stock', 'recipe');--> statement-breakpoint
CREATE TYPE "public"."stock_source" AS ENUM('purchase', 'manual', 'migration', 'implicit_checklist', 'cooking_depletion');--> statement-breakpoint
CREATE TYPE "public"."recurrence_mode" AS ENUM('schedule', 'reset_on_complete');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('task', 'chore');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TYPE "public"."file_type" AS ENUM('photo', 'video', 'music', 'document');--> statement-breakpoint
CREATE TYPE "public"."folder_type" AS ENUM('general', 'photos', 'videos', 'music', 'documents');--> statement-breakpoint
CREATE TYPE "public"."playlist_type" AS ENUM('music', 'video');--> statement-breakpoint
CREATE TYPE "public"."list_type" AS ENUM('checklist', 'reminder', 'notes', 'wishlist');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('low_stock', 'expiring_soon', 'leftover_expiring', 'task_due', 'sync_error', 'backup_complete', 'connection_request', 'general');--> statement-breakpoint
CREATE TYPE "public"."backup_record_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ddns_provider" AS ENUM('cloudflare', 'duckdns', 'noip', 'dynu', 'custom');--> statement-breakpoint
CREATE TYPE "public"."ddns_status" AS ENUM('active', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."music_provider" AS ENUM('spotify', 'youtube_music', 'apple_music');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('active', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pending', 'active', 'paused', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."shared_resource_type" AS ENUM('calendar', 'recipe', 'album', 'task_list');--> statement-breakpoint
CREATE TYPE "public"."sync_change_type" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."member_invite_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."hls_profile" AS ENUM('1080p', '720p', '480p');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."repeat_mode" AS ENUM('off', 'all', 'one');--> statement-breakpoint
CREATE TYPE "public"."thumbnail_size" AS ENUM('sm', 'md', 'lg');--> statement-breakpoint
CREATE TYPE "public"."image_parse_status" AS ENUM('uploading', 'processing', 'review', 'confirmed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."parsed_content_type" AS ENUM('list', 'recipe', 'calendar_event', 'mixed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."processing_stage" AS ENUM('queued', 'vlm_started', 'vlm_done', 'llm_started', 'llm_done');--> statement-breakpoint
CREATE TYPE "public"."bug_report_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"backup_passphrase_hash" text,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"rule_type" "device_rule_type" NOT NULL,
	"condition" jsonb,
	"allowed_pages" jsonb DEFAULT '[]'::jsonb,
	"denied_pages" jsonb DEFAULT '[]'::jsonb,
	"default_user_id" uuid,
	"priority" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_settings" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"screensaver_enabled" boolean DEFAULT false,
	"screensaver_timeout_minutes" integer,
	"screensaver_album_id" uuid,
	"show_calendar_on_screensaver" boolean DEFAULT true,
	"hidden_pages" jsonb DEFAULT '[]'::jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "device_type" NOT NULL,
	"is_fixed" boolean DEFAULT false NOT NULL,
	"allowed_pages" jsonb DEFAULT '[]'::jsonb,
	"default_user_id" uuid,
	"last_seen" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"expires_at" timestamp NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"last_active_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"feature" "feature" NOT NULL,
	"grantee_type" "grantee_type" NOT NULL,
	"grantee_id" varchar(255) NOT NULL,
	"permission_level" "permission_level" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feature_permissions_household_id_feature_grantee_type_grantee_id_unique" UNIQUE("household_id","feature","grantee_type","grantee_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" "resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"grantee_type" "grantee_type" NOT NULL,
	"grantee_id" varchar(255) NOT NULL,
	"permission_level" "permission_level" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"member_type" "member_type" DEFAULT 'user' NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_passwords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '["caldav"]'::jsonb NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "calendar_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"principal_type" "calendar_access_principal" NOT NULL,
	"principal_id" text NOT NULL,
	"permission_level" "calendar_access_level" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"event_uid" varchar(255) NOT NULL,
	"change_type" "calendar_change_type" NOT NULL,
	"sync_token" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"created_by_id" uuid,
	"title" varchar(255) NOT NULL,
	"description" text,
	"location" varchar(500),
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"color" varchar(7),
	"recurrence_rule" text,
	"recurrence_ex_dates" text,
	"recurrence_r_dates" text,
	"recurring_event_id" uuid,
	"original_start_time" timestamp with time zone,
	"recurrence_status" "recurrence_status",
	"external_id" varchar(255),
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_visibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"scope_type" "visibility_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"is_default_visible" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"owner_id" uuid,
	"name" varchar(255) NOT NULL,
	"color" varchar(7) DEFAULT '#3B82F6' NOT NULL,
	"color_index" integer DEFAULT 0 NOT NULL,
	"pattern" varchar(50) DEFAULT 'solid',
	"type" "calendar_type" DEFAULT 'individual' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_read_only" boolean DEFAULT false NOT NULL,
	"is_synced" boolean DEFAULT false NOT NULL,
	"sync_provider" "sync_provider",
	"sync_credentials" text,
	"sync_calendar_id" varchar(255),
	"last_sync_at" timestamp,
	"sync_error" text,
	"public_token" varchar(64),
	"public_token_created_at" timestamp,
	"ctag" varchar(64),
	"sync_token" integer DEFAULT 0 NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"email" varchar(255),
	"display_name" varchar(255),
	"rsvp_status" "rsvp_status" DEFAULT 'pending' NOT NULL,
	"rsvp_at" timestamp,
	"is_organizer" boolean DEFAULT false NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"reminder_type" "reminder_type" DEFAULT 'notification' NOT NULL,
	"minutes_before" integer DEFAULT 15 NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "active_cooking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"active_timers" jsonb DEFAULT '[]'::jsonb,
	"servings_multiplier" numeric(10, 6) DEFAULT '1'
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"planned_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"servings_multiplier" numeric(10, 6) DEFAULT '1',
	"cooked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_import_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" "import_source_type" NOT NULL,
	"source_data" text NOT NULL,
	"parsed_recipe" jsonb,
	"ingredient_matches" jsonb DEFAULT '[]'::jsonb,
	"status" "import_status" DEFAULT 'parsing' NOT NULL,
	"parse_method" varchar(50),
	"parse_confidence" numeric(5, 4),
	"parse_warnings" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"inventory_item_id" uuid,
	"name" varchar(255) NOT NULL,
	"quantity" numeric(10, 3),
	"unit" varchar(50),
	"notes" varchar(255),
	"group_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"instructions" jsonb DEFAULT '[]'::jsonb,
	"prep_time_minutes" integer,
	"cook_time_minutes" integer,
	"servings" integer,
	"image_url" text,
	"image_data" text,
	"image_mime_type" varchar(50),
	"image_width" integer,
	"image_height" integer,
	"source_url" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"timers" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"canonical_item_id" uuid NOT NULL,
	"alias_name" varchar(255) NOT NULL,
	"alias_type" "alias_type" DEFAULT 'exact' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"icon" varchar(50),
	"location_type" "location_type" DEFAULT 'other' NOT NULL,
	"confidence_decay_rate" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"barcode" varchar(255),
	"internal_id" varchar(20),
	"default_unit" varchar(50),
	"default_shelf_life_days" integer,
	"density" numeric(8, 4),
	"quantity_unit_sizes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"needs_conversion" boolean DEFAULT false NOT NULL,
	"category" varchar(100),
	"keep_in_stock" boolean DEFAULT false NOT NULL,
	"min_stock_quantity" numeric(10, 3),
	"default_area_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"quantity" numeric(10, 3) NOT NULL,
	"unit" varchar(50),
	"expiry_date" date,
	"confidence" integer DEFAULT 100 NOT NULL,
	"source" "stock_source" DEFAULT 'manual' NOT NULL,
	"price_per_unit" numeric(10, 4),
	"price_currency" varchar(3) DEFAULT 'USD',
	"verified_at" timestamp,
	"original_quantity" numeric(10, 3),
	"added_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leftovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"source" "leftover_source" DEFAULT 'homemade' NOT NULL,
	"source_recipe_id" uuid,
	"restaurant_name" varchar(255),
	"area_id" uuid,
	"portions" numeric(10, 2) DEFAULT '1',
	"quantity_notes" varchar(255),
	"prepared_at" timestamp DEFAULT now() NOT NULL,
	"expiry_date" date,
	"finished_at" timestamp,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"scanned_by" uuid NOT NULL,
	"image_data" text,
	"raw_ocr_text" text,
	"parsed_items" jsonb DEFAULT '[]'::jsonb,
	"shopping_list_context" jsonb DEFAULT '[]'::jsonb,
	"status" "receipt_scan_status" DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "shopping_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"item_id" uuid,
	"custom_name" varchar(255),
	"quantity" numeric(10, 3),
	"unit" varchar(50),
	"is_checked" boolean DEFAULT false NOT NULL,
	"added_by" uuid NOT NULL,
	"source" "shopping_list_source" DEFAULT 'manual' NOT NULL,
	"sources" "shopping_list_source"[] DEFAULT ARRAY[]::shopping_list_source[] NOT NULL,
	"target_area_id" uuid,
	"recipe_id" uuid,
	"meal_plan_id" uuid,
	"confidence_note" varchar(255),
	"is_delta" boolean DEFAULT false NOT NULL,
	"original_full_quantity" numeric(10, 3),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reward_id" uuid NOT NULL,
	"task_id" uuid,
	"points_change" integer NOT NULL,
	"reason" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"lifetime_points" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"kind" "task_kind" DEFAULT 'task' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"assignee_user_id" uuid,
	"assignee_group_id" uuid,
	"due_date" timestamp,
	"cadence_days" integer,
	"recurrence_mode" "recurrence_mode",
	"recurrence_rule" varchar(255),
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"last_completed_at" timestamp,
	"last_completed_by" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_assignee_xor" CHECK ("tasks"."assignee_user_id" IS NULL OR "tasks"."assignee_group_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "album_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"cover_file_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"folder_id" uuid,
	"filename" varchar(255) NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"type" "file_type" NOT NULL,
	"metadata" jsonb,
	"excluded_from_categories" boolean DEFAULT false NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(255) NOT NULL,
	"type" "folder_type" DEFAULT 'general' NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playlist_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "playlist_type" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"content" text NOT NULL,
	"is_checked" boolean DEFAULT false NOT NULL,
	"due_date" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"parent_item_id" uuid,
	"section_label" varchar(100),
	"assignee_user_id" uuid,
	"notes" text,
	"url" text,
	"price" numeric(10, 2),
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"checked_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "list_type" DEFAULT 'checklist' NOT NULL,
	"icon" varchar(50),
	"color" varchar(7),
	"recipient_user_id" uuid,
	"is_template" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"parent_list_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "notification_type" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"data" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"cron_expression" varchar(100) NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"include_files" boolean DEFAULT true NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255),
	"file_path" text,
	"size_bytes" integer,
	"status" "backup_record_status" DEFAULT 'pending' NOT NULL,
	"includes_files" boolean DEFAULT true NOT NULL,
	"encryption_key_hash" text,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ddns_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"provider" "ddns_provider" NOT NULL,
	"domain" varchar(255) NOT NULL,
	"credentials" text NOT NULL,
	"update_interval_minutes" integer DEFAULT 15 NOT NULL,
	"last_ip" varchar(45),
	"last_updated_at" timestamp,
	"status" "ddns_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"version" varchar(50) NOT NULL,
	"entry_point" text NOT NULL,
	"config_schema" jsonb,
	"config" jsonb DEFAULT '{}'::jsonb,
	"permissions_required" jsonb DEFAULT '[]'::jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"installed_by" uuid NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"provider" "music_provider" NOT NULL,
	"credentials" text NOT NULL,
	"user_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" varchar(50) DEFAULT 'system',
	"hidden_pages" jsonb DEFAULT '[]'::jsonb,
	"notification_preferences" jsonb,
	"calendar_default_view" varchar(50) DEFAULT 'month',
	"theme_override" jsonb,
	"accent_color" varchar(7),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"partner_household_id" uuid NOT NULL,
	"partner_endpoint" text NOT NULL,
	"backup_categories" jsonb DEFAULT '[]'::jsonb,
	"encryption_key_hash" text,
	"last_backup_at" timestamp,
	"backup_status" "backup_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_storage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"source_household_id" uuid NOT NULL,
	"backup_category" varchar(100) NOT NULL,
	"encrypted_data" text NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"backup_timestamp" timestamp NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connected_households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_household_id" uuid NOT NULL,
	"remote_household_id" uuid NOT NULL,
	"remote_household_name" varchar(255) NOT NULL,
	"endpoint_url" text NOT NULL,
	"public_key" text NOT NULL,
	"our_private_key" text NOT NULL,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"connected_at" timestamp,
	"last_sync_at" timestamp,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"invite_code" varchar(32) NOT NULL,
	"pairing_token" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_by_household_id" uuid,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connection_invites_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "passphrase_escrow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"stored_by_household_id" uuid NOT NULL,
	"encrypted_passphrase" text NOT NULL,
	"hint" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"resource_type" "shared_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"shared_with_household_id" uuid NOT NULL,
	"permission_level" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_household_id" uuid NOT NULL,
	"resource_type" "shared_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"change_type" "sync_change_type" NOT NULL,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synced_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"source_household_id" uuid NOT NULL,
	"resource_type" "shared_resource_type" NOT NULL,
	"source_resource_id" uuid NOT NULL,
	"local_resource_id" uuid NOT NULL,
	"permission_level" varchar(20) NOT NULL,
	"last_synced_at" timestamp,
	"sync_cursor" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100),
	"resource_id" uuid,
	"old_values" jsonb,
	"new_values" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"request_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"email" varchar(255),
	"invite_code" varchar(32) NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"status" "member_invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_invites_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"sort_name" varchar(500),
	"musicbrainz_id" varchar(50),
	"biography" text,
	"image_url" text,
	"image_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hls_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"profile" "hls_profile" NOT NULL,
	"master_playlist_path" text NOT NULL,
	"segment_base_path" text NOT NULL,
	"ready" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listen_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"listened_at" timestamp DEFAULT now() NOT NULL,
	"duration" integer
);
--> statement-breakpoint
CREATE TABLE "media_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"enable_tmdb" boolean DEFAULT true,
	"enable_musicbrainz" boolean DEFAULT true,
	"enable_transcoding" boolean DEFAULT true,
	"tmdb_api_key" text,
	"transcode_profiles" jsonb DEFAULT '["720p","480p"]'::jsonb,
	"auto_scan_enabled" boolean DEFAULT false,
	"auto_scan_interval" integer DEFAULT 3600,
	"last_scan_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "media_settings_household_id_unique" UNIQUE("household_id")
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"overview" text,
	"release_date" date,
	"runtime" integer,
	"genres" jsonb,
	"poster_path" text,
	"backdrop_path" text,
	"director" varchar(255),
	"cast" jsonb,
	"tmdb_id" integer,
	"imdb_id" varchar(20),
	"tmdb_rating" real,
	"matched_at" timestamp,
	"manual_match" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "movies_file_id_unique" UNIQUE("file_id")
);
--> statement-breakpoint
CREATE TABLE "music_albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"artist_id" uuid,
	"name" varchar(500) NOT NULL,
	"release_date" date,
	"release_type" varchar(50),
	"genres" jsonb,
	"cover_art_path" text,
	"total_tracks" integer DEFAULT 0,
	"total_discs" integer DEFAULT 1,
	"musicbrainz_id" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"camera_make" varchar(100),
	"camera_model" varchar(100),
	"lens_model" varchar(100),
	"focal_length" real,
	"aperture" real,
	"shutter_speed" varchar(20),
	"iso" integer,
	"latitude" real,
	"longitude" real,
	"location_name" varchar(255),
	"date_taken" timestamp,
	"orientation" integer,
	"tags" jsonb,
	"raw_exif" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "photo_metadata_file_id_unique" UNIQUE("file_id")
);
--> statement-breakpoint
CREATE TABLE "play_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"current_index" integer DEFAULT 0,
	"current_position" integer DEFAULT 0,
	"shuffled" boolean DEFAULT false,
	"repeat_mode" "repeat_mode" DEFAULT 'off',
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "play_queues_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"criteria" jsonb NOT NULL,
	"cover_file_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thumbnails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"size" "thumbnail_size" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"storage_path" text NOT NULL,
	"blur_hash" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"album_id" uuid,
	"artist_id" uuid,
	"title" varchar(500) NOT NULL,
	"track_number" integer,
	"disc_number" integer DEFAULT 1,
	"duration" integer,
	"bitrate" integer,
	"sample_rate" integer,
	"channels" integer,
	"album_artist" varchar(500),
	"composer" varchar(500),
	"genre" varchar(100),
	"year" integer,
	"musicbrainz_id" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_file_id_unique" UNIQUE("file_id")
);
--> statement-breakpoint
CREATE TABLE "tv_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"name" varchar(500),
	"overview" text,
	"air_date" date,
	"still_path" text,
	"runtime" integer,
	"tmdb_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tv_episodes_file_id_unique" UNIQUE("file_id")
);
--> statement-breakpoint
CREATE TABLE "tv_shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"overview" text,
	"status" varchar(50),
	"first_air_date" date,
	"genres" jsonb,
	"poster_path" text,
	"backdrop_path" text,
	"number_of_seasons" integer DEFAULT 0,
	"number_of_episodes" integer DEFAULT 0,
	"tmdb_id" integer,
	"imdb_id" varchar(20),
	"tmdb_rating" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"completed" boolean DEFAULT false,
	"completed_at" timestamp,
	"last_watched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_parse_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"original_image_path" text,
	"image_mime_type" varchar(50),
	"status" "image_parse_status" DEFAULT 'uploading' NOT NULL,
	"processing_stage" "processing_stage",
	"extraction_mode" varchar(20) DEFAULT 'accurate',
	"raw_text" text,
	"detected_type" "parsed_content_type",
	"confidence" numeric(5, 4),
	"parsed_content" jsonb,
	"selected_type" "parsed_content_type",
	"user_edits" jsonb,
	"parse_warnings" jsonb DEFAULT '[]'::jsonb,
	"processing_time_ms" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"description" text NOT NULL,
	"url" text NOT NULL,
	"user_agent" text,
	"app_version" varchar(50),
	"console_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"screenshot" text,
	"viewport" jsonb,
	"status" "bug_report_status" DEFAULT 'pending' NOT NULL,
	"github_issue_number" integer,
	"github_issue_url" text,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_rules" ADD CONSTRAINT "device_rules_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_rules" ADD CONSTRAINT "device_rules_default_user_id_users_id_fk" FOREIGN KEY ("default_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_settings" ADD CONSTRAINT "device_settings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_default_user_id_users_id_fk" FOREIGN KEY ("default_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_permissions" ADD CONSTRAINT "feature_permissions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_passwords" ADD CONSTRAINT "app_passwords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_access" ADD CONSTRAINT "calendar_access_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_changes" ADD CONSTRAINT "calendar_changes_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_recurring_event_id_calendar_events_id_fk" FOREIGN KEY ("recurring_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_visibility" ADD CONSTRAINT "calendar_visibility_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_cooking_sessions" ADD CONSTRAINT "active_cooking_sessions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_cooking_sessions" ADD CONSTRAINT "active_cooking_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_cooking_sessions" ADD CONSTRAINT "active_cooking_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_import_sessions" ADD CONSTRAINT "recipe_import_sessions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_import_sessions" ADD CONSTRAINT "recipe_import_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_units" ADD CONSTRAINT "custom_units_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_aliases" ADD CONSTRAINT "ingredient_aliases_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_aliases" ADD CONSTRAINT "ingredient_aliases_canonical_item_id_inventory_items_id_fk" FOREIGN KEY ("canonical_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_areas" ADD CONSTRAINT "inventory_areas_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_default_area_id_inventory_areas_id_fk" FOREIGN KEY ("default_area_id") REFERENCES "public"."inventory_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_area_id_inventory_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."inventory_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftovers" ADD CONSTRAINT "leftovers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftovers" ADD CONSTRAINT "leftovers_source_recipe_id_recipes_id_fk" FOREIGN KEY ("source_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftovers" ADD CONSTRAINT "leftovers_area_id_inventory_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."inventory_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftovers" ADD CONSTRAINT "leftovers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_target_area_id_inventory_areas_id_fk" FOREIGN KEY ("target_area_id") REFERENCES "public"."inventory_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_history" ADD CONSTRAINT "reward_history_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_history" ADD CONSTRAINT "reward_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_group_id_groups_id_fk" FOREIGN KEY ("assignee_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_last_completed_by_users_id_fk" FOREIGN KEY ("last_completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_files" ADD CONSTRAINT "album_files_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_files" ADD CONSTRAINT "album_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddns_config" ADD CONSTRAINT "ddns_config_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_integrations" ADD CONSTRAINT "music_integrations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_integrations" ADD CONSTRAINT "music_integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_partners" ADD CONSTRAINT "backup_partners_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_storage" ADD CONSTRAINT "backup_storage_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_households" ADD CONSTRAINT "connected_households_local_household_id_households_id_fk" FOREIGN KEY ("local_household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_invites" ADD CONSTRAINT "connection_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_invites" ADD CONSTRAINT "connection_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passphrase_escrow" ADD CONSTRAINT "passphrase_escrow_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_resources" ADD CONSTRAINT "shared_resources_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_resources" ADD CONSTRAINT "shared_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_resources" ADD CONSTRAINT "synced_resources_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hls_streams" ADD CONSTRAINT "hls_streams_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_history" ADD CONSTRAINT "listen_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_history" ADD CONSTRAINT "listen_history_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_processing_jobs" ADD CONSTRAINT "media_processing_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_settings" ADD CONSTRAINT "media_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "movies_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "movies_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_albums" ADD CONSTRAINT "music_albums_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_albums" ADD CONSTRAINT "music_albums_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_metadata" ADD CONSTRAINT "photo_metadata_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_queue_items" ADD CONSTRAINT "play_queue_items_queue_id_play_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."play_queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_queue_items" ADD CONSTRAINT "play_queue_items_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_queues" ADD CONSTRAINT "play_queues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_albums" ADD CONSTRAINT "smart_albums_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_albums" ADD CONSTRAINT "smart_albums_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_albums" ADD CONSTRAINT "smart_albums_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thumbnails" ADD CONSTRAINT "thumbnails_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_album_id_music_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."music_albums"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_episodes" ADD CONSTRAINT "tv_episodes_show_id_tv_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."tv_shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_episodes" ADD CONSTRAINT "tv_episodes_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_shows" ADD CONSTRAINT "tv_shows_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_parse_sessions" ADD CONSTRAINT "image_parse_sessions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_parse_sessions" ADD CONSTRAINT "image_parse_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_passwords_user_id_idx" ON "app_passwords" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_units_household_key_idx" ON "custom_units" USING btree ("household_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_aliases_household_name_idx" ON "ingredient_aliases" USING btree ("household_id","alias_name");
DROP TABLE IF EXISTS "sync_queue" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "synced_resources" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "shared_resources" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "connection_invites" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "connected_households" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."connection_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."invite_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."shared_resource_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."sync_change_type";

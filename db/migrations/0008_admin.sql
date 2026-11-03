CREATE TYPE "public"."flag_status" AS ENUM('open', 'handled');--> statement-breakpoint
CREATE TYPE "public"."job_name" AS ENUM('purge_guests', 'expire_trades', 'settle_auctions', 'check_ledger');--> statement-breakpoint
CREATE TYPE "public"."session_revoke" AS ENUM('sign_out', 'admin', 'ban', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."staff_cancel" AS ENUM('ban', 'admin', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('viewer', 'moderator', 'admin');--> statement-breakpoint
ALTER TYPE "public"."acquired_via" ADD VALUE 'admin';--> statement-breakpoint
ALTER TYPE "public"."item_source" ADD VALUE 'admin';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'admin_grant';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'admin_remove';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'admin_item_grant';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'admin_item_in';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'admin_item_out';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'admin_item_restore';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'admin_clawback';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'account_delete';--> statement-breakpoint
CREATE TABLE "admin_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_discord_id" text,
	"staff_name" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_label" text NOT NULL,
	"change" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "flag_players" (
	"flag_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "flag_players_flag_id_user_id_pk" PRIMARY KEY("flag_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"trade_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" "job_name" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"count" integer,
	"result" text,
	"duration_ms" integer,
	"triggered_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_days" (
	"day" date NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "player_days_day_user_id_pk" PRIMARY KEY("day","user_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reporter_id" uuid,
	"target_id" uuid NOT NULL,
	"category" text NOT NULL,
	"message" text,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"discord_id" text PRIMARY KEY NOT NULL,
	"role" "staff_role" NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"staff_name" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_guest_or_discord";--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "number" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "auctions_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "cancel_reason" "staff_cancel";--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "dry_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "staff_name" text;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "report" jsonb;--> statement-breakpoint
ALTER TABLE "crates" ADD COLUMN "is_new" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "showcase_blocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked_reason" "session_revoke";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "skins" ADD COLUMN "image_broken" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "skins" ADD COLUMN "image_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "number" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "trades_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "cancel_reason" "staff_cancel";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ban_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flag_players" ADD CONSTRAINT "flag_players_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_players" ADD CONSTRAINT "flag_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_days" ADD CONSTRAINT "player_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_log_time_idx" ON "admin_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_log_target_idx" ON "admin_log" USING btree ("target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "flag_players_user_idx" ON "flag_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flags_status_idx" ON "flags" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "staff_notes_user_idx" ON "staff_notes" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_ip_idx" ON "sessions" USING btree ("ip_hash");--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_number_unique" UNIQUE("number");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_guest_or_discord" CHECK ("users"."is_guest" OR "users"."discord_id" IS NOT NULL OR "users"."deleted_at" IS NOT NULL);--> statement-breakpoint
-- The NEW badge used to be computed (newest released active case): keep it on that case.
UPDATE "crates" SET "is_new" = true WHERE "id" = (SELECT "id" FROM "crates" WHERE "is_active" ORDER BY "released_on" DESC NULLS LAST, "id" LIMIT 1);

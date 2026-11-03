CREATE TYPE "public"."auth_flow_status" AS ENUM('pending', 'success', 'conflict', 'error', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('case');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('available', 'listed', 'in_trade', 'destroyed');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('starting_balance', 'case_open', 'free_case_open');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('web', 'activity');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('milspec', 'restricted', 'classified', 'covert', 'gold');--> statement-breakpoint
CREATE TABLE "auth_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"poll_secret_hash" "bytea" NOT NULL,
	"guest_user_id" uuid,
	"status" "auth_flow_status" DEFAULT 'pending' NOT NULL,
	"discord_id" text,
	"discord_profile" jsonb,
	"result_user_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_flows_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "case_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"crate_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"price_paid" integer NOT NULL,
	"free" boolean NOT NULL,
	"request_id" uuid NOT NULL,
	"strip" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_openings_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"source_commit" text NOT NULL,
	"counts" jsonb,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_url" text
);
--> statement-breakpoint
CREATE TABLE "crate_items" (
	"crate_id" text NOT NULL,
	"skin_id" text NOT NULL,
	"tier" "tier" NOT NULL,
	"special" boolean NOT NULL,
	CONSTRAINT "crate_items_crate_id_skin_id_pk" PRIMARY KEY("crate_id","skin_id")
);
--> statement-breakpoint
CREATE TABLE "crates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_url" text NOT NULL,
	"price" integer NOT NULL,
	"released_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skin_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"float" double precision,
	"pattern" smallint NOT NULL,
	"stattrak" boolean NOT NULL,
	"tier" "tier" NOT NULL,
	"status" "item_status" DEFAULT 'available' NOT NULL,
	"source" "item_source" NOT NULL,
	"source_crate_id" text,
	"original_owner_id" uuid,
	"obtained_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_pattern_range" CHECK ("items"."pattern" BETWEEN 0 AND 999),
	CONSTRAINT "items_float_range" CHECK ("items"."float" IS NULL OR ("items"."float" >= 0 AND "items"."float" <= 1))
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "ledger_type" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"item_id" uuid,
	"crate_id" text,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"kind" "session_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "skins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"weapon_name" text NOT NULL,
	"finish_name" text,
	"category" text NOT NULL,
	"api_rarity_id" text NOT NULL,
	"min_float" double precision,
	"max_float" double precision,
	"stattrak_available" boolean NOT NULL,
	"phase" text,
	"paint_index" text,
	"image_url" text NOT NULL,
	"collection_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skins_float_range" CHECK (("skins"."min_float" IS NULL) = ("skins"."max_float" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text,
	"username" text,
	"display_name" text,
	"avatar_hash" text,
	"is_guest" boolean NOT NULL,
	"balance" bigint NOT NULL,
	"last_free_case_at" timestamp with time zone,
	"created_ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_balance_non_negative" CHECK ("users"."balance" >= 0),
	CONSTRAINT "users_guest_or_discord" CHECK ("users"."is_guest" OR "users"."discord_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "auth_flows" ADD CONSTRAINT "auth_flows_guest_user_id_users_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_flows" ADD CONSTRAINT "auth_flows_result_user_id_users_id_fk" FOREIGN KEY ("result_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_openings" ADD CONSTRAINT "case_openings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_openings" ADD CONSTRAINT "case_openings_crate_id_crates_id_fk" FOREIGN KEY ("crate_id") REFERENCES "public"."crates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_openings" ADD CONSTRAINT "case_openings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crate_items" ADD CONSTRAINT "crate_items_crate_id_crates_id_fk" FOREIGN KEY ("crate_id") REFERENCES "public"."crates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crate_items" ADD CONSTRAINT "crate_items_skin_id_skins_id_fk" FOREIGN KEY ("skin_id") REFERENCES "public"."skins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_skin_id_skins_id_fk" FOREIGN KEY ("skin_id") REFERENCES "public"."skins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_source_crate_id_crates_id_fk" FOREIGN KEY ("source_crate_id") REFERENCES "public"."crates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_original_owner_id_users_id_fk" FOREIGN KEY ("original_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_crate_id_crates_id_fk" FOREIGN KEY ("crate_id") REFERENCES "public"."crates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skins" ADD CONSTRAINT "skins_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_openings_request_idx" ON "case_openings" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "crate_items_skin_idx" ON "crate_items" USING btree ("skin_id");--> statement-breakpoint
CREATE INDEX "items_owner_idx" ON "items" USING btree ("owner_id","status","obtained_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_user_idx" ON "ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_guest_ip_idx" ON "users" USING btree ("created_ip_hash","created_at");
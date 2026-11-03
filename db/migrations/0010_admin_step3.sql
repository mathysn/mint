ALTER TYPE "public"."ledger_type" ADD VALUE 'admin_gift';--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text
);
--> statement-breakpoint
CREATE TABLE "economy_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "error_counts" (
	"hour" timestamp with time zone NOT NULL,
	"code" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "error_counts_hour_code_pk" PRIMARY KEY("hour","code")
);
--> statement-breakpoint
CREATE TABLE "server_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"code" text NOT NULL,
	"route" text NOT NULL,
	"message" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_errors_group" UNIQUE("hour","code","route","message")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "hidden_by" text;--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "fee_bp" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "monitor" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "handled_by" text;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "handled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flags" ADD COLUMN "handled_note" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "handled_by" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "handled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "handled_note" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bonus_free_cases" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "announcements_window_idx" ON "announcements" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "server_errors_last_idx" ON "server_errors" USING btree ("last_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "flags_open_fingerprint_idx" ON "flags" USING btree ("fingerprint") WHERE "flags"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_pair_idx" ON "reports" USING btree ("reporter_id","target_id") WHERE "reports"."status" = 'open';
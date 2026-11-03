ALTER TYPE "public"."ledger_type" ADD VALUE 'daily_reward';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'recycle';--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "destroyed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_daily_reward_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_destroyed_at" CHECK (("items"."status" = 'destroyed') = ("items"."destroyed_at" IS NOT NULL));
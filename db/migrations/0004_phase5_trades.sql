CREATE TYPE "public"."acquired_via" AS ENUM('case', 'trade');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('sender', 'recipient');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired');--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'trade_hold';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'trade_release';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'trade_credit_in';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'trade_credit_out';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'trade_item_in';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'trade_item_out';--> statement-breakpoint
CREATE TABLE "trade_items" (
	"trade_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"side" "trade_side" NOT NULL,
	CONSTRAINT "trade_items_trade_id_item_id_pk" PRIMARY KEY("trade_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"sender_credits" bigint DEFAULT 0 NOT NULL,
	"recipient_credits" bigint DEFAULT 0 NOT NULL,
	"status" "trade_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"counter_of" uuid,
	CONSTRAINT "trades_credits" CHECK ("trades"."sender_credits" >= 0 AND "trades"."recipient_credits" >= 0),
	CONSTRAINT "trades_two_players" CHECK ("trades"."sender_id" <> "trades"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "acquired_via" "acquired_via" DEFAULT 'case' NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_counter_of_trades_id_fk" FOREIGN KEY ("counter_of") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trade_items_item_idx" ON "trade_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "trades_sender_idx" ON "trades" USING btree ("sender_id","status");--> statement-breakpoint
CREATE INDEX "trades_recipient_idx" ON "trades" USING btree ("recipient_id","status");--> statement-breakpoint
CREATE INDEX "trades_expiry_idx" ON "trades" USING btree ("status","expires_at");
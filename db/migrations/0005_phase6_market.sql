CREATE TYPE "public"."auction_status" AS ENUM('active', 'sold', 'unsold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."wear" AS ENUM('FN', 'MW', 'FT', 'WW', 'BS');--> statement-breakpoint
ALTER TYPE "public"."acquired_via" ADD VALUE 'market';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'sale';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'bid_hold';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'bid_release';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'auction_buy';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'auction_sale';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'auction_fee';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'auction_item_in';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'auction_item_out';--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"start_price" bigint NOT NULL,
	"buy_now_price" bigint,
	"duration_hours" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "auction_status" DEFAULT 'active' NOT NULL,
	"leader_id" uuid,
	"current_bid" bigint,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"buyer_id" uuid,
	"final_price" bigint,
	"fee" bigint,
	"bought_now" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "auctions_prices" CHECK ("auctions"."start_price" >= 1 AND ("auctions"."buy_now_price" IS NULL OR "auctions"."buy_now_price" > "auctions"."start_price"))
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"auction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"auction_id" uuid,
	"skin_id" text NOT NULL,
	"stattrak" boolean NOT NULL,
	"wear" "wear",
	"price" bigint NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sales_auction_id_unique" UNIQUE("auction_id")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "price" bigint;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_skin_id_skins_id_fk" FOREIGN KEY ("skin_id") REFERENCES "public"."skins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_item_active_idx" ON "auctions" USING btree ("item_id") WHERE "auctions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "auctions_due_idx" ON "auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "auctions_seller_idx" ON "auctions" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "auctions_leader_idx" ON "auctions" USING btree ("leader_id","status");--> statement-breakpoint
CREATE INDEX "bids_auction_idx" ON "bids" USING btree ("auction_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bids_user_idx" ON "bids" USING btree ("user_id","auction_id");--> statement-breakpoint
CREATE INDEX "sales_skin_idx" ON "sales" USING btree ("skin_id","stattrak","wear","sold_at" DESC NULLS LAST);
ALTER TYPE "public"."acquired_via" ADD VALUE 'tradeup';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'tradeup';--> statement-breakpoint
ALTER TYPE "public"."item_source" ADD VALUE 'tradeup';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'tradeup_in';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'tradeup_out';--> statement-breakpoint
CREATE TABLE "market_prices" (
	"skin_id" text NOT NULL,
	"stattrak" boolean NOT NULL,
	"wear" "wear",
	"avg_price" bigint NOT NULL,
	"sales_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_prices_key" UNIQUE NULLS NOT DISTINCT("skin_id","stattrak","wear")
);
--> statement-breakpoint
CREATE TABLE "trade_up_inputs" (
	"trade_up_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "trade_up_inputs_trade_up_id_item_id_pk" PRIMARY KEY("trade_up_id","item_id"),
	CONSTRAINT "trade_up_inputs_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE "trade_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" "tier" NOT NULL,
	"stattrak" boolean NOT NULL,
	"avg_float" double precision NOT NULL,
	"result_item_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_ups_result_item_id_unique" UNIQUE("result_item_id")
);
--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_skin_id_skins_id_fk" FOREIGN KEY ("skin_id") REFERENCES "public"."skins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_up_inputs" ADD CONSTRAINT "trade_up_inputs_trade_up_id_trade_ups_id_fk" FOREIGN KEY ("trade_up_id") REFERENCES "public"."trade_ups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_up_inputs" ADD CONSTRAINT "trade_up_inputs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ups" ADD CONSTRAINT "trade_ups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ups" ADD CONSTRAINT "trade_ups_result_item_id_items_id_fk" FOREIGN KEY ("result_item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_ups_request_idx" ON "trade_ups" USING btree ("user_id","request_id");
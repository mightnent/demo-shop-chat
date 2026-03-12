CREATE TABLE "claims_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"route_key" text NOT NULL,
	"page_url" text NOT NULL,
	"path_prefixes" jsonb NOT NULL,
	"keywords" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "claims_routes_tenant_key_idx" ON "claims_routes" USING btree ("tenant_id","route_key");--> statement-breakpoint
CREATE INDEX "claims_routes_tenant_updated_idx" ON "claims_routes" USING btree ("tenant_id","updated_at");
CREATE TYPE "public"."router_rule_status" AS ENUM('proposed', 'active', 'archived', 'rejected');--> statement-breakpoint
CREATE TABLE "router_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"entity" text,
	"data" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "router_audit_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "router_decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid,
	"member_id" uuid,
	"call_id" text,
	"requested" text,
	"chosen" text,
	"applied" text,
	"rule_id" uuid,
	"sticky" boolean DEFAULT false NOT NULL,
	"shadow" boolean DEFAULT false NOT NULL,
	"request_class" text,
	"session_id" text,
	"chars" integer,
	"tools" boolean,
	"stream" boolean,
	"masked" integer DEFAULT 0 NOT NULL,
	"status" integer,
	"ttfb_ms" integer,
	"total_ms" integer,
	"fallback" boolean DEFAULT false NOT NULL,
	"blocked" text,
	"prompt_hash" text
);
--> statement-breakpoint
CREATE TABLE "router_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"key_token" text NOT NULL,
	"key_alias" text NOT NULL,
	"key_preview" text NOT NULL,
	"monthly_budget_usd" double precision NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "router_members_key_token_unique" UNIQUE("key_token")
);
--> statement-breakpoint
CREATE TABLE "router_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"lineage" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"condition" jsonb NOT NULL,
	"target" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" "router_rule_status" DEFAULT 'active' NOT NULL,
	"reason" text,
	"created_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "confidential" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "allowed_groups" text[] DEFAULT '{"fast","smart"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "shadow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "mask_secrets" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "router_members" ADD CONSTRAINT "router_members_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "router_rules" ADD CONSTRAINT "router_rules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "router_decisions_at_idx" ON "router_decisions" USING btree ("at");--> statement-breakpoint
CREATE INDEX "router_decisions_client_idx" ON "router_decisions" USING btree ("client_id","at");--> statement-breakpoint
CREATE INDEX "router_decisions_rule_idx" ON "router_decisions" USING btree ("rule_id","at");--> statement-breakpoint
CREATE INDEX "router_members_client_idx" ON "router_members" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "router_rules_status_idx" ON "router_rules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "router_rules_lineage_idx" ON "router_rules" USING btree ("lineage","version");
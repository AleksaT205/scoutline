CREATE TYPE "public"."client_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."router_mode" AS ENUM('auto', 'fast', 'smart');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"key_token" text NOT NULL,
	"key_alias" text NOT NULL,
	"key_preview" text NOT NULL,
	"monthly_budget_usd" double precision NOT NULL,
	"default_mode" "router_mode" DEFAULT 'auto' NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_key_token_unique" UNIQUE("key_token")
);

CREATE TYPE "public"."lead_type" AS ENUM('tender', 'project', 'intent', 'hiring_signal');--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lead_type" "lead_type";--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "kind_hint" "lead_type";--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "budget_hint_eur" integer;--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "country_hint" text;
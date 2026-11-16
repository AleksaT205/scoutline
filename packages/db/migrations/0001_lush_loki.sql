ALTER TABLE "leads" ADD COLUMN "why" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "urgency" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "email_subject" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "email_body" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "scored_by" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "notified_at" timestamp with time zone;
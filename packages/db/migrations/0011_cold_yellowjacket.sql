ALTER TABLE "sources" ADD COLUMN "custom_interval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "run_requested_at" timestamp with time zone;
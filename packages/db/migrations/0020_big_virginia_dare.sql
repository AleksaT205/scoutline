ALTER TABLE "leads" ADD COLUMN "follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "follow_up_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "duplicate_of" uuid;--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "title_key" text;--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("follow_up_at");--> statement-breakpoint
CREATE INDEX "raw_items_title_key_idx" ON "raw_items" USING btree ("title_key");
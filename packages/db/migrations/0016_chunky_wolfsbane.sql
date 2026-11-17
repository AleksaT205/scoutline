CREATE INDEX "leads_raw_item_idx" ON "leads" USING btree ("raw_item_id");--> statement-breakpoint
CREATE INDEX "raw_items_source_idx" ON "raw_items" USING btree ("source_id");
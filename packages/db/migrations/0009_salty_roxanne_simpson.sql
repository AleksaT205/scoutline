CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_id" uuid,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"minutes" integer NOT NULL,
	"spent_on" timestamp with time zone NOT NULL,
	"note" text,
	"billable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "billing" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hourly_rate_eur" integer;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_project_idx" ON "time_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "time_entries_issue_idx" ON "time_entries" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "time_entries_spent_idx" ON "time_entries" USING btree ("spent_on");
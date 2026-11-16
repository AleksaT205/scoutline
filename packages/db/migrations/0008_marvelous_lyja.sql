ALTER TYPE "public"."issue_status" ADD VALUE 'triage' BEFORE 'backlog';--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_portals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"allow_requests" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_portals_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_import" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_links" ADD CONSTRAINT "issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_portals" ADD CONSTRAINT "project_portals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_portals" ADD CONSTRAINT "project_portals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cycles_number_idx" ON "cycles" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_links_unique_idx" ON "issue_links" USING btree ("issue_id","kind","repo","number");--> statement-breakpoint
CREATE INDEX "issue_links_repo_idx" ON "issue_links" USING btree ("repo","number");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE set null ON UPDATE no action;
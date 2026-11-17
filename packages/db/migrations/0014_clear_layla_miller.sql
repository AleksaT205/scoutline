CREATE TABLE "deploys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"hook_name" text NOT NULL,
	"actor" text NOT NULL,
	"ok" boolean NOT NULL,
	"status" integer,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"repo_url" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_links" ADD COLUMN "remote_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_sync" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deploy_hooks" jsonb;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deploys_project_idx" ON "deploys" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repos_unique_idx" ON "project_repos" USING btree ("project_id","repo_url");
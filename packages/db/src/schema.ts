import { bigserial, boolean, customType, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { INDUSTRIES, ISSUE_STATUSES, LEAD_STATUSES, LEAD_TYPES, PROJECT_STATUSES, SERVICE_CATEGORIES, type RuleCondition } from "@radar/shared";

export const tierEnum = pgEnum("tier", ["T1", "T2", "T3", "DOMESTIC"]);
export const categoryEnum = pgEnum("service_category", SERVICE_CATEGORIES);
export const industryEnum = pgEnum("industry", INDUSTRIES);
export const statusEnum = pgEnum("lead_status", LEAD_STATUSES);
export const sourceKindEnum = pgEnum("source_kind", ["api", "rss", "scrape", "manual", "email"]);
export const leadTypeEnum = pgEnum("lead_type", LEAD_TYPES);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/** Izvori oglasa (RemoteOK, HN, Infostud…). */
export const sources = pgTable("sources", {
  id: text("id").primaryKey(), // npr. "remoteok"
  name: text("name").notNull(),
  kind: sourceKindEnum("kind").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  intervalMinutes: integer("interval_minutes").default(60).notNull(),
  customInterval: boolean("custom_interval").default(false).notNull(), // raspored menjan u aplikaciji — worker ga ne vraća
  runRequestedAt: timestamp("run_requested_at", { withTimezone: true }), // „Run now“ iz aplikacije
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps,
});

/** Sirov oglas tačno kako je stigao — za dedup i ponovnu obradu. */
export const rawItems = pgTable(
  "raw_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id").references(() => sources.id).notNull(),
    externalId: text("external_id"),
    url: text("url").notNull(),
    urlHash: text("url_hash").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    companyName: text("company_name"),
    location: text("location"),
    salaryText: text("salary_text"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    // Podaci koje izvor zna sigurno (tenderi): tip, rok, budžet, zemlja
    kindHint: leadTypeEnum("kind_hint"),
    deadline: timestamp("deadline", { withTimezone: true }),
    budgetHintEur: integer("budget_hint_eur"),
    countryHint: text("country_hint"),
    payload: jsonb("payload"),
    titleKey: text("title_key"), // normalizovan naslov — isti oglas iz drugog izvora (duplikat)
    ...timestamps,
  },
  (t) => [uniqueIndex("raw_items_url_hash_idx").on(t.urlHash), index("raw_items_source_idx").on(t.sourceId), index("raw_items_title_key_idx").on(t.titleKey)],
);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domain: text("domain"),
  country: text("country"), // ISO alpha-2
  tier: tierEnum("tier"),
  industry: industryEnum("industry"),
  size: text("size"),
  ...timestamps,
});

/** Ocenjen lead — ono što tim vidi u dashboard-u. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rawItemId: uuid("raw_item_id").references(() => rawItems.id).notNull(),
    companyId: uuid("company_id").references(() => companies.id),
    aiScore: integer("ai_score"),
    score: integer("score"), // konačna ocena (tier + bonusi)
    category: categoryEnum("category"),
    leadType: leadTypeEnum("lead_type"),
    industry: industryEnum("industry"),
    country: text("country"),
    tier: tierEnum("tier"),
    remoteOk: boolean("remote_ok"),
    budgetEur: integer("budget_eur"),
    language: text("language"),
    painPoint: text("pain_point"),
    ourOffer: text("our_offer"),
    redFlags: jsonb("red_flags").$type<string[]>(),
    why: jsonb("why").$type<string[]>(),
    urgency: text("urgency"),
    emailSubject: text("email_subject"),
    emailBody: text("email_body"),
    scoredBy: text("scored_by"), // "ai:<model>" | "rules"
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    status: statusEnum("status").default("new").notNull(),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }), // podsetnik „javi se ponovo“
    followUpNotifiedAt: timestamp("follow_up_notified_at", { withTimezone: true }),
    duplicateOf: uuid("duplicate_of"), // isti oglas već postoji iz drugog izvora (ovaj je sakriven)
    ...timestamps,
  },
  (t) => [index("leads_follow_up_idx").on(t.followUpAt), index("leads_score_idx").on(t.score), index("leads_status_idx").on(t.status), index("leads_raw_item_idx").on(t.rawItemId)],
);

/** Istorija: promene statusa, beleške, poslati email-ovi. */
export const leadEvents = pgTable("lead_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id).notNull(),
  type: text("type").notNull(), // status_changed | note | email_drafted | email_sent
  data: jsonb("data"),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** AI Router: klijent agencije sa sopstvenim LiteLLM ključem i mesečnim budžetom. */
export const clientStatusEnum = pgEnum("client_status", ["active", "revoked"]);
export const routerModeEnum = pgEnum("router_mode", ["auto", "fast", "smart"]);

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email"),
  keyToken: text("key_token").notNull().unique(), // heš ključa u LiteLLM-u (pravi ključ se ne čuva)
  keyAlias: text("key_alias").notNull(),
  keyPreview: text("key_preview").notNull(), // npr. "sk-…nr0g"
  monthlyBudgetUsd: doublePrecision("monthly_budget_usd").notNull(),
  defaultMode: routerModeEnum("default_mode").default("auto").notNull(),
  status: clientStatusEnum("status").default("active").notNull(),
  projectId: uuid("project_id"), // Faza 12: AI trošak ovog ključa ide na projekat (veza bez FK — tabela projects je ispod)
  // Router 2.0: poverljiv klijent ide samo na privatne grupe (local); dozvoljene grupe važe i u LiteLLM ključu
  confidential: boolean("confidential").default(false).notNull(),
  allowedGroups: text("allowed_groups").array().default(["fast", "smart"]).notNull(),
  shadow: boolean("shadow").default(false).notNull(), // samo beleži šta bi ruter izabrao, model se ne menja
  maskSecrets: boolean("mask_secrets").default(true).notNull(), // maskiranje ključeva/lozinki pre slanja na besplatne nivoe
  teamId: text("team_id"), // LiteLLM tim (budžet klijenta + ključevi inženjera)
  ...timestamps,
});

/** Router 2.0 — pravila rutiranja (verzije; predlozi iz statistike čekaju odobrenje). */
export const routerRuleStatusEnum = pgEnum("router_rule_status", ["proposed", "active", "archived", "rejected"]);
export const routerRules = pgTable(
  "router_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }), // null = globalno
    lineage: uuid("lineage").notNull(), // isto za sve verzije jednog pravila
    version: integer("version").default(1).notNull(),
    key: text("key"), // podrazumevano pravilo (DEFAULT_RULES.key)
    name: text("name").notNull(),
    condition: jsonb("condition").$type<RuleCondition>().notNull(),
    target: text("target").notNull(), // fast | smart | local
    priority: integer("priority").default(100).notNull(),
    status: routerRuleStatusEnum("status").default("active").notNull(),
    reason: text("reason"), // obrazloženje predloga (brojke)
    createdBy: text("created_by"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("router_rules_status_idx").on(t.status), index("router_rules_lineage_idx").on(t.lineage, t.version)],
);

/** Svaka odluka rutera (bez sadržaja prompta). callId = LiteLLM_SpendLogs.request_id → tokeni i trošak. */
export const routerDecisions = pgTable(
  "router_decisions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    clientId: uuid("client_id"),
    memberId: uuid("member_id"),
    callId: text("call_id"),
    requested: text("requested"), // traženi model
    chosen: text("chosen"), // šta je ruter izabrao
    applied: text("applied"), // šta je stvarno poslato (u shadow režimu = bez rutiranja)
    ruleId: uuid("rule_id"),
    sticky: boolean("sticky").default(false).notNull(), // zadržano po sesiji agenta
    shadow: boolean("shadow").default(false).notNull(),
    requestClass: text("request_class"),
    sessionId: text("session_id"),
    chars: integer("chars"),
    tools: boolean("tools"),
    stream: boolean("stream"),
    masked: integer("masked").default(0).notNull(),
    status: integer("status"),
    ttfbMs: integer("ttfb_ms"),
    totalMs: integer("total_ms"),
    fallback: boolean("fallback").default(false).notNull(),
    blocked: text("blocked"), // razlog odbijanja (npr. grupa nije dozvoljena)
    promptHash: text("prompt_hash"), // sha256 tela — za ponovljene zahteve, ne sadržaj
  },
  (t) => [index("router_decisions_at_idx").on(t.at), index("router_decisions_client_idx").on(t.clientId, t.at), index("router_decisions_rule_idx").on(t.ruleId, t.at)],
);

/** Ključevi inženjera u okviru klijenta (LiteLLM ključ u timu klijenta, sopstveni budžet). */
export const routerMembers = pgTable(
  "router_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    email: text("email"),
    keyToken: text("key_token").notNull().unique(),
    keyAlias: text("key_alias").notNull(),
    keyPreview: text("key_preview").notNull(),
    monthlyBudgetUsd: doublePrecision("monthly_budget_usd").notNull(),
    status: clientStatusEnum("status").default("active").notNull(),
    ...timestamps,
  },
  (t) => [index("router_members_client_idx").on(t.clientId)],
);

/** Zapis otporan na izmene: svaki red nosi heš prethodnog (lanac). */
export const routerAudit = pgTable("router_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  actor: text("actor"),
  action: text("action").notNull(),
  entity: text("entity"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull().unique(),
});

/** Podešavanja aplikacije (npr. koje leadove šaljemo na Telegram). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Tim: nalozi sa ulogama (Faza 5). */
export const userRoleEnum = pgEnum("user_role", ["owner", "member", "viewer"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").default("member").notNull(),
  access: text("access").default("all").notNull(), // all | sales | delivery — koji deo aplikacije vidi
  tokenVersion: integer("token_version").default(0).notNull(), // povećanje = odjava sa svih uređaja
  integrations: jsonb("integrations"), // lične integracije (šifrovan GitHub token, izabrani agent)
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

/** Pozivnica za kolegu — link važi 7 dana i koristi se jednom. */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email"),
  role: userRoleEnum("role").default("member").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Link samo za pregled leadova (bez beleški i izmena) — može da se opozove. */
export const shareLinks = pgTable("share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  minScore: integer("min_score").default(0).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Delivery (Faza 10): klijenti, projekti, taskovi — kao Linear ─────────────
// (Tabela `clients` iznad je AI Router; firme za koje radimo su `customers`, u UI-ju „Clients“.)
export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUSES);
export const issueStatusEnum = pgEnum("issue_status", ISSUE_STATUSES);

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  website: text("website"),
  country: text("country"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  notes: text("notes"),
  leadId: uuid("lead_id").references(() => leads.id), // iz kog leada je nastao
  ...timestamps,
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(), // ACME → taskovi ACME-1, ACME-2…
    name: text("name").notNull(),
    description: text("description"),
    customerId: uuid("customer_id").references(() => customers.id),
    leadId: uuid("lead_id").references(() => leads.id),
    status: projectStatusEnum("status").default("planned").notNull(),
    budgetEur: integer("budget_eur"),
    startDate: timestamp("start_date", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    ownerId: uuid("owner_id").references(() => users.id),
    repoUrl: text("repo_url"),
    githubImport: boolean("github_import").default(false).notNull(), // novi GitHub issues → Inbox
    githubSync: boolean("github_sync").default(false).notNull(), // Faza 14: dvosmerna sinhronizacija issue-a (GitHub = izvor istine)
    deployHooks: jsonb("deploy_hooks"), // [{ id, name, url: Secret }] — Coolify / Netlify build hook
    billing: text("billing").default("fixed").notNull(), // fixed = budžet je cena · hourly = sati × satnica
    hourlyRateEur: integer("hourly_rate_eur"), // satnica za klijenta (hourly)
    siteUrl: text("site_url"), // sajt klijenta koji pratimo (zdravlje sajta)
    githubSyncedAt: timestamp("github_synced_at", { withTimezone: true }),
    issueSeq: integer("issue_seq").default(0).notNull(), // poslednji broj taska
    ...timestamps,
  },
  (t) => [uniqueIndex("projects_key_idx").on(t.key)],
);

/** Sprint (cycle) za ceo tim: 2 nedelje, nedovršeno prelazi u sledeći. */
export const cycles = pgTable(
  "cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull(),
    name: text("name"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("cycles_number_idx").on(t.number)],
);

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: issueStatusEnum("status").default("todo").notNull(),
    priority: integer("priority").default(0).notNull(), // 0 bez, 1 hitno … 4 nizak
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    estimate: integer("estimate"), // poeni (1, 2, 3, 5, 8)
    labels: text("labels").array().default([]).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    sortOrder: doublePrecision("sort_order").default(0).notNull(), // redosled u koloni
    cycleId: uuid("cycle_id").references(() => cycles.id, { onDelete: "set null" }),
    agent: text("agent"), // claude | codex — predat AI agentu
    createdBy: text("created_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("issues_project_number_idx").on(t.projectId, t.number), index("issues_status_idx").on(t.status)],
);

/** Istorija taska: komentari i promene (status, prioritet, dodela…). */
export const issueEvents = pgTable(
  "issue_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "cascade" }).notNull(),
    type: text("type").notNull(), // created | comment | status | priority | assignee | title | estimate
    data: jsonb("data"),
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("issue_events_issue_idx").on(t.issueId)],
);

/** Veze taska sa GitHub-om: issue koji je napravljen za agenta i pull request-ovi. */
export const issueLinks = pgTable(
  "issue_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "cascade" }).notNull(),
    kind: text("kind").notNull(), // gh_issue | pr
    repo: text("repo").notNull(), // owner/repo
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    state: text("state"), // open | closed | merged | draft
    remoteUpdatedAt: timestamp("remote_updated_at", { withTimezone: true }), // poslednja izmena na GitHub-u koju smo videli (sprečava petlju)
    ...timestamps,
  },
  (t) => [uniqueIndex("issue_links_unique_idx").on(t.issueId, t.kind, t.repo, t.number), index("issue_links_repo_idx").on(t.repo, t.number)],
);

/** Portal za klijenta: link samo za pregled napretka projekta (+ slanje zahteva u Inbox). */
export const projectPortals = pgTable("project_portals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  allowRequests: boolean("allow_requests").default(true).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Evidencija vremena (Faza 12): koliko je ko radio na tasku/projektu. */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name").notNull(),
    minutes: integer("minutes").notNull(),
    spentOn: timestamp("spent_on", { withTimezone: true }).notNull(),
    note: text("note"),
    billable: boolean("billable").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("time_entries_project_idx").on(t.projectId), index("time_entries_issue_idx").on(t.issueId), index("time_entries_spent_idx").on(t.spentOn)],
);

/** AI asistent (Faza 13): pitanja/odgovori i status izveštaji — istorija i potrošnja tokena. */
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // ask | status
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(), // free | anthropic
    tokensIn: integer("tokens_in").default(0).notNull(),
    tokensOut: integer("tokens_out").default(0).notNull(),
    sources: jsonb("sources"), // fajlovi iz repoa korišćeni za odgovor
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ai_messages_user_idx").on(t.userId), index("ai_messages_project_idx").on(t.projectId)],
);

/** Dodatni repoi projekta (Faza 14): npr. frontend, backend, mobile. Glavni je projects.repoUrl. */
export const projectRepos = pgTable(
  "project_repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    repoUrl: text("repo_url").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("project_repos_unique_idx").on(t.projectId, t.repoUrl)],
);

/** Istorija deploy-a pokrenutih iz aplikacije. */
export const deploys = pgTable(
  "deploys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
    hookName: text("hook_name").notNull(),
    actor: text("actor").notNull(),
    ok: boolean("ok").notNull(),
    status: integer("status"),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("deploys_project_idx").on(t.projectId)],
);

/** Skills / pravila za AI agente (Faza 15): biblioteka tima; „Add to project“ otvara PR u repou projekta. */
export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  path: text("path").notNull(), // npr. .claude/skills/code-review/SKILL.md ili AGENTS.md
  content: text("content").notNull(),
  createdBy: text("created_by"),
  ...timestamps,
});

/** Binarni podaci (slike u chatu sa Claude-om). */
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Slike koje korisnik ubaci u razgovor sa Claude-om (Build with Claude) — služe se preko potpisanog linka. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    name: text("name"),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("attachments_project_idx").on(t.projectId)],
);

/**
 * Rad AI agenta u repou (Build with Claude). Razgovor se čuva ovde — na GitHub-u nema issue-a ni bot komentara.
 * Jedan red = jedan razgovor; svaka poruka korisnika pokreće workflow „Scoutline agent“ (dispatchId u run-name).
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    repo: text("repo").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("queued"), // queued | working | done | failed
    model: text("model"),
    branch: text("branch").notNull(),
    base: text("base"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    dispatchId: text("dispatch_id"), // trenutno pokretanje (run-name „agent <id>“)
    ghRunId: text("gh_run_id"),
    ghRunUrl: text("gh_run_url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agent_runs_project_idx").on(t.projectId, t.createdAt), index("agent_runs_status_idx").on(t.status)],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .references(() => agentRuns.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull(), // user | assistant
    body: text("body").notNull(),
    // user: { dispatchId, model, effort, images } · assistant: { ok, cost, tokensIn, tokensOut, turns, ms, steps, commits }
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agent_messages_run_idx").on(t.runId, t.createdAt)],
);

/** Greške iz aplikacije (web) i servera (api) — ista greška se broji (fingerprint), nova stiže na Telegram. */
export const appErrors = pgTable(
  "app_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull(),
    source: text("source").notNull(), // web | api | worker
    message: text("message").notNull(),
    stack: text("stack"),
    url: text("url"),
    userAgent: text("user_agent"),
    userName: text("user_name"),
    count: integer("count").notNull().default(1),
    resolved: boolean("resolved").notNull().default(false),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow().notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("app_errors_fingerprint_idx").on(t.fingerprint), index("app_errors_last_idx").on(t.lastSeen)],
);


/** Dokumentacija projekta (markdown): kako se pokreće, odluke, kontakti. shareWithAi → ide Claude-u kao kontekst. */
export const projectDocs = pgTable(
  "project_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    shareWithAi: boolean("share_with_ai").notNull().default(true),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("project_docs_project_idx").on(t.projectId)],
);

/** Faktura: stavke (opis × količina × cena), broj po godini (2026-001), status draft → sent → paid. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    periodFrom: timestamp("period_from", { withTimezone: true }),
    periodTo: timestamp("period_to", { withTimezone: true }),
    items: jsonb("items").$type<Array<{ description: string; qty: number; unit: string; unitPrice: number }>>().notNull(),
    totalEur: doublePrecision("total_eur").notNull(),
    status: text("status").notNull().default("draft"), // draft | sent | paid
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("invoices_number_idx").on(t.number), index("invoices_project_idx").on(t.projectId)],
);

/** Provere sajta klijenta (na 5 minuta, čuva se 14 dana). */
export const siteChecks = pgTable(
  "site_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    ok: boolean("ok").notNull(),
    status: integer("status"),
    ms: integer("ms"),
    error: text("error"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("site_checks_project_idx").on(t.projectId, t.at)],
);

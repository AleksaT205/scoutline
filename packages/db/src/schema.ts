import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { INDUSTRIES, LEAD_STATUSES, SERVICE_CATEGORIES } from "@radar/shared";

export const tierEnum = pgEnum("tier", ["T1", "T2", "T3", "DOMESTIC"]);
export const categoryEnum = pgEnum("service_category", SERVICE_CATEGORIES);
export const industryEnum = pgEnum("industry", INDUSTRIES);
export const statusEnum = pgEnum("lead_status", LEAD_STATUSES);
export const sourceKindEnum = pgEnum("source_kind", ["api", "rss", "scrape", "manual"]);

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
    payload: jsonb("payload"),
    ...timestamps,
  },
  (t) => [uniqueIndex("raw_items_url_hash_idx").on(t.urlHash)],
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
    ...timestamps,
  },
  (t) => [index("leads_score_idx").on(t.score), index("leads_status_idx").on(t.status)],
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

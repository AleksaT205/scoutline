import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { leads, rawItems, sources, type Db } from "@radar/db";
import { detectCountry, finalScore, remoteFriendly, tierOf } from "@radar/shared";
import type { Connector } from "../connectors/types.js";
import { aiActive, scoreWithAi } from "./ai.js";
import { sendLeadToTelegram, telegramConfigured } from "./notify.js";
import { budgetFromSalary, passesPrefilter, scoreByRules } from "./rules.js";

const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS ?? 14);
const NOTIFY_MIN_SCORE = Number(process.env.NOTIFY_MIN_SCORE ?? 75);

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

export async function registerSources(db: Db, connectors: Connector[]) {
  for (const c of connectors) {
    await db
      .insert(sources)
      .values({ id: c.id, name: c.name, kind: c.kind, intervalMinutes: c.intervalMinutes })
      .onConflictDoUpdate({ target: sources.id, set: { name: c.name, kind: c.kind, intervalMinutes: c.intervalMinutes } });
  }
}

/** Preuzme oglase sa jednog izvora, sačuva nove i napravi leadove za one koji prođu filter. */
export async function ingest(db: Db, c: Connector) {
  const started = Date.now();
  let fetched = 0, fresh = 0, created = 0;
  try {
    const items = await c.fetch();
    fetched = items.length;
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    for (const it of items) {
      if (it.postedAt && it.postedAt.getTime() < cutoff) continue;
      const [row] = await db
        .insert(rawItems)
        .values({
          sourceId: c.id,
          externalId: it.externalId,
          url: it.url,
          urlHash: sha1(it.url),
          title: it.title.slice(0, 300),
          body: it.body.slice(0, 20_000),
          companyName: it.companyName,
          location: it.location,
          salaryText: it.salaryText,
          postedAt: it.postedAt && !Number.isNaN(it.postedAt.getTime()) ? it.postedAt : null,
        })
        .onConflictDoNothing({ target: rawItems.urlHash })
        .returning({ id: rawItems.id });
      if (!row) continue; // već viđen
      fresh++;
      if (!passesPrefilter(it.title, it.body, { allowBody: c.id === "hn" })) continue;
      const country = detectCountry({ location: it.location, salaryText: it.salaryText });
      await db.insert(leads).values({
        rawItemId: row.id,
        country,
        tier: country ? tierOf(country) : null,
        remoteOk: remoteFriendly(`${it.location ?? ""}\n${it.body.slice(0, 3000)}`),
      });
      created++;
    }
    await db.update(sources).set({ lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(sources.id, c.id));
    console.log(`[${c.id}] ${fetched} preuzeto, ${fresh} novih, ${created} leadova (${Date.now() - started} ms)`);
  } catch (e) {
    const msg = (e as Error).message;
    await db.update(sources).set({ lastError: msg.slice(0, 500), updatedAt: new Date() }).where(eq(sources.id, c.id));
    console.error(`[${c.id}] greška: ${msg}`);
  }
}

const CATEGORY_TEXT: Record<string, string> = {
  fullstack_app: "full-stack web apps",
  web_frontend: "modern web frontends",
  backend_api: "backends and APIs",
  mobile: "mobile apps",
  ai_integration: "AI features and integrations",
  automation: "workflow automation",
  devops_deploy: "deployment and DevOps",
  bugfix_maintenance: "bug fixing and maintenance",
  other_dev: "software projects",
};

/** Oceni leadove koji još nisu ocenjeni: AI ako je dostupan, inače pravila. */
export async function scorePending(db: Db, aiBatch: number) {
  // Pravila su trenutna — bez AI-a ocenjujemo i veći broj odjednom.
  const limit = aiActive() ? aiBatch : 300;
  const rows = await db
    .select({ lead: leads, raw: rawItems, source: sources.name })
    .from(leads)
    .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(isNull(leads.scoredAt))
    .orderBy(desc(rawItems.postedAt))
    .limit(limit);

  let byAi = 0;
  for (const { lead, raw } of rows) {
    const body = raw.body ?? "";
    const ai = await scoreWithAi({ title: raw.title, company: raw.companyName, location: raw.location, salary: raw.salaryText, body });
    const rules = ai ? null : scoreByRules(raw.title, body);
    if (ai) byAi++;

    const country = ai?.country ?? lead.country;
    const tier = country ? tierOf(country) : null;
    const remoteOk = ai?.remoteOk ?? lead.remoteOk;
    const budgetEur = ai?.budgetEur ?? budgetFromSalary(raw.salaryText);
    const category = ai?.category ?? rules!.category;
    const aiScore = ai?.aiScore ?? rules!.aiScore;
    const score = category === "not_relevant" ? 0 : finalScore({ aiScore, tier: tier ?? "T2", remoteOk, budgetEur });
    const offer = CATEGORY_TEXT[category] ?? "software projects";

    await db
      .update(leads)
      .set({
        aiScore,
        score,
        category,
        industry: ai?.industry ?? rules!.industry,
        country,
        tier,
        remoteOk,
        budgetEur,
        urgency: ai?.urgency ?? null,
        why: ai?.why.length ? ai.why : [`Matches our ${offer} offer.`, remoteOk ? "Open to remote work." : "Remote setup not confirmed."],
        redFlags: ai?.redFlags ?? [],
        emailSubject: ai?.emailSubject ?? `${raw.title.slice(0, 60)} — quick idea`,
        emailBody:
          ai?.emailBody ??
          `Hi, saw you're looking for help with "${raw.title.slice(0, 80)}". We're a small remote team focused on ${offer} and could share a short plan with timeline and cost. Would a 15-minute call next week be useful?`,
        scoredBy: ai ? `ai:${ai.model}` : "rules",
        scoredAt: new Date(),
        status: category === "not_relevant" || score < 20 ? "hidden" : "new",
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));
  }
  if (rows.length) console.log(`[score] ocenjeno ${rows.length} (AI: ${byAi}, pravila: ${rows.length - byAi})`);
}

/** Pošalje na Telegram dobre, sveže leadove koji još nisu poslati. */
export async function notifyNew(db: Db) {
  if (!telegramConfigured()) return;
  const since = new Date(Date.now() - 48 * 3_600_000);
  const rows = await db
    .select({ lead: leads, raw: rawItems, source: sources.name })
    .from(leads)
    .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(and(isNull(leads.notifiedAt), eq(leads.status, "new"), gte(leads.score, NOTIFY_MIN_SCORE), gte(rawItems.postedAt, since)))
    .orderBy(desc(leads.score))
    .limit(10);
  for (const { lead, raw, source } of rows) {
    const ok = await sendLeadToTelegram({
      score: lead.score ?? 0,
      title: raw.title,
      company: raw.companyName,
      country: lead.country,
      tier: lead.tier,
      budgetEur: lead.budgetEur,
      source,
      url: raw.url,
      why: lead.why,
    });
    if (ok) await db.update(leads).set({ notifiedAt: new Date() }).where(eq(leads.id, lead.id));
  }
  if (rows.length) console.log(`[telegram] poslato ${rows.length}`);
}

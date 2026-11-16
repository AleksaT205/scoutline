import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { leads, rawItems, settings, sources, type Db } from "@radar/db";
import { detectCountry, normalizeAlerts, remoteFriendly, tierOf, type AlertSettings } from "@radar/shared";
import { CONTRACT, aiActive, passesPrefilter, scoreItem } from "@radar/scoring";
import type { Connector } from "../connectors/types.js";
import { sendLeadToTelegram, telegramConfigured } from "@radar/scoring";

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
    // Jedan konektor može da puni više izvora (Email-in → Upwork, PeoplePerHour…) — registruj ih pri prvom oglasu
    const subSources = new Set<string>();
    for (const it of items) {
      if (!it.sourceId || subSources.has(it.sourceId)) continue;
      subSources.add(it.sourceId);
      const name = it.sourceName ?? it.sourceId;
      await db
        .insert(sources)
        .values({ id: it.sourceId, name, kind: c.kind, intervalMinutes: c.intervalMinutes })
        .onConflictDoUpdate({ target: sources.id, set: { name, lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() } });
    }
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    for (const it of items) {
      if (it.postedAt && it.postedAt.getTime() < cutoff) continue;
      const [row] = await db
        .insert(rawItems)
        .values({
          sourceId: it.sourceId ?? c.id,
          externalId: it.externalId,
          url: it.url,
          urlHash: sha1(it.dedupeKey ?? it.url),
          title: it.title.slice(0, 300),
          body: it.body.slice(0, 20_000),
          companyName: it.companyName,
          location: it.location,
          salaryText: it.salaryText,
          postedAt: it.postedAt && !Number.isNaN(it.postedAt.getTime()) ? it.postedAt : null,
          kindHint: it.leadType ?? c.defaultType,
          deadline: it.deadline && !Number.isNaN(it.deadline.getTime()) ? it.deadline : null,
          budgetHintEur: it.budgetEur ?? null,
          countryHint: it.country ?? null,
        })
        .onConflictDoNothing({ target: rawItems.urlHash })
        .returning({ id: rawItems.id });
      if (!row) continue; // već viđen
      fresh++;
      const type = it.leadType ?? c.defaultType;
      // Tenderi i signali su već filtrirani u konektoru (CPV / ključne reči); oglasi prolaze prefilter za developere.
      if (!c.curated && (type === "hiring_signal" || type === "project") && !passesPrefilter(it.title, it.body, { allowBody: c.id === "hn" })) continue;
      if (it.deadline && it.deadline.getTime() < Date.now()) continue; // rok prošao
      const country = it.country ?? detectCountry({ location: it.location, salaryText: it.salaryText });
      const leadType = type === "hiring_signal" && CONTRACT.test(`${it.title}\n${it.body.slice(0, 2000)}`) ? "project" : type;
      await db.insert(leads).values({
        rawItemId: row.id,
        leadType,
        budgetEur: it.budgetEur ?? null,
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

/** Oceni leadove koji još nisu ocenjeni: AI ako je dostupan, inače pravila. */
export async function scorePending(db: Db, aiBatch: number) {
  // Pravila su trenutna — bez AI-a ocenjujemo i veći broj odjednom.
  const limit = aiActive() ? aiBatch : 300;
  const select = () =>
    db
      .select({ lead: leads, raw: rawItems, source: sources.name })
      .from(leads)
      .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
      .innerJoin(sources, eq(rawItems.sourceId, sources.id));
  const rows = await select().where(isNull(leads.scoredAt)).orderBy(desc(rawItems.postedAt)).limit(limit);
  // Kad je AI dostupan, postepeno preocenjujemo i one koje su ranije ocenila pravila (najsvežije prvo).
  if (aiActive() && rows.length < limit) {
    rows.push(
      ...(await select()
        .where(and(eq(leads.scoredBy, "rules"), ne(leads.status, "hidden")))
        .orderBy(desc(rawItems.postedAt))
        .limit(limit - rows.length)),
    );
  }

  let byAi = 0;
  const useAi = aiActive();
  for (const { lead, raw } of rows) {
    const r = await scoreItem({
      title: raw.title,
      company: raw.companyName,
      location: raw.location,
      salaryText: raw.salaryText,
      body: raw.body ?? "",
      prior: { country: raw.countryHint ?? lead.country, remoteOk: lead.remoteOk },
      useAi,
      leadType: (raw.kindHint === "hiring_signal" ? lead.leadType : raw.kindHint) ?? lead.leadType,
      budgetHintEur: raw.budgetHintEur,
      deadline: raw.deadline,
    });
    if (r.scoredBy === "rules" && lead.scoredBy === "rules") continue; // preocenjivanje AI-jem nije uspelo — zadrži postojeću ocenu
    if (r.scoredBy !== "rules") byAi++;
    const { aiTitle: _t, aiCompany: _c, ...fields } = r;
    await db.update(leads).set({ ...fields, scoredAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, lead.id));
  }
  if (rows.length) console.log(`[score] ocenjeno ${rows.length} (AI: ${byAi}, pravila: ${rows.length - byAi})`);
}

/** Freelancer.com uslovi: podaci iz API-ja ne smeju da stoje duže od 24 h — brišemo opis, ostaju naslov, link i ocena. */
export async function purgeExpired(db: Db) {
  await db
    .update(rawItems)
    .set({ body: "[Description removed after 24 h — Freelancer.com API terms. Open the project link for details.]", updatedAt: new Date() })
    .where(and(eq(rawItems.sourceId, "freelancer"), lt(rawItems.createdAt, new Date(Date.now() - 86_400_000)), ne(rawItems.body, "")));
}

/** Kad je izvor poslednji put uspeo (posle restarta worker ne zove ponovo izvore koji nisu na redu — npr. SAM.gov ima 10 poziva dnevno). */
export async function lastSuccess(db: Db): Promise<Map<string, number>> {
  const rows = await db.select({ id: sources.id, at: sources.lastSuccessAt }).from(sources);
  return new Map(rows.filter((r) => r.at).map((r) => [r.id, r.at!.getTime()]));
}

/** Učita podešavanja obaveštenja (menjaju se iz dashboard-a). */
export async function loadAlerts(db: Db): Promise<AlertSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "alerts")).limit(1);
  const alerts = normalizeAlerts(row?.value);
  // Ako je NOTIFY_MIN_SCORE postavljen na serveru, a u dashboard-u još ništa nije sačuvano — koristi njega
  if (!row && process.env.NOTIFY_MIN_SCORE) alerts.minScore = NOTIFY_MIN_SCORE;
  return alerts;
}

/** Pošalje na Telegram dobre, sveže leadove koji još nisu poslati — po podešavanjima iz dashboard-a. */
export async function notifyNew(db: Db) {
  if (!telegramConfigured()) return;
  const alerts = await loadAlerts(db);
  if (!alerts.enabled) return;
  const since = new Date(Date.now() - alerts.maxAgeHours * 3_600_000);
  const candidates = await db
    .select({ lead: leads, raw: rawItems, source: sources.name })
    .from(leads)
    .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(and(isNull(leads.notifiedAt), eq(leads.status, "new"), gte(leads.score, alerts.minScore), gte(rawItems.postedAt, since)))
    .orderBy(desc(leads.score))
    .limit(100);
  const rows = candidates
    .filter(({ lead }) => alerts.markets.includes(lead.tier ?? "UNKNOWN"))
    .filter(({ lead }) => !alerts.categories.length || (lead.category && alerts.categories.includes(lead.category)))
    .filter(({ lead }) => alerts.types.includes(lead.leadType ?? "hiring_signal"))
    .filter(({ lead }) => !alerts.remoteOnly || lead.remoteOk === true || lead.leadType === "tender")
    .slice(0, 10);
  for (const { lead, raw, source } of rows) {
    const ok = await sendLeadToTelegram({
      score: lead.score ?? 0,
      title: raw.title,
      company: raw.companyName,
      country: lead.country,
      tier: lead.tier,
      budgetEur: lead.budgetEur,
      leadType: lead.leadType,
      deadline: raw.deadline,
      source,
      url: raw.url,
      why: lead.why,
    });
    if (ok) await db.update(leads).set({ notifiedAt: new Date() }).where(eq(leads.id, lead.id));
  }
  if (rows.length) console.log(`[telegram] poslato ${rows.length}`);
}

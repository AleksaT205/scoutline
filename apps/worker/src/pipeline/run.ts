import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { leads, rawItems, sources, type Db } from "@radar/db";
import { detectCountry, remoteFriendly, tierOf } from "@radar/shared";
import { aiActive, passesPrefilter, scoreItem } from "@radar/scoring";
import type { Connector } from "../connectors/types.js";
import { sendLeadToTelegram, telegramConfigured } from "./notify.js";

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
      prior: { country: lead.country, remoteOk: lead.remoteOk },
      useAi,
    });
    if (r.scoredBy === "rules" && lead.scoredBy === "rules") continue; // preocenjivanje AI-jem nije uspelo — zadrži postojeću ocenu
    if (r.scoredBy !== "rules") byAi++;
    const { aiTitle: _t, aiCompany: _c, ...fields } = r;
    await db.update(leads).set({ ...fields, scoredAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, lead.id));
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

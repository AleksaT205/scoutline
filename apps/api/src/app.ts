import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { and, count, desc, eq, gte, inArray, ne, type SQL } from "drizzle-orm";
import { leads, rawItems, sources, type Db } from "@radar/db";
import { detectCountry, remoteFriendly } from "@radar/shared";
import { htmlTitle, mainText, scoreItem } from "@radar/scoring";
import { safeFetchHtml } from "./safe-fetch.js";

type Tier = "T1" | "T2" | "T3" | "DOMESTIC";
type LeadRow = { lead: typeof leads.$inferSelect; raw: typeof rawItems.$inferSelect; source: string };

const fmtBudget = (eur: number | null) =>
  eur == null ? "—" : eur >= 1000 ? `€${(eur / 1000).toFixed(eur >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : `€${eur}`;

/** Oblik koji dashboard očekuje. */
function toUiLead({ lead, raw, source }: LeadRow) {
  return {
    id: lead.id,
    title: raw.title,
    company: raw.companyName ?? "Unknown company",
    industry: lead.industry ?? "other",
    country: lead.country,
    city: raw.location ?? "",
    tier: lead.tier,
    category: lead.category ?? "other_dev",
    budgetLabel: fmtBudget(lead.budgetEur),
    budgetEur: lead.budgetEur ?? 0,
    source,
    url: raw.url.startsWith("http") ? raw.url : undefined,
    postedMinutesAgo: raw.postedAt ? Math.max(1, Math.round((Date.now() - raw.postedAt.getTime()) / 60_000)) : null,
    score: lead.score ?? 0,
    remote: lead.remoteOk === true ? "Remote-friendly" : lead.remoteOk === false ? "Not remote" : "Unknown",
    remoteOk: lead.remoteOk,
    urgency: lead.urgency ?? "—",
    why: lead.why ?? [],
    email: { subject: lead.emailSubject ?? "", body: lead.emailBody ?? "" },
    scoredBy: lead.scoredBy,
    status: lead.status,
  };
}

/** Timska lozinka za akcije koje menjaju podatke. Bez API_TOKEN-a te akcije su isključene. */
function authorized(c: Context): boolean | "disabled" {
  const expected = process.env.API_TOKEN;
  if (!expected) return "disabled";
  const got = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function createApp(getDb: () => Db) {
  const app = new Hono();
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",");
  const isDev = process.env.NODE_ENV !== "production";
  app.use(
    "*",
    cors({
      // U razvoju dozvoli bilo koji localhost port; u produkciji samo CORS_ORIGINS.
      origin: (origin) => (origins.includes(origin) || (isDev && /^http:\/\/localhost:\d+$/.test(origin)) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  const selectLeads = () =>
    getDb()
      .select({ lead: leads, raw: rawItems, source: sources.name })
      .from(leads)
      .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
      .innerJoin(sources, eq(rawItems.sourceId, sources.id));

  app.get("/health", (c) => c.json({ ok: true, service: "radar-api", time: new Date().toISOString() }));

  // GET /leads?minScore=0&tiers=T1,T2&limit=100 — ocenjeni leadovi, spremni za dashboard
  app.get("/leads", async (c) => {
    const minScore = Number(c.req.query("minScore") ?? 0);
    const tiers = c.req.query("tiers")?.split(",").filter(Boolean) as Tier[] | undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 300);
    const where: SQL[] = [gte(leads.score, minScore), ne(leads.status, "hidden")];
    if (tiers?.length) where.push(inArray(leads.tier, tiers));
    const rows = await selectLeads()
      .where(and(...where))
      .orderBy(desc(leads.score), desc(rawItems.postedAt))
      .limit(limit);
    return c.json({ items: rows.map(toUiLead) });
  });

  // POST /auth/check — proverava timsku lozinku (za prozor "Add lead")
  app.post("/auth/check", (c) => {
    const ok = authorized(c);
    if (ok === "disabled") return c.json({ ok: false, error: "Adding leads is disabled: set API_TOKEN on the server." }, 503);
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "Wrong team password." }, 401);
  });

  // POST /leads/manual { url?, text?, company?, location? } — ručno dodat lead, odmah ocenjen
  app.post("/leads/manual", async (c) => {
    const ok = authorized(c);
    if (ok === "disabled") return c.json({ error: "Adding leads is disabled: set API_TOKEN on the server." }, 503);
    if (!ok) return c.json({ error: "Wrong team password." }, 401);

    const input = await c.req.json<{ url?: string; text?: string; company?: string; location?: string }>().catch(() => null);
    const url = input?.url?.trim() || null;
    const pasted = input?.text?.trim() || "";
    if (!url && pasted.length < 40) return c.json({ error: "Paste a link or at least a few sentences of the job post." }, 400);

    let title: string | null = null;
    let body = pasted;
    let finalUrl = url;
    if (url && !pasted) {
      try {
        const page = await safeFetchHtml(url);
        title = htmlTitle(page.html);
        body = mainText(page.html);
        finalUrl = page.finalUrl;
      } catch (e) {
        return c.json({ error: `Couldn't read that page (${(e as Error).message}). Paste the job text instead.` }, 422);
      }
      if (body.length < 80) return c.json({ error: "The page has almost no readable text (it may need a login or JavaScript). Paste the job text instead." }, 422);
    }
    // Bez naslova stranice: prva rečenica teksta (AI kasnije predloži bolji naziv pozicije)
    title ??= (body.split("\n").find((l) => l.trim().length > 3)?.trim().split(/(?<=[.!?])\s/)[0] ?? "Manual lead").slice(0, 110);
    const company = input?.company?.trim() || null;
    const location = input?.location?.trim() || null;

    const db = getDb();
    await db
      .insert(sources)
      .values({ id: "manual", name: "Added manually", kind: "manual", intervalMinutes: 0 })
      .onConflictDoNothing();

    const key = finalUrl ?? `manual:${randomUUID()}`;
    const [raw] = await db
      .insert(rawItems)
      .values({
        sourceId: "manual",
        url: key,
        urlHash: createHash("sha1").update(key).digest("hex"),
        title: title.slice(0, 300),
        body: body.slice(0, 20_000),
        companyName: company,
        location,
        postedAt: new Date(),
      })
      .onConflictDoNothing({ target: rawItems.urlHash })
      .returning();
    if (!raw) {
      const [existing] = await selectLeads().where(eq(rawItems.url, key)).limit(1);
      return existing ? c.json({ lead: toUiLead(existing), duplicate: true }) : c.json({ error: "This link was already added." }, 409);
    }

    const country = detectCountry({ location: location ?? body.slice(0, 600), salaryText: null });
    const r = await scoreItem({
      title,
      company,
      location,
      salaryText: null,
      body,
      prior: { country, remoteOk: remoteFriendly(`${location ?? ""}\n${body.slice(0, 3000)}`) },
    });
    const { aiTitle, aiCompany, ...fields } = r;
    // AI često bolje prepozna naziv pozicije i firmu nego naslov stranice
    if (aiTitle || (aiCompany && !company)) {
      await db
        .update(rawItems)
        .set({ title: (aiTitle ?? title).slice(0, 300), companyName: company ?? aiCompany })
        .where(eq(rawItems.id, raw.id));
    }
    // Ručno dodat lead se uvek prikazuje (i kad je ocena niska) — korisnik ga je namerno dodao.
    const [lead] = await db
      .insert(leads)
      .values({ rawItemId: raw.id, ...fields, status: "new", scoredAt: new Date() })
      .returning();
    const [row] = await selectLeads().where(eq(leads.id, lead!.id)).limit(1);
    return c.json({ lead: toUiLead(row!) }, 201);
  });

  // GET /stats — brojevi za KPI kartice i stanje izvora
  app.get("/stats", async (c) => {
    const db = getDb();
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [today] = await db.select({ n: count() }).from(leads).where(and(gte(leads.createdAt, dayAgo), ne(leads.status, "hidden")));
    const [total] = await db.select({ n: count() }).from(leads).where(ne(leads.status, "hidden"));
    const srcs = await db.select().from(sources);
    const scoring = await db.select({ by: leads.scoredBy, n: count() }).from(leads).groupBy(leads.scoredBy);
    const sum = (pred: (by: string | null) => boolean) => scoring.filter((r) => pred(r.by)).reduce((a, r) => a + r.n, 0);
    return c.json({
      newToday: today?.n ?? 0,
      total: total?.n ?? 0,
      scoring: { ai: sum((b) => !!b?.startsWith("ai")), rules: sum((b) => b === "rules"), pending: sum((b) => b === null) },
      sources: srcs.map((s) => ({ id: s.id, name: s.name, lastSuccessAt: s.lastSuccessAt, lastError: s.lastError })),
    });
  });

  return app;
}

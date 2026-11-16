import { Hono } from "hono";
import { cors } from "hono/cors";
import { and, count, desc, eq, gte, inArray, ne, type SQL } from "drizzle-orm";
import { leads, rawItems, sources, type Db } from "@radar/db";

type Tier = "T1" | "T2" | "T3" | "DOMESTIC";

const fmtBudget = (eur: number | null) =>
  eur == null ? "—" : eur >= 1000 ? `€${(eur / 1000).toFixed(eur >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : `€${eur}`;

export function createApp(getDb: () => Db) {
  const app = new Hono();
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",");
  const isDev = process.env.NODE_ENV !== "production";
  app.use(
    "*",
    cors({
      // U razvoju dozvoli bilo koji localhost port; u produkciji samo CORS_ORIGINS.
      origin: (origin) => (origins.includes(origin) || (isDev && /^http:\/\/localhost:\d+$/.test(origin)) ? origin : null),
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, service: "radar-api", time: new Date().toISOString() }));

  // GET /leads?minScore=0&tiers=T1,T2&limit=100 — ocenjeni leadovi, spremni za dashboard
  app.get("/leads", async (c) => {
    const minScore = Number(c.req.query("minScore") ?? 0);
    const tiers = c.req.query("tiers")?.split(",").filter(Boolean) as Tier[] | undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 300);
    const where: SQL[] = [gte(leads.score, minScore), ne(leads.status, "hidden")];
    if (tiers?.length) where.push(inArray(leads.tier, tiers));

    const rows = await getDb()
      .select({ lead: leads, raw: rawItems, source: sources.name })
      .from(leads)
      .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
      .innerJoin(sources, eq(rawItems.sourceId, sources.id))
      .where(and(...where))
      .orderBy(desc(leads.score), desc(rawItems.postedAt))
      .limit(limit);

    const now = Date.now();
    const items = rows.map(({ lead, raw, source }) => ({
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
      url: raw.url,
      postedMinutesAgo: raw.postedAt ? Math.max(1, Math.round((now - raw.postedAt.getTime()) / 60_000)) : null,
      score: lead.score ?? 0,
      remote: lead.remoteOk === true ? "Remote-friendly" : lead.remoteOk === false ? "Not remote" : "Unknown",
      remoteOk: lead.remoteOk,
      urgency: lead.urgency ?? "—",
      why: lead.why ?? [],
      email: { subject: lead.emailSubject ?? "", body: lead.emailBody ?? "" },
      scoredBy: lead.scoredBy,
      status: lead.status,
    }));
    return c.json({ items });
  });

  // GET /stats — brojevi za KPI kartice i stanje izvora
  app.get("/stats", async (c) => {
    const db = getDb();
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [today] = await db.select({ n: count() }).from(leads).where(and(gte(leads.createdAt, dayAgo), ne(leads.status, "hidden")));
    const [total] = await db.select({ n: count() }).from(leads).where(ne(leads.status, "hidden"));
    const srcs = await db.select().from(sources);
    return c.json({
      newToday: today?.n ?? 0,
      total: total?.n ?? 0,
      sources: srcs.map((s) => ({ id: s.id, name: s.name, lastSuccessAt: s.lastSuccessAt, lastError: s.lastError })),
    });
  });

  return app;
}

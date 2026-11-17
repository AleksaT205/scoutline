import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { and, count, desc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { leadEvents, leads, rawItems, settings, sources, type Db } from "@radar/db";
import { LEAD_STATUSES, detectCountry, normalizeAlerts, remoteFriendly, type LeadStatus } from "@radar/shared";
import { htmlTitle, mainText, scoreItem, sendLeadToTelegram, telegramConfigured } from "@radar/scoring";
import { safeFetchHtml } from "./safe-fetch.js";
import { auth, type Actor } from "./auth.js";
import { checkHealth } from "./monitor.js";
import { llmProxy, routerAdmin } from "./router.js";
import { deliveryRoutes } from "./delivery.js";
import { deliveryPlusRoutes, portalRoutes } from "./delivery-plus.js";
import { reportRoutes } from "./reports.js";
import { integrationRoutes } from "./integrations.js";
import { notificationRoutes } from "./notifications.js";
import { assistantRoutes } from "./assistant.js";
import { errorRoutes, recordError } from "./errors.js";
import { githubFlowRoutes } from "./github-flow.js";
import { agentRoutes } from "./agents.js";
import { previewRoutes } from "./preview.js";
import { workspaceRoutes } from "./workspace.js";

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
    leadType: lead.leadType ?? "hiring_signal",
    deadline: raw.deadline ? raw.deadline.toISOString() : null,
    budgetLabel: fmtBudget(lead.budgetEur),
    budgetEur: lead.budgetEur ?? 0,
    source,
    url: raw.url.startsWith("http") ? raw.url : undefined,
    createdAt: lead.createdAt.toISOString(),
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

export function createApp(getDb: () => Db) {
  const app = new Hono();
  const a = auth(getDb);
  const actorName = (c: Context) => ((c.get("actor" as never) as Actor | undefined)?.name ?? "team");
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",");
  const isDev = process.env.NODE_ENV !== "production";
  const secure = secureHeaders({ crossOriginResourcePolicy: false, crossOriginOpenerPolicy: false });
  // /preview/* = sajt iz repoa (ima svoja zaglavlja: sandbox CSP, sme u iframe u Scoutline-u)
  app.use("*", (c, next) => (c.req.path.startsWith("/preview/") || c.req.path.startsWith("/files/") ? next() : secure(c, next)));
  app.use(
    "*",
    cors({
      // U razvoju dozvoli bilo koji localhost port; u produkciji samo CORS_ORIGINS.
      origin: (origin) => (origins.includes(origin) || (isDev && /^http:\/\/localhost:\d+$/.test(origin)) ? origin : null),
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      // Pregledač pamti CORS proveru (OPTIONS) — bez ovoga svaki zahtev ide dvaput preko tunela
      maxAge: 86_400,
    }),
  );
  // Brzina: gzip za JSON (lista leadova ~750 KB → ~100 KB); /llm proxy se ne dira
  const gzip = compress();
  app.use("*", (c, next) => (c.req.path.startsWith("/llm") ? next() : gzip(c, next)));
  // ETag za velike liste koje se često osvežavaju: ako se ništa nije promenilo, server vraća 304 bez tela
  const tag = etag();
  for (const p of ["/leads", "/stats", "/sources", "/analytics", "/notifications"])
    app.use(p, async (c, next) => {
      await tag(c, next);
      if (c.req.method === "GET") c.header("Cache-Control", "private, no-cache");
    });

  // Mora pre ruta (Hono izvršava redom registracije)
  // Pristup po delu aplikacije (Settings → Team): Sales korisnik ne vidi Delivery i obrnuto
  app.use("/delivery/*", a.space("delivery"));
  app.use("/assistant/*", a.space("delivery"));
  for (const p of ["/leads", "/leads/*", "/pipeline", "/sources", "/sources/*", "/analytics", "/stats"]) app.use(p, a.space("sales"));

  const selectLeads = () =>
    getDb()
      .select({ lead: leads, raw: rawItems, source: sources.name })
      .from(leads)
      .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
      .innerJoin(sources, eq(rawItems.sourceId, sources.id));

  // Greške servera: zabeleži (Settings → System, Telegram) i vrati razumljiv odgovor
  app.onError((err, c) => {
    if (err instanceof HTTPException && err.status < 500) return err.getResponse();
    console.error(`[api] ${c.req.method} ${c.req.path}:`, err);
    void recordError(getDb(), { source: "api", message: err.message, stack: err.stack, url: `${c.req.method} ${c.req.path}` }).catch(() => undefined);
    return c.json({ error: "Something went wrong on the server. It's been logged." }, 500);
  });
  app.route("/", errorRoutes(getDb, a));

  app.get("/health", (c) => c.json({ ok: true, service: "radar-api", time: new Date().toISOString() }));
  // Detaljna provera za spoljni monitoring (UptimeRobot i sl.): 200 kad sve radi, 503 kad ne
  app.get("/health/deep", async (c) => {
    const h = await checkHealth(getDb());
    return c.json(h, h.ok ? 200 : 503);
  });

  // AI Router: javni endpoint za aplikacije klijenata (ključ klijenta) + upravljanje (timska lozinka)
  app.route("/llm", llmProxy());
  app.use("/router/*", a.require("member"));
  app.route("/router", routerAdmin(getDb));

  // Podešavanja Telegram obaveštenja (koje leadove pratimo)
  app.use("/settings/*", a.require("member"));
  app.get("/settings/alerts", async (c) => {
    const [row] = await getDb().select().from(settings).where(eq(settings.key, "alerts")).limit(1);
    return c.json({ alerts: normalizeAlerts(row?.value), telegram: telegramConfigured() });
  });
  app.put("/settings/alerts", async (c) => {
    const alerts = normalizeAlerts(await c.req.json().catch(() => ({})));
    await getDb()
      .insert(settings)
      .values({ key: "alerts", value: alerts })
      .onConflictDoUpdate({ target: settings.key, set: { value: alerts, updatedAt: new Date() } });
    return c.json({ alerts });
  });
  app.post("/settings/alerts/test", async (c) => {
    if (!telegramConfigured()) return c.json({ error: "Telegram is not configured on the server (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)." }, 400);
    const ok = await sendLeadToTelegram({
      score: 88,
      title: "Test alert from Scoutline",
      company: "Your dashboard",
      country: "RS",
      tier: "DOMESTIC",
      budgetEur: null,
      source: "Test",
      url: process.env.DASHBOARD_URL ?? "https://scoutline-app.netlify.app",
      why: ["If you see this, Telegram alerts work."],
    });
    return ok ? c.json({ ok: true }) : c.json({ error: "Telegram rejected the message — check the bot token and chat ID." }, 502);
  });

  // GET /leads?minScore=0&tiers=T1,T2&limit=100 — ocenjeni leadovi, spremni za dashboard
  app.get("/leads", a.readGuard, async (c) => {
    const minScore = Number(c.req.query("minScore") ?? 0);
    const tiers = c.req.query("tiers")?.split(",").filter(Boolean) as Tier[] | undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 1000);
    const includeHidden = c.req.query("includeHidden") === "1";
    const where: SQL[] = [gte(leads.score, minScore)];
    if (!includeHidden) where.push(ne(leads.status, "hidden"));
    if (tiers?.length) where.push(inArray(leads.tier, tiers));
    const rows = await selectLeads()
      .where(and(...where))
      .orderBy(desc(leads.score), desc(rawItems.postedAt))
      .limit(limit);
    return c.json({ items: rows.map(toUiLead) });
  });

  // ── CRM: status, beleške, istorija (izmene traže timsku lozinku) ─────────────
  const requireTeam = a.require("member");

  // PATCH /leads/:id { status } — pomeri lead kroz pipeline
  app.patch("/leads/:id", requireTeam, async (c) => {
    const input = await c.req.json<{ status?: string }>().catch(() => null);
    const status = input?.status as LeadStatus | undefined;
    if (!status || !LEAD_STATUSES.includes(status)) return c.json({ error: `Status must be one of: ${LEAD_STATUSES.join(", ")}.` }, 400);
    const db = getDb();
    const [current] = await db.select({ status: leads.status }).from(leads).where(eq(leads.id, c.req.param("id")!)).limit(1);
    if (!current) return c.json({ error: "Lead not found." }, 404);
    if (current.status !== status) {
      await db.update(leads).set({ status, updatedAt: new Date() }).where(eq(leads.id, c.req.param("id")!));
      await db.insert(leadEvents).values({ leadId: c.req.param("id")!, type: "status_changed", data: { from: current.status, to: status }, actor: actorName(c) });
    }
    const [row] = await selectLeads().where(eq(leads.id, c.req.param("id")!)).limit(1);
    return c.json({ lead: toUiLead(row!) });
  });

  // POST /leads/:id/notes { text } — beleška uz lead
  app.post("/leads/:id/notes", requireTeam, async (c) => {
    const input = await c.req.json<{ text?: string }>().catch(() => null);
    const text = input?.text?.trim();
    if (!text) return c.json({ error: "Note can't be empty." }, 400);
    const db = getDb();
    const [exists] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, c.req.param("id")!)).limit(1);
    if (!exists) return c.json({ error: "Lead not found." }, 404);
    const [event] = await db.insert(leadEvents).values({ leadId: exists.id, type: "note", data: { text: text.slice(0, 4000) }, actor: actorName(c) }).returning();
    return c.json({ event }, 201);
  });

  // GET /leads/:id/events — istorija (statusi, beleške)
  app.get("/leads/:id/events", a.require("viewer"), async (c) => {
    const events = await getDb().select().from(leadEvents).where(eq(leadEvents.leadId, c.req.param("id")!)).orderBy(desc(leadEvents.createdAt)).limit(100);
    return c.json({ events });
  });

  // GET /pipeline — broj leadova i zbir budžeta po statusu
  app.get("/pipeline", a.readGuard, async (c) => {
    const rows = await getDb()
      .select({ status: leads.status, n: count(), value: sql<number>`coalesce(sum(${leads.budgetEur}),0)::float` })
      .from(leads)
      .groupBy(leads.status);
    return c.json({ stages: rows });
  });

  // POST /auth/check — proverava timsku lozinku (za prozor "Add lead")
  app.post("/auth/check", async (c) => {
    const actor = await a.actorFrom(c);
    if (!actor) return c.json({ ok: false, error: process.env.API_TOKEN || (await a.usersExist()) ? "Wrong password." : "Set API_TOKEN on the server." }, 401);
    return c.json({ ok: true, role: actor.role });
  });
  app.route("/auth", a.routes);
  app.route("/team", a.team);
  // Delivery (Faza 10): klijenti, projekti, taskovi
  app.route("/delivery", deliveryRoutes(getDb, a));
  // Faza 11: sprintovi, Inbox, AI agenti, portal za klijenta (javni deo bez prijave)
  app.route("/delivery", deliveryPlusRoutes(getDb, a));
  app.route("/portal", portalRoutes(getDb));
  // Faza 12: vreme i izveštaji (profitabilnost, AI)
  app.route("/delivery", reportRoutes(getDb, a));
  // Settings → Integrations: ključevi firme (vlasnik) i lični GitHub token (svako)
  app.route("/integrations", integrationRoutes(getDb, a));
  app.route("/notifications", notificationRoutes(getDb, a.readGuard));
  // Faza 13: AI asistent (pitaj projekat, status izveštaj)
  app.route("/assistant", assistantRoutes(getDb, a));
  // Faza 14: GitHub tok rada (repoi, analitika, PR-ovi, grane, Actions, deploy)
  app.route("/delivery", githubFlowRoutes(getDb, a));
  // Faza 16: Claude Code iz aplikacije (setup repoa, sesije, odgovori, potrošnja)
  app.route("/delivery", agentRoutes(getDb, a));
  // „Run in browser“: pregled sajta iz repoa (potpisan link)
  app.route("/", previewRoutes(getDb, a));
  // Faza 15: organizacija, skills, Figma, pokreni lokalno
  app.route("/", workspaceRoutes(getDb, a));

  // GET /share/:token — javni prikaz samo za čitanje (bez beleški, email nacrta i izmena)
  app.get("/share/:token", async (c) => {
    const share = await a.findShare(c.req.param("token")!);
    if (!share) return c.json({ error: "This link is invalid, expired or was revoked." }, 404);
    const rows = await selectLeads()
      .where(and(gte(leads.score, share.minScore), ne(leads.status, "hidden")))
      .orderBy(desc(leads.score), desc(rawItems.postedAt))
      .limit(500);
    return c.json({
      label: share.label,
      items: rows.map((r) => ({ ...toUiLead(r), email: { subject: "", body: "" }, status: undefined })),
    });
  });

  // POST /leads/manual { url?, text?, company?, location? } — ručno dodat lead, odmah ocenjen
  app.post("/leads/manual", a.require("member"), async (c) => {
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
      leadType: "project", // ručno dodat = najčešće projekat; AI može da ga prebaci u oglas za posao
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

  // PATCH /sources/:id { intervalMinutes?, enabled? } — raspored i pauza (član tima)
  app.patch("/sources/:id", a.require("member"), async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { intervalMinutes?: unknown; enabled?: unknown };
    const set: Partial<typeof sources.$inferInsert> = { updatedAt: new Date() };
    if (b.intervalMinutes !== undefined) {
      const m = Math.round(Number(b.intervalMinutes));
      if (!Number.isFinite(m) || m < 10 || m > 7 * 24 * 60) return c.json({ error: "Schedule must be between 10 minutes and 7 days." }, 400);
      set.intervalMinutes = m;
      set.customInterval = true;
    }
    if (typeof b.enabled === "boolean") set.enabled = b.enabled;
    const [row] = await getDb().update(sources).set(set).where(eq(sources.id, c.req.param("id")!)).returning({ id: sources.id });
    return row ? c.json({ ok: true }) : c.json({ error: "Source not found." }, 404);
  });
  // POST /sources/:id/run — „Run now“: worker ga pokreće u sledećem krugu (do 1 min)
  app.post("/sources/:id/run", a.require("member"), async (c) => {
    const [row] = await getDb().update(sources).set({ runRequestedAt: new Date() }).where(eq(sources.id, c.req.param("id")!)).returning({ id: sources.id });
    return row ? c.json({ ok: true }) : c.json({ error: "Source not found." }, 404);
  });

  // GET /sources — stanje svakog izvora + broj leadova
  app.get("/sources", a.readGuard, async (c) => {
    const db = getDb();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const rows = await db.execute<{
      id: string; name: string; kind: string; enabled: boolean; interval_minutes: number; last_success_at: string | null; last_error: string | null; run_requested_at: string | null;
      items: number; leads: number; leads_24h: number; good: number;
    }>(sql`
      -- Prvo saberi po izvoru (brzo), pa spoji sa izvorima — bez množenja redova kroz dva LEFT JOIN-a
      with ri as (select source_id, count(*)::int as items from raw_items group by source_id),
           ld as (
             select r.source_id,
                    count(*) filter (where l.status <> 'hidden')::int as leads,
                    count(*) filter (where l.status <> 'hidden' and l.created_at >= ${dayAgo}::timestamptz)::int as leads_24h,
                    count(*) filter (where l.status <> 'hidden' and l.score >= 70)::int as good
             from leads l join raw_items r on r.id = l.raw_item_id
             group by r.source_id)
      select s.id, s.name, s.kind, s.enabled, s.interval_minutes, s.last_success_at, s.last_error, s.run_requested_at,
             coalesce(ri.items, 0) as items, coalesce(ld.leads, 0) as leads, coalesce(ld.leads_24h, 0) as leads_24h, coalesce(ld.good, 0) as good
      from sources s
      left join ri on ri.source_id = s.id
      left join ld on ld.source_id = s.id
      order by leads desc`);
    return c.json({
      items: [...rows].map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        enabled: r.enabled,
        intervalMinutes: r.interval_minutes,
        lastSuccessAt: r.last_success_at,
        lastError: r.last_error,
        runRequestedAt: r.run_requested_at,
        items: r.items,
        leads: r.leads,
        leads24h: r.leads_24h,
        good: r.good,
      })),
    });
  });

  // GET /analytics?days=30 — podaci za Overview grafikone
  app.get("/analytics", a.readGuard, async (c) => {
    const db = getDb();
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30), 7), 90);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => db.execute<T>(query).then((r) => [...r]);
    const [daily, bySource, byTier, byCategory, funnel, scoring, byType] = await Promise.all([
      q<{ day: string; leads: number; good: number }>(sql`
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as leads,
               count(*) filter (where score >= 70)::int as good
        from leads where status <> 'hidden' and created_at >= ${since}::timestamptz group by 1 order by 1`),
      q<{ name: string; leads: number; good: number; avg: number }>(sql`
        select s.name, count(l.id)::int as leads, count(l.id) filter (where l.score >= 70)::int as good, coalesce(avg(l.score),0)::float as avg
        from leads l join raw_items r on r.id = l.raw_item_id join sources s on s.id = r.source_id
        where l.status <> 'hidden' and l.created_at >= ${since}::timestamptz group by s.name order by leads desc`),
      q<{ key: string; leads: number }>(sql`select coalesce(tier::text,'UNKNOWN') as key, count(*)::int as leads from leads where status <> 'hidden' and created_at >= ${since}::timestamptz group by 1 order by 2 desc`),
      q<{ key: string; leads: number }>(sql`select coalesce(category::text,'other_dev') as key, count(*)::int as leads from leads where status <> 'hidden' and created_at >= ${since}::timestamptz group by 1 order by 2 desc`),
      q<{ key: string; leads: number }>(sql`select status::text as key, count(*)::int as leads from leads group by 1`),
      q<{ key: string; leads: number }>(sql`select case when scored_by like 'ai%' then 'ai' when scored_by = 'rules' then 'rules' else 'pending' end as key, count(*)::int as leads from leads group by 1`),
      q<{ key: string; leads: number; good: number }>(sql`select coalesce(lead_type::text,'hiring_signal') as key, count(*)::int as leads, count(*) filter (where score >= 70)::int as good from leads where status <> 'hidden' and created_at >= ${since}::timestamptz group by 1 order by 2 desc`),
    ]);
    let aiDaily: Array<{ day: string; requests: number; spend: number }> = [];
    try {
      aiDaily = await q(sql`select to_char(date_trunc('day', "startTime"), 'YYYY-MM-DD') as day, count(*)::int as requests, coalesce(sum(spend),0)::float as spend
        from "LiteLLM_SpendLogs" where "startTime" >= ${since}::timestamptz group by 1 order by 1`);
    } catch {
      /* LiteLLM tabele ne postoje */
    }
    return c.json({ days, daily, bySource, byTier, byCategory, byType, funnel, scoring, aiDaily });
  });

  // GET /stats — brojevi za KPI kartice i stanje izvora
  app.get("/stats", a.readGuard, async (c) => {
    const db = getDb();
    const dayAgo = new Date(Date.now() - 86_400_000);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const [today] = await db.select({ n: count() }).from(leads).where(and(gte(leads.createdAt, dayAgo), ne(leads.status, "hidden")));
    const [yesterday] = await db
      .select({ n: count() })
      .from(leads)
      .where(and(gte(leads.createdAt, twoDaysAgo), lt(leads.createdAt, dayAgo), ne(leads.status, "hidden")));
    // Trošak AI-a ovog meseca (LiteLLM beleži sve pozive: ocenjivanje + AI Router)
    let aiCostUsd = 0;
    try {
      const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const [row] = await db.execute<{ spend: number }>(sql`select coalesce(sum(spend),0)::float as spend from "LiteLLM_SpendLogs" where "startTime" >= ${month}::timestamptz`);
      aiCostUsd = Number(row?.spend ?? 0);
    } catch {
      /* LiteLLM tabele još ne postoje */
    }
    const [total] = await db.select({ n: count() }).from(leads).where(ne(leads.status, "hidden"));
    const srcs = await db.select().from(sources);
    const scoring = await db.select({ by: leads.scoredBy, n: count() }).from(leads).groupBy(leads.scoredBy);
    const sum = (pred: (by: string | null) => boolean) => scoring.filter((r) => pred(r.by)).reduce((a, r) => a + r.n, 0);
    return c.json({
      newToday: today?.n ?? 0,
      newYesterday: yesterday?.n ?? 0,
      total: total?.n ?? 0,
      aiCostUsd,
      scoring: { ai: sum((b) => !!b?.startsWith("ai")), rules: sum((b) => b === "rules"), pending: sum((b) => b === null) },
      sources: srcs.map((s) => ({ id: s.id, name: s.name, lastSuccessAt: s.lastSuccessAt, lastError: s.lastError })),
    });
  });

  return app;
}

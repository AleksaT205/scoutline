import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { clients, customers, issues, projects, settings, timeEntries, users, type Db } from "@radar/db";
import { normalizeRates, type Rates } from "@radar/shared";
import { baseline } from "./router.js";

/**
 * Faza 12: evidencija vremena i izveštaji — profitabilnost po projektu, vreme po osobi/nedelji, AI trošak i ušteda.
 * Prihod: fiksna cena = budžet projekta; po satu = naplativi sati × satnica.
 * Trošak: sati × interna cena sata (po osobi ili podrazumevana) + AI trošak ključeva AI Router-a vezanih za projekat.
 */
interface Guards {
  readGuard: MiddlewareHandler;
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
}
type Actor = { id: string | null; name: string; role?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const USD_EUR = Number(process.env.USD_EUR ?? 0.92);
const DAY = 86_400_000;
const n = (v: unknown) => Number(v ?? 0) || 0;
const round = (v: number) => Math.round(v * 100) / 100;

export async function loadRates(db: Db): Promise<Rates> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "rates")).limit(1);
  return normalizeRates(row?.value);
}
const rateFor = (r: Rates, userId: string | null) => (userId && r.members[userId] !== undefined ? r.members[userId]! : r.defaultHourlyCost);

/** AI trošak po ključu iz LiteLLM evidencije (ako tabela postoji). */
async function aiUsage(db: Db, keys: string[], since: Date | null) {
  if (!keys.length) return new Map<string, { spend: number; base: number; requests: number }>();
  try {
    const rows = await db.execute<{ api_key: string; spend: number; pin: number; pout: number; requests: number }>(sql`
      select api_key, coalesce(sum(spend),0)::float as spend, coalesce(sum(prompt_tokens),0)::float as pin,
             coalesce(sum(completion_tokens),0)::float as pout, count(*)::int as requests
      from "LiteLLM_SpendLogs"
      where api_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) ${since ? sql`and "startTime" >= ${since.toISOString()}::timestamptz` : sql``}
      group by api_key`);
    return new Map([...rows].map((r) => [r.api_key, { spend: n(r.spend), base: baseline(n(r.pin), n(r.pout)), requests: n(r.requests) }]));
  } catch {
    return new Map(); // LiteLLM tabele ne postoje (npr. lokalni test)
  }
}

export function reportRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };
  const member = g.require("member");

  // ── Vreme ──
  app.get("/time", g.readGuard, async (c) => {
    const { issueId, projectId } = c.req.query();
    const where = isUuid(issueId) ? eq(timeEntries.issueId, issueId) : isUuid(projectId) ? eq(timeEntries.projectId, projectId) : null;
    if (!where) return c.json({ entries: [] });
    const entries = await getDb().select().from(timeEntries).where(where).orderBy(desc(timeEntries.spentOn), desc(timeEntries.createdAt)).limit(500);
    return c.json({ entries, totalMinutes: entries.reduce((a, e) => a + e.minutes, 0) });
  });

  app.post("/time", member, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const minutes = Math.round(Number(b.minutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) return c.json({ error: "Enter time between 1 minute and 24 hours." }, 400);
    const db = getDb();
    let projectId = isUuid(b.projectId) ? b.projectId : null;
    const issueId = isUuid(b.issueId) ? b.issueId : null;
    if (issueId) {
      const [i] = await db.select({ projectId: issues.projectId }).from(issues).where(eq(issues.id, issueId)).limit(1);
      if (!i) return c.json({ error: "Issue not found." }, 404);
      projectId = i.projectId;
    }
    if (!projectId) return c.json({ error: "Pick a project or issue." }, 400);
    const spentOn = typeof b.spentOn === "string" && !Number.isNaN(Date.parse(b.spentOn)) ? new Date(b.spentOn) : new Date();
    const a = actor(c);
    const [entry] = await db
      .insert(timeEntries)
      .values({ projectId, issueId, userId: a.id, userName: a.name, minutes, spentOn, note: typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null, billable: b.billable !== false })
      .returning();
    return c.json({ entry }, 201);
  });

  app.delete("/time/:id", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Not found." }, 404);
    const db = getDb();
    const [e] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
    if (!e) return c.json({ error: "Not found." }, 404);
    const a = actor(c);
    if (a.role !== "owner" && e.userId !== a.id) return c.json({ error: "You can delete only your own time." }, 403);
    await db.delete(timeEntries).where(eq(timeEntries.id, id));
    return c.json({ ok: true });
  });

  // ── Cene rada ──
  // Cene rada i izveštaj o zaradi vidi samo vlasnik (marža, trošak, satnice)
  app.get("/rates", g.require("owner"), async (c) => c.json({ rates: await loadRates(getDb()) }));
  app.put("/rates", g.require("owner"), async (c) => {
    const rates = normalizeRates(await c.req.json().catch(() => ({})));
    await getDb()
      .insert(settings)
      .values({ key: "rates", value: rates })
      .onConflictDoUpdate({ target: settings.key, set: { value: rates, updatedAt: new Date() } });
    return c.json({ rates });
  });

  // ── AI Router ključ → projekat (AI trošak ide na projekat) ──
  app.get("/ai-clients", member, async (c) => {
    const rows = await getDb().select({ id: clients.id, name: clients.name, projectId: clients.projectId, status: clients.status }).from(clients).orderBy(clients.name);
    return c.json({ clients: rows });
  });
  app.put("/projects/:id/ai-client", member, async (c) => {
    const id = c.req.param("id")!;
    const clientId = ((await c.req.json().catch(() => ({}))) as { clientId?: unknown }).clientId;
    if (!isUuid(id)) return c.json({ error: "Project not found." }, 404);
    const db = getDb();
    await db.update(clients).set({ projectId: null }).where(eq(clients.projectId, id));
    if (isUuid(clientId)) await db.update(clients).set({ projectId: id, updatedAt: new Date() }).where(eq(clients.id, clientId));
    return c.json({ ok: true });
  });

  // ── Izveštaj ──
  // GET /delivery/reports?days=30|90|365|0 — period važi za vreme po osobi/nedelji i AI ukupno; profitabilnost projekta je ukupna (do danas)
  app.get("/reports", g.require("owner"), async (c) => {
    const db = getDb();
    const days = Math.max(0, Math.min(3650, Number(c.req.query("days") ?? 30) || 0));
    const since = days ? new Date(Date.now() - days * DAY) : null;
    const rates = await loadRates(db);

    const plist = await db.select({ p: projects, customerName: customers.name }).from(projects).leftJoin(customers, eq(projects.customerId, customers.id)).orderBy(desc(projects.updatedAt));
    const entries = await db.select().from(timeEntries);
    const aiClients = await db.select({ id: clients.id, name: clients.name, keyToken: clients.keyToken, projectId: clients.projectId }).from(clients);
    const usageAll = await aiUsage(db, aiClients.map((x) => x.keyToken), null);
    const usagePeriod = since ? await aiUsage(db, aiClients.map((x) => x.keyToken), since) : usageAll;
    const issueStats = plist.length
      ? await db
          .select({
            projectId: issues.projectId,
            done: sql<number>`count(*) filter (where ${issues.status} = 'done')::int`,
            total: sql<number>`count(*) filter (where ${issues.status} not in ('canceled','triage'))::int`,
            points: sql<number>`coalesce(sum(${issues.estimate}) filter (where ${issues.status} = 'done'),0)::int`,
            agentDone: sql<number>`count(*) filter (where ${issues.status} = 'done' and ${issues.agent} is not null)::int`,
          })
          .from(issues)
          .where(inArray(issues.projectId, plist.map((x) => x.p.id)))
          .groupBy(issues.projectId)
      : [];

    const projectsOut = plist.map(({ p, customerName }) => {
      const mine = entries.filter((e) => e.projectId === p.id);
      const minutes = mine.reduce((a, e) => a + e.minutes, 0);
      const billableMin = mine.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0);
      const laborCost = mine.reduce((a, e) => a + (e.minutes / 60) * rateFor(rates, e.userId), 0);
      const keys = aiClients.filter((x) => x.projectId === p.id);
      const ai = keys.reduce((a, k) => {
        const u = usageAll.get(k.keyToken);
        return { spend: a.spend + (u?.spend ?? 0), base: a.base + (u?.base ?? 0), requests: a.requests + (u?.requests ?? 0) };
      }, { spend: 0, base: 0, requests: 0 });
      const aiCost = ai.spend * USD_EUR;
      const revenue = p.billing === "hourly" ? (billableMin / 60) * (p.hourlyRateEur ?? 0) : (p.budgetEur ?? 0);
      const cost = laborCost + aiCost;
      const st = issueStats.find((s) => s.projectId === p.id);
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        customerName,
        status: p.status,
        billing: p.billing,
        hourlyRateEur: p.hourlyRateEur,
        budgetEur: p.budgetEur,
        revenue: round(revenue),
        hours: round(minutes / 60),
        billableHours: round(billableMin / 60),
        laborCost: round(laborCost),
        aiCost: round(aiCost),
        aiSavings: round(Math.max(0, ai.base - ai.spend) * USD_EUR),
        aiRequests: ai.requests,
        aiClients: keys.map((k) => k.name),
        cost: round(cost),
        margin: round(revenue - cost),
        marginPct: revenue > 0 && cost > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null, // bez troška još nema smisla
        budgetUsedPct: p.billing === "fixed" && p.budgetEur ? Math.round((cost / p.budgetEur) * 100) : null,
        effectiveRate: minutes ? round(revenue / (minutes / 60)) : null, // koliko zaista zarađujemo po satu
        issues: { done: st?.done ?? 0, total: st?.total ?? 0, points: st?.points ?? 0, agentDone: st?.agentDone ?? 0 },
      };
    });

    // Period: vreme po osobi i po nedelji
    const periodEntries = since ? entries.filter((e) => e.spentOn >= since) : entries;
    const people = new Map<string, { name: string; minutes: number; cost: number; billable: number }>();
    for (const e of periodEntries) {
      const k = e.userId ?? `name:${e.userName}`;
      const cur = people.get(k) ?? { name: e.userName, minutes: 0, cost: 0, billable: 0 };
      cur.minutes += e.minutes;
      cur.billable += e.billable ? e.minutes : 0;
      cur.cost += (e.minutes / 60) * rateFor(rates, e.userId);
      people.set(k, cur);
    }
    const weekStart = (d: Date) => {
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      return x.toISOString().slice(0, 10);
    };
    const weeksN = Math.min(26, Math.max(4, Math.ceil((days || 84) / 7)));
    const weeks: Array<{ week: string; hours: number; billable: number }> = [];
    for (let i = weeksN - 1; i >= 0; i--) weeks.push({ week: weekStart(new Date(Date.now() - i * 7 * DAY)), hours: 0, billable: 0 });
    for (const e of entries) {
      const w = weeks.find((x) => x.week === weekStart(e.spentOn));
      if (w) {
        w.hours += e.minutes / 60;
        if (e.billable) w.billable += e.minutes / 60;
      }
    }

    // AI ukupno za period (svi ključevi) + taskovi koje su završili agenti
    const aiTotal = [...usagePeriod.values()].reduce((a, u) => ({ spend: a.spend + u.spend, base: a.base + u.base, requests: a.requests + u.requests }), { spend: 0, base: 0, requests: 0 });
    const [agent] = await db
      .select({ done: sql<number>`count(*)::int`, points: sql<number>`coalesce(sum(${issues.estimate}),0)::int` })
      .from(issues)
      .where(and(eq(issues.status, "done"), isNotNull(issues.agent), ...(since ? [gte(issues.completedAt, since)] : [])));

    const live = projectsOut.filter((p) => p.status !== "canceled");
    const periodMinutes = periodEntries.reduce((a, e) => a + e.minutes, 0);
    return c.json({
      days,
      rates,
      totals: {
        revenue: round(live.reduce((a, p) => a + p.revenue, 0)),
        cost: round(live.reduce((a, p) => a + p.cost, 0)),
        margin: round(live.reduce((a, p) => a + p.margin, 0)),
        hoursPeriod: round(periodMinutes / 60),
        billablePct: periodMinutes ? Math.round((periodEntries.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0) / periodMinutes) * 100) : null,
      },
      projects: projectsOut,
      people: [...people.values()].map((p) => ({ name: p.name, hours: round(p.minutes / 60), billableHours: round(p.billable / 60), cost: round(p.cost) })).sort((a, b) => b.hours - a.hours),
      weeks: weeks.map((w) => ({ ...w, hours: round(w.hours), billable: round(w.billable) })),
      ai: { spendEur: round(aiTotal.spend * USD_EUR), baselineEur: round(aiTotal.base * USD_EUR), savingsEur: round(Math.max(0, aiTotal.base - aiTotal.spend) * USD_EUR), requests: aiTotal.requests, agentTasks: n(agent?.done), agentPoints: n(agent?.points) },
      members: await db.select({ id: users.id, name: users.name }).from(users),
    });
  });

  return app;
}

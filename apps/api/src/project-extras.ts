import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { customers, invoices, issues, projectDocs, projectRepoNames, projects, settings, siteChecks, timeEntries, userGithubToken, ghFetch, type Db } from "@radar/db";
import { sendTelegramText } from "@radar/scoring";
import { callFree } from "./assistant.js";
import { runtime } from "./runtime.js";
import { assertPublic } from "./safe-fetch.js";

/**
 * Projekat → Overview: dokumentacija (markdown, opciono za AI), release notes iz spojenih PR-ova i završenih taskova,
 * fakture (iz sati ili budžeta, broj po godini, stranica za štampu / PDF) i zdravlje sajta klijenta (provera na 5 min).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Actor = { id: string | null; name: string; role?: string };
type Guards = { require: (r: "owner" | "member" | "viewer") => MiddlewareHandler; readGuard: MiddlewareHandler };
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

/** Dokumenti za Claude-a (samo „Share with AI“), skraćeno. */
export async function docsForAi(db: Db, projectId: string) {
  const rows = await db.select({ title: projectDocs.title, body: projectDocs.body }).from(projectDocs).where(and(eq(projectDocs.projectId, projectId), eq(projectDocs.shareWithAi, true))).orderBy(asc(projectDocs.createdAt)).limit(12);
  let budget = 6000;
  const out: string[] = [];
  for (const d of rows) {
    const part = `### ${d.title}\n${d.body.slice(0, 1500)}`;
    if (budget - part.length < 0) break;
    budget -= part.length;
    out.push(part);
  }
  return out.join("\n\n");
}

export function projectExtrasRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };
  const member = g.require("member");
  const owner = g.require("owner");
  const projectOf = async (id: string | undefined) => (id && UUID.test(id) ? (await getDb().select().from(projects).where(eq(projects.id, id)).limit(1))[0] : undefined);

  // ── Dokumentacija ──
  app.get("/projects/:id/docs", g.readGuard, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p) return c.json({ error: "Project not found." }, 404);
    const rows = await getDb().select().from(projectDocs).where(eq(projectDocs.projectId, p.id)).orderBy(asc(projectDocs.createdAt));
    return c.json({ docs: rows });
  });
  app.post("/projects/:id/docs", member, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p) return c.json({ error: "Project not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = str(b.title, 120) || "Untitled";
    const [row] = await getDb().insert(projectDocs).values({ projectId: p.id, title, body: str(b.body, 50_000), shareWithAi: b.shareWithAi !== false, updatedBy: actor(c).name }).returning();
    return c.json({ doc: row }, 201);
  });
  app.patch("/docs/:docId", member, async (c) => {
    const id = c.req.param("docId")!;
    if (!UUID.test(id)) return c.json({ error: "Not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const set: Partial<typeof projectDocs.$inferInsert> = { updatedAt: new Date(), updatedBy: actor(c).name };
    if (b.title !== undefined) set.title = str(b.title, 120) || "Untitled";
    if (b.body !== undefined) set.body = str(b.body, 50_000);
    if (b.shareWithAi !== undefined) set.shareWithAi = b.shareWithAi === true;
    const [row] = await getDb().update(projectDocs).set(set).where(eq(projectDocs.id, id)).returning();
    return row ? c.json({ doc: row }) : c.json({ error: "Not found." }, 404);
  });
  app.delete("/docs/:docId", member, async (c) => {
    const id = c.req.param("docId")!;
    if (!UUID.test(id)) return c.json({ error: "Not found." }, 404);
    await getDb().delete(projectDocs).where(eq(projectDocs.id, id));
    return c.json({ ok: true });
  });

  // ── Release notes: spojeni PR-ovi i završeni taskovi u periodu ──
  const collect = async (c: Context, p: typeof projects.$inferSelect, days: number) => {
    const since = new Date(Date.now() - days * 86_400_000);
    const db = getDb();
    const done = await db.select({ number: issues.number, title: issues.title, at: issues.completedAt }).from(issues).where(and(eq(issues.projectId, p.id), eq(issues.status, "done"), gte(issues.completedAt, since))).orderBy(desc(issues.completedAt)).limit(60);
    const tok = (await userGithubToken(db, actor(c).id)) ?? (await runtime(db)).githubToken;
    const prs: Array<{ repo: string; number: number; title: string; at: string; url: string }> = [];
    if (tok) {
      for (const full of await projectRepoNames(db, p)) {
        const r = await ghFetch(tok, `/repos/${full}/pulls?state=closed&per_page=50&sort=updated&direction=desc`);
        if (!r.ok) continue;
        for (const x of (await r.json()) as Array<{ number: number; title: string; merged_at: string | null; html_url: string }>) if (x.merged_at && Date.parse(x.merged_at) >= since.getTime()) prs.push({ repo: full, number: x.number, title: x.title, at: x.merged_at, url: x.html_url });
      }
    }
    return { since: since.toISOString(), tasks: done.map((t) => ({ key: `${p.key}-${t.number}`, title: t.title, at: t.at?.toISOString() ?? null })), prs: prs.sort((a, b) => b.at.localeCompare(a.at)) };
  };
  app.get("/projects/:id/release-notes", g.readGuard, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p) return c.json({ error: "Project not found." }, 404);
    const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 14) || 14));
    return c.json(await collect(c, p, days));
  });
  app.post("/projects/:id/release-notes/polish", member, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p) return c.json({ error: "Project not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { days?: number; lang?: string };
    const days = Math.min(90, Math.max(1, Number(b.days ?? 14) || 14));
    const data = await collect(c, p, days);
    if (!data.tasks.length && !data.prs.length) return c.json({ text: "" });
    const lines = [...data.tasks.map((t) => `- ${t.title}`), ...data.prs.map((x) => `- ${x.title.replace(/^\[[^\]]+\]\s*/, "")}`)].slice(0, 80).join("\n");
    const system = [
      `You write short release notes for the client of the project "${p.name}".`,
      b.lang === "sr" ? "Write in Serbian (Latin script)." : "Write in clear English.",
      "Group into 'New', 'Improved' and 'Fixed' (skip empty groups). One short line per item, plain language the client understands, no technical jargon, no ticket keys, no duplicates. Never mention AI. Markdown headings and bullets only.",
    ].join("\n");
    try {
      const out = await callFree("smart", system, [{ role: "user", content: `Changes in the last ${days} days:\n${lines}` }], 700);
      return c.json({ text: out.text.trim() });
    } catch (e) {
      return c.json({ error: `The free AI models didn't answer — try again. (${(e as Error).message.slice(0, 100)})` }, 502);
    }
  });

  // ── Fakture (vlasnik) ──
  const nextNumber = async (db: Db) => {
    const year = new Date().getFullYear();
    const [row] = await db.select().from(settings).where(eq(settings.key, "invoice_seq")).limit(1);
    const cur = (row?.value as { year?: number; n?: number } | undefined) ?? {};
    const n = cur.year === year ? (cur.n ?? 0) + 1 : 1;
    await db.insert(settings).values({ key: "invoice_seq", value: { year, n } }).onConflictDoUpdate({ target: settings.key, set: { value: { year, n }, updatedAt: new Date() } });
    return `${year}-${String(n).padStart(3, "0")}`;
  };
  const cleanItems = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ description: str(x.description, 300), qty: Math.max(0, Number(x.qty) || 0), unit: str(x.unit, 20) || "pcs", unitPrice: Math.max(0, Number(x.unitPrice) || 0) }))
      .filter((x) => x.description && x.qty > 0)
      .slice(0, 50);
  const total = (items: Array<{ qty: number; unitPrice: number }>) => Math.round(items.reduce((a, x) => a + x.qty * x.unitPrice, 0) * 100) / 100;

  // Predlog stavki: po satu → sati po osobi (period); fiksno → jedna stavka sa budžetom
  app.get("/projects/:id/invoice-draft", owner, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p) return c.json({ error: "Project not found." }, 404);
    const to = c.req.query("to") ? new Date(c.req.query("to")!) : new Date();
    const from = c.req.query("from") ? new Date(c.req.query("from")!) : new Date(to.getFullYear(), to.getMonth(), 1);
    let items: Array<{ description: string; qty: number; unit: string; unitPrice: number }> = [];
    if (p.billing === "hourly") {
      const rows = await getDb()
        .select({ who: timeEntries.userName, minutes: sql<number>`sum(${timeEntries.minutes})::int` })
        .from(timeEntries)
        .where(and(eq(timeEntries.projectId, p.id), eq(timeEntries.billable, true), gte(timeEntries.spentOn, from), lt(timeEntries.spentOn, new Date(to.getTime() + 86_400_000))))
        .groupBy(timeEntries.userName);
      items = rows.map((r) => ({ description: `${p.name} — development (${r.who})`, qty: Math.round((r.minutes / 60) * 100) / 100, unit: "h", unitPrice: p.hourlyRateEur ?? 0 }));
    } else items = [{ description: `${p.name}`, qty: 1, unit: "pcs", unitPrice: p.budgetEur ?? 0 }];
    return c.json({ items, from: from.toISOString(), to: to.toISOString(), customerId: p.customerId });
  });
  app.get("/projects/:id/invoices", owner, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p) return c.json({ error: "Project not found." }, 404);
    return c.json({ invoices: await getDb().select().from(invoices).where(eq(invoices.projectId, p.id)).orderBy(desc(invoices.issuedAt)) });
  });
  app.post("/projects/:id/invoices", owner, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p) return c.json({ error: "Project not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const items = cleanItems(b.items);
    if (!items.length) return c.json({ error: "Add at least one line with a quantity." }, 400);
    const issuedAt = b.issuedAt ? new Date(String(b.issuedAt)) : new Date();
    const dueAt = b.dueAt ? new Date(String(b.dueAt)) : new Date(issuedAt.getTime() + 15 * 86_400_000);
    const db = getDb();
    const [row] = await db
      .insert(invoices)
      .values({ number: await nextNumber(db), projectId: p.id, customerId: p.customerId, issuedAt, dueAt, periodFrom: b.periodFrom ? new Date(String(b.periodFrom)) : null, periodTo: b.periodTo ? new Date(String(b.periodTo)) : null, items, totalEur: total(items), notes: str(b.notes, 2000) || null, createdBy: actor(c).name })
      .returning();
    return c.json({ invoice: row }, 201);
  });
  app.patch("/invoices/:invId", owner, async (c) => {
    const id = c.req.param("invId")!;
    if (!UUID.test(id)) return c.json({ error: "Not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const set: Partial<typeof invoices.$inferInsert> = { updatedAt: new Date() };
    if (b.status === "draft" || b.status === "sent" || b.status === "paid") set.status = b.status;
    if (b.items !== undefined) {
      const items = cleanItems(b.items);
      if (!items.length) return c.json({ error: "Add at least one line with a quantity." }, 400);
      set.items = items;
      set.totalEur = total(items);
    }
    if (b.notes !== undefined) set.notes = str(b.notes, 2000) || null;
    if (b.dueAt) set.dueAt = new Date(String(b.dueAt));
    const [row] = await getDb().update(invoices).set(set).where(eq(invoices.id, id)).returning();
    return row ? c.json({ invoice: row }) : c.json({ error: "Not found." }, 404);
  });
  app.delete("/invoices/:invId", owner, async (c) => {
    const id = c.req.param("invId")!;
    if (!UUID.test(id)) return c.json({ error: "Not found." }, 404);
    await getDb().delete(invoices).where(and(eq(invoices.id, id), eq(invoices.status, "draft")));
    return c.json({ ok: true });
  });
  // Faktura za štampu: faktura + projekat + klijent + podaci firme
  app.get("/invoices/:invId", owner, async (c) => {
    const id = c.req.param("invId")!;
    if (!UUID.test(id)) return c.json({ error: "Not found." }, 404);
    const db = getDb();
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) return c.json({ error: "Not found." }, 404);
    const [p] = await db.select({ name: projects.name, key: projects.key }).from(projects).where(eq(projects.id, inv.projectId)).limit(1);
    const [cust] = inv.customerId ? await db.select().from(customers).where(eq(customers.id, inv.customerId)).limit(1) : [];
    const [org] = await db.select().from(settings).where(eq(settings.key, "organization")).limit(1);
    return c.json({ invoice: inv, project: p ?? null, customer: cust ?? null, organization: org?.value ?? {} });
  });

  // ── Zdravlje sajta ──
  app.get("/projects/:id/health", g.readGuard, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p) return c.json({ error: "Project not found." }, 404);
    if (!p.siteUrl) return c.json({ url: null });
    const db = getDb();
    const recent = await db.select().from(siteChecks).where(eq(siteChecks.projectId, p.id)).orderBy(desc(siteChecks.at)).limit(48);
    const [week] = await db
      .select({ n: sql<number>`count(*)::int`, ok: sql<number>`count(*) filter (where ${siteChecks.ok})::int`, ms: sql<number>`coalesce(avg(${siteChecks.ms}) filter (where ${siteChecks.ok}),0)::int` })
      .from(siteChecks)
      .where(and(eq(siteChecks.projectId, p.id), gte(siteChecks.at, new Date(Date.now() - 7 * 86_400_000))));
    return c.json({ url: p.siteUrl, last: recent[0] ?? null, uptime: week?.n ? Math.round((week.ok / week.n) * 1000) / 10 : null, avgMs: week?.ms ?? null, recent: recent.reverse() });
  });
  app.post("/projects/:id/health/check", member, async (c) => {
    const p = await projectOf(c.req.param("id"));
    if (!p?.siteUrl) return c.json({ error: "Add the site address first (Edit project)." }, 400);
    await checkSite(getDb(), p);
    return c.json({ ok: true });
  });

  return app;
}

/** Jedna provera sajta; Telegram kad padne ili se vrati. */
const lastState = new Map<string, boolean>();
export async function checkSite(db: Db, p: { id: string; name: string; siteUrl: string | null }) {
  if (!p.siteUrl) return;
  const started = Date.now();
  let ok = false;
  let status: number | null = null;
  let error: string | null = null;
  try {
    const url = new URL(p.siteUrl);
    await assertPublic(url);
    const r = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": "Scoutline uptime check" }, signal: AbortSignal.timeout(15_000) });
    status = r.status;
    ok = r.status < 400;
    await r.body?.cancel().catch(() => undefined);
    if (!ok) error = `HTTP ${r.status}`;
  } catch (e) {
    error = (e as Error).name === "TimeoutError" ? "No answer in 15 s" : (e as Error).message.slice(0, 200);
  }
  const ms = Date.now() - started;
  await db.insert(siteChecks).values({ projectId: p.id, ok, status, ms: ok ? ms : null, error });
  // Prelaz radi ↔ ne radi (prva provera posle starta se ne javlja — samo pamti stanje)
  const prev = lastState.has(p.id) ? lastState.get(p.id) : (await db.select({ ok: siteChecks.ok }).from(siteChecks).where(eq(siteChecks.projectId, p.id)).orderBy(desc(siteChecks.at)).offset(1).limit(1))[0]?.ok;
  lastState.set(p.id, ok);
  if (prev !== undefined && prev !== ok) {
    await sendTelegramText(ok ? `✅ <b>${esc(p.name)}</b> site is back up\n${esc(p.siteUrl)}` : `🔴 <b>${esc(p.name)}</b> site is down\n${esc(p.siteUrl)}\n${esc(error ?? "")}`).catch(() => false);
  }
}

export function startSiteMonitor(getDb: () => Db) {
  const tick = async () => {
    const db = getDb();
    const list = await db.select({ id: projects.id, name: projects.name, siteUrl: projects.siteUrl }).from(projects).where(and(isNotNull(projects.siteUrl), inArray(projects.status, ["planned", "active", "paused"]))).catch(() => []);
    for (const p of list) await checkSite(db, p).catch((e) => console.warn("[site]", (e as Error).message));
    await db.delete(siteChecks).where(lt(siteChecks.at, new Date(Date.now() - 14 * 86_400_000))).catch(() => undefined);
  };
  setTimeout(() => void tick(), 45_000);
  setInterval(() => void tick(), 5 * 60_000);
}

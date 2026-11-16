import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { customers, cycles, issueEvents, issueLinks, issues, projectPortals, projects, type Db } from "@radar/db";
import { AGENTS, CYCLE_DAYS, parseRepo, type Agent } from "@radar/shared";
import { sendTelegramText } from "@radar/scoring";

/**
 * Faza 11: sprintovi (cycles), Inbox (triage), predaja taska AI agentu (Claude/Codex preko GitHub-a)
 * i portal za klijenta (javni link samo za pregled + slanje zahteva).
 */
interface Guards {
  readGuard: MiddlewareHandler;
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
}
type Actor = { id: string | null; name: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const DAY = 86_400_000;
const OPEN = ["triage", "backlog", "todo", "in_progress", "in_review"] as const;

// ── Sprintovi: uvek postoje tekući + 2 sledeća; nedovršeno iz završenih prelazi u tekući ──
let ensuredAt = 0;
export async function ensureCycles(db: Db, force = false) {
  if (!force && Date.now() - ensuredAt < 5 * 60_000) return;
  ensuredAt = Date.now();
  const now = new Date();
  const all = await db.select().from(cycles).orderBy(asc(cycles.number));
  let last = all[all.length - 1];
  if (!last) {
    // Prvi sprint počinje ovog ponedeljka (UTC)
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    [last] = await db.insert(cycles).values({ number: 1, startsAt: start, endsAt: new Date(start.getTime() + CYCLE_DAYS * DAY) }).returning();
  }
  // Dopuni do tekućeg + 2 unapred
  while (last!.endsAt.getTime() < now.getTime() + 2 * CYCLE_DAYS * DAY) {
    const startsAt = last!.endsAt;
    [last] = await db
      .insert(cycles)
      .values({ number: last!.number + 1, startsAt, endsAt: new Date(startsAt.getTime() + CYCLE_DAYS * DAY) })
      .onConflictDoNothing()
      .returning();
    if (!last) return; // drugi proces je već napravio
  }
  const [current] = await db.select().from(cycles).where(and(lt(cycles.startsAt, now), gte(cycles.endsAt, now))).limit(1);
  if (!current) return;
  const ended = await db.select({ id: cycles.id }).from(cycles).where(lt(cycles.endsAt, now));
  if (!ended.length) return;
  const moved = await db
    .update(issues)
    .set({ cycleId: current.id, updatedAt: new Date() })
    .where(and(inArray(issues.cycleId, ended.map((c) => c.id)), inArray(issues.status, [...OPEN])))
    .returning({ id: issues.id });
  if (moved.length) await db.insert(issueEvents).values(moved.map((m) => ({ issueId: m.id, type: "cycle", data: { to: current.number, rollover: true }, actor: "Scoutline" })));
}

// ── GitHub (za predaju agentu) ──
async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) throw new Error("GitHub isn't connected: add GITHUB_TOKEN on the server (with access to this repo).");
  const res = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "scoutline",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`GitHub: ${data.message ?? `HTTP ${res.status}`}${res.status === 404 || res.status === 403 ? " — check that GITHUB_TOKEN has access to this repo (Issues: read & write)." : ""}`);
  return data;
}

/** „Context pack“: kratak, jasan brief za agenta — manje tokena, bolji rezultat. */
function contextPack(i: typeof issues.$inferSelect, key: string, p: typeof projects.$inferSelect, agent: Agent) {
  const desc = (i.description ?? "").trim();
  const done = desc.match(/(?:done when|acceptance|gotovo kada)[:\s]*\n([\s\S]+)/i)?.[1]?.trim();
  return [
    `> Task **${key}** from Scoutline · project **${p.name}**${i.priority ? ` · priority ${["", "urgent", "high", "medium", "low"][i.priority]}` : ""}${i.estimate ? ` · ${i.estimate} pt` : ""}`,
    "",
    "## Goal",
    desc ? desc.replace(/(?:done when|acceptance|gotovo kada)[:\s]*\n[\s\S]+/i, "").trim() || i.title : i.title,
    "",
    "## Done when",
    done ?? "- The change does what the goal says and nothing more.\n- Typecheck, tests and build pass.",
    "",
    ...(p.description ? ["## Project context", p.description.slice(0, 800), ""] : []),
    ...(i.labels.length ? [`Labels: ${i.labels.join(", ")}`, ""] : []),
    "## Rules",
    "- Read AGENTS.md / CLAUDE.md first; touch only the files this task needs.",
    `- Start the pull request title with \`${key}\` so Scoutline links it and moves the task to Done on merge.`,
    "",
    agent === "claude" ? "@claude please implement this and open a pull request." : "@codex please implement this and open a pull request.",
  ].join("\n");
}

export function deliveryPlusRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };
  const member = g.require("member");

  // ── Sprintovi ──
  app.get("/cycles", g.readGuard, async (c) => {
    const db = getDb();
    await ensureCycles(db);
    const now = Date.now();
    const rows = await db.select().from(cycles).orderBy(desc(cycles.number)).limit(12);
    const stats = await db
      .select({
        cycleId: issues.cycleId,
        scope: sql<number>`count(*) filter (where ${issues.status} <> 'canceled')::int`,
        done: sql<number>`count(*) filter (where ${issues.status} = 'done')::int`,
        started: sql<number>`count(*) filter (where ${issues.status} in ('in_progress','in_review'))::int`,
        points: sql<number>`coalesce(sum(${issues.estimate}) filter (where ${issues.status} <> 'canceled'),0)::int`,
        pointsDone: sql<number>`coalesce(sum(${issues.estimate}) filter (where ${issues.status} = 'done'),0)::int`,
      })
      .from(issues)
      .where(inArray(issues.cycleId, rows.map((r) => r.id)))
      .groupBy(issues.cycleId);
    const current = rows.find((r) => r.startsAt.getTime() <= now && r.endsAt.getTime() > now);
    // Burn-up za tekući sprint: koliko je završeno do svakog dana
    let burn: Array<{ day: string; done: number }> = [];
    if (current) {
      const doneRows = await db.select({ at: issues.completedAt }).from(issues).where(and(eq(issues.cycleId, current.id), eq(issues.status, "done"), isNotNull(issues.completedAt)));
      for (let t = current.startsAt.getTime(); t < current.endsAt.getTime(); t += DAY) {
        const end = t + DAY;
        burn.push({ day: new Date(t).toISOString().slice(0, 10), done: doneRows.filter((r) => r.at!.getTime() < end).length });
        if (t > now) burn[burn.length - 1]!.done = -1; // budući dani
      }
    }
    return c.json({
      cycles: rows.map((r) => ({
        ...r,
        state: r.endsAt.getTime() <= now ? "past" : r.startsAt.getTime() > now ? "upcoming" : "current",
        ...(stats.find((s) => s.cycleId === r.id) ?? { scope: 0, done: 0, started: 0, points: 0, pointsDone: 0 }),
        cycleId: undefined,
      })),
      burn,
    });
  });

  // ── Inbox ──
  app.get("/inbox/count", g.readGuard, async (c) => {
    const [row] = await getDb().select({ n: count() }).from(issues).where(eq(issues.status, "triage"));
    return c.json({ count: row?.n ?? 0 });
  });

  // ── GitHub veze taska ──
  app.get("/issues/:id/links", g.readGuard, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ links: [] });
    const links = await getDb().select().from(issueLinks).where(eq(issueLinks.issueId, id)).orderBy(desc(issueLinks.updatedAt));
    return c.json({ links });
  });

  // POST /delivery/issues/:id/agent { agent: "claude" | "codex" } — GitHub issue sa briefom i @pominjanjem
  app.post("/issues/:id/agent", member, async (c) => {
    const id = c.req.param("id")!;
    const agent = ((await c.req.json().catch(() => ({}))) as { agent?: string }).agent as Agent;
    if (!isUuid(id) || !AGENTS.includes(agent)) return c.json({ error: "Pick Claude or Codex." }, 400);
    const db = getDb();
    const [row] = await db.select({ i: issues, p: projects }).from(issues).innerJoin(projects, eq(issues.projectId, projects.id)).where(eq(issues.id, id)).limit(1);
    if (!row) return c.json({ error: "Issue not found." }, 404);
    const { i, p } = row;
    const repo = parseRepo(p.repoUrl);
    if (!repo) return c.json({ error: "Add the project's GitHub repo first (Edit project → GitHub repo)." }, 400);
    const key = `${p.key}-${i.number}`;
    const full = `${repo.owner}/${repo.repo}`;
    const body = contextPack(i, key, p, agent);
    try {
      const [existing] = await db.select().from(issueLinks).where(and(eq(issueLinks.issueId, id), eq(issueLinks.kind, "gh_issue"), eq(issueLinks.repo, full))).limit(1);
      let url: string;
      if (existing) {
        // Već postoji GitHub issue → samo novi komentar sa pominjanjem agenta
        await gh(`/repos/${full}/issues/${existing.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
        url = existing.url;
      } else {
        const created = await gh<{ number: number; html_url: string; title: string }>(`/repos/${full}/issues`, { method: "POST", body: JSON.stringify({ title: `[${key}] ${i.title}`, body }) });
        url = created.html_url;
        await db.insert(issueLinks).values({ issueId: id, kind: "gh_issue", repo: full, number: created.number, url, title: created.title, state: "open" }).onConflictDoNothing();
      }
      const status = i.status === "done" || i.status === "canceled" ? i.status : "in_progress";
      await db.update(issues).set({ agent, status, updatedAt: new Date() }).where(eq(issues.id, id));
      await db.insert(issueEvents).values({ issueId: id, type: "agent", data: { agent, url }, actor: actor(c).name });
      return c.json({ ok: true, url });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // ── Portal za klijenta (upravljanje) ──
  app.get("/projects/:id/portals", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ portals: [] });
    const rows = await getDb()
      .select({ id: projectPortals.id, label: projectPortals.label, allowRequests: projectPortals.allowRequests, lastViewedAt: projectPortals.lastViewedAt, createdAt: projectPortals.createdAt })
      .from(projectPortals)
      .where(and(eq(projectPortals.projectId, id), isNull(projectPortals.revokedAt)))
      .orderBy(desc(projectPortals.createdAt));
    return c.json({ portals: rows });
  });
  app.post("/projects/:id/portals", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Project not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { label?: unknown; allowRequests?: unknown };
    const db = getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const token = randomBytes(24).toString("base64url");
    const [row] = await db
      .insert(projectPortals)
      .values({ projectId: id, tokenHash: sha256(token), label: str(b.label, 80) ?? "Client portal", allowRequests: b.allowRequests !== false, createdBy: actor(c).id })
      .returning({ id: projectPortals.id });
    // Token se vraća samo jednom (u bazi je samo heš)
    return c.json({ id: row!.id, token }, 201);
  });
  app.delete("/portals/:id", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Not found." }, 404);
    await getDb().update(projectPortals).set({ revokedAt: new Date() }).where(eq(projectPortals.id, id));
    return c.json({ ok: true });
  });

  return app;
}

// ── Javni portal (bez prijave) ──
const requestHits = new Map<string, number[]>();
export function portalRoutes(getDb: () => Db) {
  const app = new Hono();
  const find = async (token: string) => {
    if (!token || token.length > 100) return null;
    const [row] = await getDb()
      .select({ portal: projectPortals, p: projects, customerName: customers.name })
      .from(projectPortals)
      .innerJoin(projects, eq(projectPortals.projectId, projects.id))
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .where(and(eq(projectPortals.tokenHash, sha256(token)), isNull(projectPortals.revokedAt)))
      .limit(1);
    return row ?? null;
  };

  app.get("/:token", async (c) => {
    const found = await find(c.req.param("token")!);
    if (!found) return c.json({ error: "This link is invalid or was revoked." }, 404);
    const { portal, p, customerName } = found;
    const db = getDb();
    await db.update(projectPortals).set({ lastViewedAt: new Date() }).where(eq(projectPortals.id, portal.id));
    // Interni taskovi (oznaka „internal“) se ne prikazuju klijentu
    const all = (await db.select().from(issues).where(eq(issues.projectId, p.id)).orderBy(asc(issues.priority), asc(issues.sortOrder))).filter((i) => !i.labels.includes("internal"));
    const total = all.filter((i) => i.status !== "canceled" && i.status !== "triage").length;
    const done = all.filter((i) => i.status === "done");
    const pick = (i: typeof issues.$inferSelect) => ({ key: `${p.key}-${i.number}`, title: i.title, status: i.status, completedAt: i.completedAt, dueDate: i.dueDate });
    const prio = (i: typeof issues.$inferSelect) => (i.priority === 0 ? 5 : i.priority);
    return c.json({
      label: portal.label,
      allowRequests: portal.allowRequests,
      project: { name: p.name, key: p.key, status: p.status, dueDate: p.dueDate, startDate: p.startDate ?? p.createdAt, customerName },
      progress: total ? Math.round((done.length / total) * 100) : 0,
      counts: { total, done: done.length, inProgress: all.filter((i) => i.status === "in_progress" || i.status === "in_review").length },
      doneThisWeek: done.filter((i) => i.completedAt && Date.now() - i.completedAt.getTime() < 7 * DAY).map(pick),
      inProgress: all.filter((i) => i.status === "in_progress" || i.status === "in_review").map(pick),
      upNext: all.filter((i) => i.status === "todo").sort((a, b) => prio(a) - prio(b)).slice(0, 10).map(pick),
      requests: all.filter((i) => (i.createdBy ?? "").startsWith("Client")).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10).map(pick),
    });
  });

  // POST /portal/:token/requests { name, email, title, details, website (zamka za botove) }
  app.post("/:token/requests", async (c) => {
    const token = c.req.param("token")!;
    const found = await find(token);
    if (!found) return c.json({ error: "This link is invalid or was revoked." }, 404);
    if (!found.portal.allowRequests) return c.json({ error: "Requests are turned off for this portal." }, 403);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (str(b.website, 200)) return c.json({ ok: true }); // bot popunio skriveno polje
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const k = `${found.portal.id}:${ip}`;
    const hits = (requestHits.get(k) ?? []).filter((t) => Date.now() - t < 3_600_000);
    if (hits.length >= 5) return c.json({ error: "Too many requests — please try again in an hour." }, 429);
    requestHits.set(k, [...hits, Date.now()]);
    const title = str(b.title, 200);
    if (!title) return c.json({ error: "Please add a short title." }, 400);
    const name = str(b.name, 80) ?? "Client";
    const email = str(b.email, 200);
    const details = str(b.details, 6000);
    const db = getDb();
    const { p } = found;
    const [seq] = await db.update(projects).set({ issueSeq: sql`${projects.issueSeq} + 1`, updatedAt: new Date() }).where(eq(projects.id, p.id)).returning({ n: projects.issueSeq });
    const [row] = await db
      .insert(issues)
      .values({
        projectId: p.id,
        number: seq!.n,
        title,
        description: [details ?? "", "", `— Requested by ${name}${email ? ` <${email}>` : ""} via the client portal`].join("\n").trim(),
        status: "triage",
        createdBy: `Client: ${name}`,
        labels: ["client"],
      })
      .returning({ id: issues.id, number: issues.number });
    await db.insert(issueEvents).values({ issueId: row!.id, type: "created", data: { via: "portal" }, actor: `Client: ${name}` });
    void sendTelegramText(`📥 <b>New client request</b> · ${p.key}-${row!.number}\n${title.replace(/[<>&]/g, "")}\n\nFrom ${name.replace(/[<>&]/g, "")} — open Delivery → Inbox`);
    return c.json({ ok: true, key: `${p.key}-${row!.number}` }, 201);
  });

  return app;
}

/** Tekući sprint (za brzo „Add to current cycle“). */
export async function currentCycleId(db: Db): Promise<string | null> {
  await ensureCycles(db);
  const now = new Date();
  const [c] = await db.select({ id: cycles.id }).from(cycles).where(and(lt(cycles.startsAt, now), gte(cycles.endsAt, now))).limit(1);
  return c?.id ?? null;
}


import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { customers, issueEvents, issues, leadEvents, leads, projects, rawItems, timeEntries, users, type Db } from "@radar/db";
import { ISSUE_STATUSES, PROJECT_STATUSES, projectKey, type IssueStatus, type ProjectStatus } from "@radar/shared";
import { currentCycleId } from "./delivery-plus.js";
import { pushIssue, userGithubToken } from "@radar/db";
import { runtime } from "./runtime.js";

/**
 * Delivery (Faza 10): klijenti, projekti i taskovi (issues) — kao Linear.
 * Čitanje: readGuard (kao leadovi). Izmene: član tima (member) ili vlasnik.
 */
interface Guards {
  readGuard: MiddlewareHandler;
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
}
type Actor = { id: string | null; name: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown, lo: number, hi: number) => (v === null || v === "" || v === undefined ? null : Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : null);
const date = (v: unknown) => {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const labelsOf = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 8) : null;

export function deliveryRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };
  /** Faza 14: izmena taska → GitHub (samo projekti sa dvosmernim sync-om). Greška ne prekida rad u aplikaciji. */
  const syncOut = async (c: Context, issueId: string) => {
    try {
      const db = getDb();
      const token = (await userGithubToken(db, actor(c).id)) ?? (await runtime(db)).githubToken;
      if (token) await pushIssue(db, token, issueId);
    } catch (e) {
      console.warn(`[github sync] ${(e as Error).message}`);
    }
  };
  const member = g.require("member");

  // ── Tim (za dodelu taskova) ──
  app.get("/members", g.readGuard, async (c) => {
    const rows = await getDb().select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).orderBy(asc(users.name));
    return c.json({ members: rows.filter((u) => u.role !== "viewer") });
  });

  // ── Klijenti ──
  app.get("/customers", g.readGuard, async (c) => {
    const db = getDb();
    const rows = await db.select().from(customers).orderBy(asc(customers.name));
    const stats = await db
      .select({
        customerId: projects.customerId,
        projects: count(),
        active: sql<number>`count(*) filter (where ${projects.status} = 'active')::int`,
        value: sql<number>`coalesce(sum(${projects.budgetEur}),0)::float`,
      })
      .from(projects)
      .groupBy(projects.customerId);
    const by = new Map(stats.map((s) => [s.customerId, s]));
    return c.json({ customers: rows.map((r) => ({ ...r, projects: by.get(r.id)?.projects ?? 0, activeProjects: by.get(r.id)?.active ?? 0, valueEur: by.get(r.id)?.value ?? 0 })) });
  });

  const customerFields = (b: Record<string, unknown>) => ({
    ...(b.name !== undefined && { name: str(b.name, 120) ?? "Untitled client" }),
    ...(b.website !== undefined && { website: str(b.website, 300) }),
    ...(b.country !== undefined && { country: str(b.country, 2)?.toUpperCase() ?? null }),
    ...(b.contactName !== undefined && { contactName: str(b.contactName, 120) }),
    ...(b.contactEmail !== undefined && { contactEmail: str(b.contactEmail, 200) }),
    ...(b.notes !== undefined && { notes: str(b.notes, 4000) }),
  });

  app.post("/customers", member, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!str(b.name, 120)) return c.json({ error: "Client name is required." }, 400);
    const [row] = await getDb().insert(customers).values({ name: str(b.name, 120)!, ...customerFields(b) }).returning();
    return c.json({ customer: row }, 201);
  });

  app.patch("/customers/:id", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Client not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [row] = await getDb().update(customers).set({ ...customerFields(b), updatedAt: new Date() }).where(eq(customers.id, id)).returning();
    return row ? c.json({ customer: row }) : c.json({ error: "Client not found." }, 404);
  });

  // ── Projekti ──
  const projectList = async (where?: ReturnType<typeof eq>) => {
    const db = getDb();
    const rows = await db
      .select({ p: projects, customerName: customers.name, ownerName: users.name })
      .from(projects)
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .leftJoin(users, eq(projects.ownerId, users.id))
      .where(where)
      .orderBy(desc(projects.updatedAt));
    if (!rows.length) return [];
    const counts = await db
      .select({ projectId: issues.projectId, status: issues.status, n: count() })
      .from(issues)
      .where(inArray(issues.projectId, rows.map((r) => r.p.id)))
      .groupBy(issues.projectId, issues.status);
    return rows.map(({ p, customerName, ownerName }) => {
      const mine = counts.filter((x) => x.projectId === p.id);
      const n = (s: IssueStatus) => mine.find((x) => x.status === s)?.n ?? 0;
      const total = mine.filter((x) => x.status !== "canceled" && x.status !== "triage").reduce((a, x) => a + x.n, 0);
      return {
        ...p,
        issueSeq: undefined,
        customerName,
        ownerName,
        issues: { total, done: n("done"), inProgress: n("in_progress") + n("in_review"), todo: n("todo") + n("backlog") },
        progress: total ? Math.round((n("done") / total) * 100) : 0,
      };
    });
  };

  app.get("/projects", g.readGuard, async (c) => c.json({ projects: await projectList() }));

  app.get("/projects/:id", g.readGuard, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Project not found." }, 404);
    const [p] = await projectList(eq(projects.id, id));
    return p ? c.json({ project: p }) : c.json({ error: "Project not found." }, 404);
  });

  /** Jedinstven ključ: ACME, pa ACME2, ACME3… */
  const freeKey = async (name: string, wanted?: string | null) => {
    const base = (wanted?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || projectKey(name)) as string;
    const taken = new Set((await getDb().select({ key: projects.key }).from(projects).where(ilike(projects.key, `${base}%`))).map((r) => r.key));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  };

  const projectFields = (b: Record<string, unknown>) => {
    const f: Partial<typeof projects.$inferInsert> = {};
    if (b.name !== undefined) f.name = str(b.name, 120) ?? "Untitled project";
    if (b.description !== undefined) f.description = str(b.description, 20_000);
    if (b.customerId !== undefined) f.customerId = isUuid(b.customerId) ? b.customerId : null;
    if (b.status !== undefined && PROJECT_STATUSES.includes(b.status as ProjectStatus)) f.status = b.status as ProjectStatus;
    if (b.budgetEur !== undefined) f.budgetEur = int(b.budgetEur, 0, 100_000_000);
    if (b.startDate !== undefined && date(b.startDate) !== undefined) f.startDate = date(b.startDate)!;
    if (b.dueDate !== undefined && date(b.dueDate) !== undefined) f.dueDate = date(b.dueDate)!;
    if (b.ownerId !== undefined) f.ownerId = isUuid(b.ownerId) ? b.ownerId : null;
    if (b.repoUrl !== undefined) f.repoUrl = str(b.repoUrl, 300);
    if (b.githubImport !== undefined) f.githubImport = b.githubImport === true;
    if (b.githubSync !== undefined) f.githubSync = b.githubSync === true;
    if (b.billing === "fixed" || b.billing === "hourly") f.billing = b.billing;
    if (b.hourlyRateEur !== undefined) f.hourlyRateEur = int(b.hourlyRateEur, 0, 10_000);
    return f;
  };

  app.post("/projects", member, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = str(b.name, 120);
    if (!name) return c.json({ error: "Project name is required." }, 400);
    const db = getDb();
    let customerId = isUuid(b.customerId) ? b.customerId : null;
    const newCustomer = str(b.customerName, 120);
    if (!customerId && newCustomer) [{ id: customerId }] = (await db.insert(customers).values({ name: newCustomer }).returning({ id: customers.id })) as [{ id: string }];
    const [row] = await db
      .insert(projects)
      .values({ ...projectFields(b), name, key: await freeKey(name, str(b.key, 6)), customerId, ownerId: isUuid(b.ownerId) ? b.ownerId : actor(c).id })
      .returning();
    const [p] = await projectList(eq(projects.id, row!.id));
    return c.json({ project: p }, 201);
  });

  app.patch("/projects/:id", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Project not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const [row] = await getDb().update(projects).set({ ...projectFields(b), updatedAt: new Date() }).where(eq(projects.id, id)).returning({ id: projects.id });
    if (!row) return c.json({ error: "Project not found." }, 404);
    const [p] = await projectList(eq(projects.id, id));
    return c.json({ project: p });
  });

  // DELETE /delivery/projects/:id — samo vlasnik (taskovi, vreme i linkovi se brišu zajedno sa projektom)
  app.delete("/projects/:id", g.require("owner"), async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Project not found." }, 404);
    const [row] = await getDb().delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
    return row ? c.json({ ok: true }) : c.json({ error: "Project not found." }, 404);
  });

  // POST /delivery/sample — primer projekta za probu / demo: klijent, projekat u toku, taskovi u svim fazama,
  // procene, rokovi, logovano vreme, komentari i jedan zahtev klijenta u Inboxu. Sve je označeno kao primer.
  app.post("/sample", member, async (c) => {
    const db = getDb();
    const me = actor(c);
    const day = 86_400_000;
    const now = Date.now();
    const [cust] = await db
      .insert(customers)
      .values({ name: "Salon Lux (sample)", contactName: "Ana Petrović", contactEmail: "ana@salonlux.example", country: "RS", website: "https://salonlux.example", notes: "Sample client — safe to edit or delete." })
      .returning({ id: customers.id });
    const name = "Salon Lux website (sample)";
    const [proj] = await db
      .insert(projects)
      .values({
        name,
        key: await freeKey("Salon Lux", "LUX"),
        customerId: cust!.id,
        status: "active",
        billing: "fixed",
        budgetEur: 1500,
        startDate: new Date(now - 6 * day),
        dueDate: new Date(now + 15 * day),
        ownerId: me.id,
        description: "Sample project to try Delivery.\n\nGoal: a simple website for a hair salon — home page, online booking, gallery, contact with map.\nDone = live on the client's domain, booking requests arrive by email.",
      })
      .returning({ id: projects.id });
    const cycle = await currentCycleId(db);
    type S = { title: string; status: IssueStatus; priority: number; estimate?: number; due?: number; labels?: string[]; mine?: boolean; cycle?: boolean; minutes?: number[]; comment?: string; description?: string };
    const plan: S[] = [
      { title: "Kickoff call and content list", status: "done", priority: 3, estimate: 1, minutes: [60], comment: "Client sends photos and price list by Friday." },
      { title: "Sitemap and wireframes", status: "done", priority: 2, estimate: 2, minutes: [150, 90], labels: ["design"] },
      { title: "Home page design", status: "done", priority: 2, estimate: 3, minutes: [240], labels: ["design"], comment: "Approved by the client 🎉" },
      { title: "Booking form (date, service, phone)", status: "in_review", priority: 1, estimate: 5, due: 3, mine: true, cycle: true, minutes: [180, 120], labels: ["feature"], description: "Form sends the request to the salon's email. Required: name, phone, service, preferred date." },
      { title: "Gallery page with lightbox", status: "in_progress", priority: 3, estimate: 3, due: 5, mine: true, cycle: true, minutes: [90], labels: ["feature"] },
      { title: "Bug: menu doesn't close on mobile", status: "in_progress", priority: 2, estimate: 1, due: -1, cycle: true, labels: ["bug"], comment: "Happens on iPhone Safari after tapping a link." },
      { title: "Contact page with map", status: "todo", priority: 3, estimate: 2, due: 8, cycle: true },
      { title: "SEO basics (titles, sitemap, Google Business)", status: "todo", priority: 4, estimate: 2, due: 12 },
      { title: "Price list page", status: "backlog", priority: 0, estimate: 2 },
    ];
    let n = 0;
    for (const [idx, it] of plan.entries()) {
      n++;
      const created = new Date(now - (6 - Math.min(idx, 5)) * day);
      const [row] = await db
        .insert(issues)
        .values({
          projectId: proj!.id,
          number: n,
          title: it.title,
          description: it.description ?? null,
          status: it.status,
          priority: it.priority,
          estimate: it.estimate ?? null,
          labels: it.labels ?? [],
          dueDate: it.due !== undefined ? new Date(now + it.due * day) : null,
          assigneeId: it.mine || it.status === "done" ? me.id : null,
          cycleId: it.cycle ? cycle : null,
          sortOrder: idx,
          createdBy: me.name,
          createdAt: created,
          completedAt: it.status === "done" ? new Date(created.getTime() + day) : null,
        })
        .returning({ id: issues.id });
      await db.insert(issueEvents).values({ issueId: row!.id, type: "created", actor: me.name, createdAt: created });
      if (it.status !== "todo" && it.status !== "backlog") await db.insert(issueEvents).values({ issueId: row!.id, type: "status", data: { from: "todo", to: it.status }, actor: me.name, createdAt: new Date(created.getTime() + day / 2) });
      if (it.comment) await db.insert(issueEvents).values({ issueId: row!.id, type: "comment", data: { text: it.comment }, actor: me.name, createdAt: new Date(created.getTime() + day * 0.8) });
      for (const [k, m] of (it.minutes ?? []).entries())
        await db.insert(timeEntries).values({ projectId: proj!.id, issueId: row!.id, userId: me.id, userName: me.name, minutes: m, spentOn: new Date(created.getTime() + (k + 1) * day * 0.6), note: k ? "Follow-up" : "Work", billable: true });
    }
    // Zahtev klijenta čeka u Inboxu
    n++;
    await db.insert(issues).values({
      projectId: proj!.id,
      number: n,
      title: "Can we add an Instagram feed on the home page?",
      description: "— Requested by Ana Petrović via the client portal",
      status: "triage",
      priority: 0,
      labels: ["client"],
      createdBy: "Client: Ana Petrović",
      sortOrder: 0,
    });
    await db.update(projects).set({ issueSeq: n, updatedAt: new Date() }).where(eq(projects.id, proj!.id));
    const [p] = await projectList(eq(projects.id, proj!.id));
    return c.json({ project: p }, 201);
  });

  // POST /delivery/from-lead/:leadId — dobijen posao: klijent + projekat iz leada (lead → Won)
  app.post("/from-lead/:leadId", member, async (c) => {
    const leadId = c.req.param("leadId")!;
    if (!isUuid(leadId)) return c.json({ error: "Lead not found." }, 404);
    const db = getDb();
    const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.leadId, leadId)).limit(1);
    if (existing) {
      const [p] = await projectList(eq(projects.id, existing.id));
      return c.json({ project: p, existing: true });
    }
    const [row] = await db.select({ lead: leads, raw: rawItems }).from(leads).innerJoin(rawItems, eq(leads.rawItemId, rawItems.id)).where(eq(leads.id, leadId)).limit(1);
    if (!row) return c.json({ error: "Lead not found." }, 404);
    const { lead, raw } = row;
    const realName = raw.companyName?.trim() && !/^unknown/i.test(raw.companyName.trim()) ? raw.companyName.trim() : null;
    const companyName = realName ?? `New client · ${raw.title.slice(0, 40)}`;
    // Isti klijent već postoji (isti naziv) → novi projekat ide njemu; nepoznati klijenti se ne spajaju
    const [known] = realName ? await db.select({ id: customers.id }).from(customers).where(ilike(customers.name, realName)).limit(1) : [];
    const customerId =
      known?.id ??
      (await db
        .insert(customers)
        .values({ name: companyName, country: lead.country, leadId, website: null, notes: raw.url.startsWith("http") ? `From lead: ${raw.url}` : null })
        .returning({ id: customers.id }))[0]!.id;
    const name = raw.title.slice(0, 120);
    const description = [
      raw.url.startsWith("http") ? `Source: ${raw.url}` : "",
      lead.why?.length ? `Why we won it / fit:\n${lead.why.map((w) => `- ${w}`).join("\n")}` : "",
      (raw.body ?? "").slice(0, 3000),
    ]
      .filter(Boolean)
      .join("\n\n");
    const [created] = await db
      .insert(projects)
      .values({ name, key: await freeKey(realName ?? name), description, customerId, leadId, status: "planned", budgetEur: lead.budgetEur, ownerId: actor(c).id })
      .returning({ id: projects.id });
    if (lead.status !== "won") {
      await db.update(leads).set({ status: "won", updatedAt: new Date() }).where(eq(leads.id, leadId));
      await db.insert(leadEvents).values({ leadId, type: "status_changed", data: { from: lead.status, to: "won" }, actor: actor(c).name });
    }
    await db.insert(leadEvents).values({ leadId, type: "note", data: { text: `Project created in Delivery.` }, actor: actor(c).name });
    const [p] = await projectList(eq(projects.id, created!.id));
    return c.json({ project: p }, 201);
  });

  // ── Taskovi (issues) ──
  const issueSelect = () =>
    getDb()
      .select({ i: issues, projectKey: projects.key, projectName: projects.name, assigneeName: users.name })
      .from(issues)
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .leftJoin(users, eq(issues.assigneeId, users.id));
  type IssueRow = Awaited<ReturnType<ReturnType<typeof issueSelect>["where"]>>[number];
  const toUiIssue = ({ i, projectKey: pk, projectName, assigneeName }: IssueRow) => ({ ...i, key: `${pk}-${i.number}`, projectKey: pk, projectName, assigneeName });
  const oneIssue = async (id: string) => (await issueSelect().where(eq(issues.id, id)).limit(1)).map(toUiIssue)[0];

  // GET /delivery/issues?projectId=&assignee=me|none|<id>&scope=open|all
  app.get("/issues", g.readGuard, async (c) => {
    const q = c.req.query();
    const conds = [];
    if (isUuid(q.projectId)) conds.push(eq(issues.projectId, q.projectId));
    if (q.assignee === "me") {
      const me = actor(c).id;
      if (!me) return c.json({ issues: [] });
      conds.push(eq(issues.assigneeId, me));
    } else if (q.assignee === "none") conds.push(isNull(issues.assigneeId));
    else if (isUuid(q.assignee)) conds.push(eq(issues.assigneeId, q.assignee));
    if (q.scope === "open") conds.push(and(ne(issues.status, "done"), ne(issues.status, "canceled"), ne(issues.status, "triage"))!);
    if (ISSUE_STATUSES.includes(q.status as IssueStatus)) conds.push(eq(issues.status, q.status as IssueStatus));
    if (q.cycle === "current") {
      const cur = await currentCycleId(getDb());
      if (!cur) return c.json({ issues: [] });
      conds.push(eq(issues.cycleId, cur));
    } else if (isUuid(q.cycle)) conds.push(eq(issues.cycleId, q.cycle));
    const rows = await issueSelect()
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(issues.sortOrder), desc(issues.createdAt))
      .limit(2000);
    return c.json({ issues: rows.map(toUiIssue) });
  });

  app.post("/issues", member, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = str(b.title, 300);
    if (!title) return c.json({ error: "Title is required." }, 400);
    if (!isUuid(b.projectId)) return c.json({ error: "Pick a project." }, 400);
    const db = getDb();
    // Sledeći broj taska u projektu (atomski)
    const [seq] = await db.update(projects).set({ issueSeq: sql`${projects.issueSeq} + 1`, updatedAt: new Date() }).where(eq(projects.id, b.projectId)).returning({ n: projects.issueSeq });
    if (!seq) return c.json({ error: "Project not found." }, 404);
    const status = ISSUE_STATUSES.includes(b.status as IssueStatus) ? (b.status as IssueStatus) : "todo";
    // Novi task ide na vrh kolone
    const [top] = await db.select({ min: sql<number>`coalesce(min(${issues.sortOrder}), 0)::float` }).from(issues).where(and(eq(issues.projectId, b.projectId), eq(issues.status, status)));
    const [row] = await db
      .insert(issues)
      .values({
        projectId: b.projectId,
        number: seq.n,
        title,
        description: str(b.description, 20_000),
        status,
        priority: int(b.priority, 0, 4) ?? 0,
        assigneeId: isUuid(b.assigneeId) ? b.assigneeId : null,
        estimate: int(b.estimate, 0, 100),
        labels: labelsOf(b.labels) ?? [],
        dueDate: date(b.dueDate) ?? null,
        sortOrder: (top?.min ?? 0) - 1,
        cycleId: b.cycleId === "current" ? await currentCycleId(db) : isUuid(b.cycleId) ? b.cycleId : null,
        createdBy: actor(c).name,
        completedAt: status === "done" ? new Date() : null,
      })
      .returning({ id: issues.id });
    await db.insert(issueEvents).values({ issueId: row!.id, type: "created", actor: actor(c).name });
    await syncOut(c, row!.id);
    return c.json({ issue: await oneIssue(row!.id) }, 201);
  });

  app.patch("/issues/:id", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Task not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = getDb();
    const [cur] = await db.select().from(issues).where(eq(issues.id, id)).limit(1);
    if (!cur) return c.json({ error: "Task not found." }, 404);
    const f: Partial<typeof issues.$inferInsert> = {};
    if (b.title !== undefined && str(b.title, 300)) f.title = str(b.title, 300)!;
    if (b.description !== undefined) f.description = str(b.description, 20_000);
    if (b.status !== undefined && ISSUE_STATUSES.includes(b.status as IssueStatus)) {
      f.status = b.status as IssueStatus;
      f.completedAt = f.status === "done" ? (cur.completedAt ?? new Date()) : null;
    }
    if (b.priority !== undefined) f.priority = int(b.priority, 0, 4) ?? 0;
    if (b.assigneeId !== undefined) f.assigneeId = isUuid(b.assigneeId) ? b.assigneeId : null;
    if (b.estimate !== undefined) f.estimate = int(b.estimate, 0, 100);
    if (b.labels !== undefined) f.labels = labelsOf(b.labels) ?? [];
    if (b.dueDate !== undefined && date(b.dueDate) !== undefined) f.dueDate = date(b.dueDate)!;
    if (b.sortOrder !== undefined && Number.isFinite(Number(b.sortOrder))) f.sortOrder = Number(b.sortOrder);
    if (b.cycleId !== undefined) f.cycleId = b.cycleId === "current" ? await currentCycleId(db) : isUuid(b.cycleId) ? b.cycleId : null;
    await db.update(issues).set({ ...f, updatedAt: new Date() }).where(eq(issues.id, id));
    // Istorija: samo promene koje tim želi da vidi
    const who = actor(c).name;
    const log: Array<typeof issueEvents.$inferInsert> = [];
    for (const k of ["status", "priority", "assigneeId", "title", "estimate", "cycleId"] as const) {
      if (f[k] !== undefined && f[k] !== cur[k]) log.push({ issueId: id, type: k === "assigneeId" ? "assignee" : k === "cycleId" ? "cycle" : k, data: { from: cur[k], to: f[k] }, actor: who });
    }
    if (log.length) await db.insert(issueEvents).values(log);
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, cur.projectId));
    // Na GitHub idu samo polja koja GitHub poznaje (ne redosled/sprint)
    if (["title", "description", "status", "assigneeId", "labels"].some((k) => b[k] !== undefined)) await syncOut(c, id);
    return c.json({ issue: await oneIssue(id) });
  });

  app.delete("/issues/:id", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Task not found." }, 404);
    const db = getDb();
    // Projekat sa GitHub sync-om: brisanje = „Canceled“ (zatvori na GitHub-u kao „not planned“), da se ne vrati sa sledećim sync-om
    const [synced] = await db.select({ sync: projects.githubSync }).from(issues).innerJoin(projects, eq(issues.projectId, projects.id)).where(eq(issues.id, id)).limit(1);
    if (synced?.sync) {
      await db.update(issues).set({ status: "canceled", updatedAt: new Date() }).where(eq(issues.id, id));
      await db.insert(issueEvents).values({ issueId: id, type: "status", data: { to: "canceled", via: "delete (GitHub sync)" }, actor: actor(c).name });
      await syncOut(c, id);
      return c.json({ ok: true, canceled: true });
    }
    const [row] = await db.delete(issues).where(eq(issues.id, id)).returning({ id: issues.id });
    return row ? c.json({ ok: true }) : c.json({ error: "Task not found." }, 404);
  });

  app.get("/issues/:id/events", g.readGuard, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ events: [] });
    const db = getDb();
    const events = await db.select().from(issueEvents).where(eq(issueEvents.issueId, id)).orderBy(asc(issueEvents.createdAt)).limit(300);
    // Imena za promene dodele
    const ids = [...new Set(events.filter((e) => e.type === "assignee").flatMap((e) => Object.values((e.data ?? {}) as Record<string, unknown>)).filter(isUuid))];
    const names = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
    return c.json({ events, names: Object.fromEntries(names.map((n) => [n.id, n.name])) });
  });

  app.post("/issues/:id/comments", member, async (c) => {
    const id = c.req.param("id")!;
    if (!isUuid(id)) return c.json({ error: "Task not found." }, 404);
    const text = str(((await c.req.json().catch(() => ({}))) as { text?: unknown }).text, 8000);
    if (!text) return c.json({ error: "Comment can't be empty." }, 400);
    const db = getDb();
    const [exists] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, id)).limit(1);
    if (!exists) return c.json({ error: "Task not found." }, 404);
    const [event] = await db.insert(issueEvents).values({ issueId: id, type: "comment", data: { text }, actor: actor(c).name }).returning();
    await db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, id));
    return c.json({ event }, 201);
  });

  return app;
}

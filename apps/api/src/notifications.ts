import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { issueEvents, issues, leads, projects, rawItems, type Db } from "@radar/db";

/**
 * Zvonce u zaglavlju: šta je novo za tim i za mene (poslednjih 7 dana).
 * Bez posebne tabele — slaže se iz postojećih podataka; „pročitano“ pamti browser.
 */
type Actor = { id: string | null; name: string; role?: string; access?: string };
interface Note {
  id: string;
  kind: "lead" | "inbox" | "assigned" | "comment" | "github" | "done" | "followup";
  title: string;
  sub: string;
  at: string;
  href: string;
}

export function notificationRoutes(getDb: () => Db, readGuard: MiddlewareHandler) {
  const app = new Hono();
  const actor = (c: Context) => c.get("actor" as never) as Actor | undefined;

  app.get("/", readGuard, async (c) => {
    const db = getDb();
    const me = actor(c);
    const week = new Date(Date.now() - 7 * 86_400_000);
    const out: Note[] = [];
    // Svako vidi samo deo aplikacije kojem ima pristup (Settings → Team → Access)
    const limited = !!me?.id && me.role !== "owner" && !!me.access && me.access !== "all";
    const canSales = !limited || me!.access === "sales";
    const canDelivery = !limited || me!.access === "delivery";

    // Novi dobri leadovi (75+, poslednja 2 dana)
    const good = await db
      .select({ id: leads.id, score: leads.score, title: rawItems.title, type: leads.leadType, at: leads.createdAt })
      .from(leads)
      .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
      .where(and(gte(leads.score, 75), ne(leads.status, "hidden"), gte(leads.createdAt, new Date(Date.now() - 2 * 86_400_000)), ne(leads.leadType, "hiring_signal")))
      .orderBy(desc(leads.score))
      .limit(canSales ? 8 : 0);
    for (const l of good) out.push({ id: `lead:${l.id}`, kind: "lead", title: l.title, sub: `New ${l.type ?? "lead"} · score ${l.score}`, at: l.at.toISOString(), href: `#/?lead=${l.id}` });

    // Podsetnici „javi se ponovo“ koji su stigli
    const due = await db
      .select({ id: leads.id, title: rawItems.title, at: leads.followUpAt, status: leads.status })
      .from(leads)
      .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
      .where(and(isNotNull(leads.followUpAt), lte(leads.followUpAt, new Date()), notInArray(leads.status, ["hidden", "won", "lost"])))
      .orderBy(desc(leads.followUpAt))
      .limit(canSales ? 8 : 0);
    for (const l of due) out.push({ id: `follow:${l.id}`, kind: "followup", title: l.title, sub: `Follow up · ${l.status}`, at: l.at!.toISOString(), href: `#/?lead=${l.id}` });

    // Inbox (zahtevi klijenata / GitHub)
    const triage = await db
      .select({ id: issues.id, number: issues.number, title: issues.title, by: issues.createdBy, at: issues.createdAt, key: projects.key })
      .from(issues)
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .where(eq(issues.status, "triage"))
      .orderBy(desc(issues.createdAt))
      .limit(canDelivery ? 8 : 0);
    for (const i of triage) out.push({ id: `inbox:${i.id}`, kind: "inbox", title: i.title, sub: `${i.key}-${i.number} · request from ${i.by ?? "client"}`, at: i.at.toISOString(), href: "#/delivery/inbox" });

    // Događaji na taskovima: dodeljeno meni, komentari na mojim taskovima, PR-ovi i završeni taskovi
    const ev = await db
      .select({ id: issueEvents.id, type: issueEvents.type, data: issueEvents.data, actorName: issueEvents.actor, at: issueEvents.createdAt, issueId: issues.id, number: issues.number, title: issues.title, assigneeId: issues.assigneeId, projectId: issues.projectId, key: projects.key })
      .from(issueEvents)
      .innerJoin(issues, eq(issueEvents.issueId, issues.id))
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .where(and(gte(issueEvents.createdAt, week), inArray(issueEvents.type, ["assignee", "comment", "github", "status"])))
      .orderBy(desc(issueEvents.createdAt))
      .limit(canDelivery ? 200 : 0);
    for (const e of ev) {
      if (me?.name && e.actorName === me.name) continue; // sopstvene radnje ne javljamo
      const d = (e.data ?? {}) as { to?: unknown; state?: string; pr?: number };
      const key = `${e.key}-${e.number}`;
      const href = `#/delivery/projects/${e.projectId}`;
      if (e.type === "assignee" && me?.id && d.to === me.id) out.push({ id: `ev:${e.id}`, kind: "assigned", title: e.title, sub: `${key} · ${e.actorName ?? "Someone"} assigned it to you`, at: e.at.toISOString(), href });
      else if (e.type === "comment" && me?.id && e.assigneeId === me.id) out.push({ id: `ev:${e.id}`, kind: "comment", title: e.title, sub: `${key} · ${e.actorName ?? "Someone"} commented`, at: e.at.toISOString(), href });
      else if (e.type === "github" && (d.state === "merged" || d.state === "open")) out.push({ id: `ev:${e.id}`, kind: "github", title: e.title, sub: `${key} · PR #${d.pr} ${d.state === "merged" ? "merged" : "opened"}`, at: e.at.toISOString(), href });
      else if (e.type === "status" && d.to === "done" && me?.id && e.assigneeId !== me.id) out.push({ id: `ev:${e.id}`, kind: "done", title: e.title, sub: `${key} · done by ${e.actorName ?? "the team"}`, at: e.at.toISOString(), href });
    }

    out.sort((a, b) => b.at.localeCompare(a.at));
    // Isti događaj iz više sinhronizacija → prikaži jednom (najnoviji)
    const seen = new Set<string>();
    const unique = out.filter((n) => (seen.has(`${n.kind}|${n.title}|${n.sub}`) ? false : (seen.add(`${n.kind}|${n.title}|${n.sub}`), true)));
    const [inboxCount] = await db.select({ n: sql<number>`count(*)::int` }).from(issues).where(eq(issues.status, "triage"));
    return c.json({ items: unique.slice(0, 30), inbox: canDelivery ? (inboxCount?.n ?? 0) : 0 });
  });

  return app;
}

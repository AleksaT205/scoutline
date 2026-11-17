import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { customers, issues, leads, projects, rawItems, type Db } from "@radar/db";

/** ⌘K pretraga: taskovi (i po ključu PZS-12), projekti, klijenti i leadovi — svako vidi samo svoj deo aplikacije. */
type Actor = { id: string | null; role: string; access?: string | null };
export function searchRoutes(getDb: () => Db, readGuard: MiddlewareHandler) {
  const app = new Hono();
  app.get("/search", readGuard, async (c: Context) => {
    const q = (c.req.query("q") ?? "").trim().slice(0, 80);
    if (q.length < 2) return c.json({ tasks: [], projects: [], clients: [], leads: [] });
    const me = c.get("actor" as never) as Actor | undefined;
    const limited = !!me?.id && me.role !== "owner" && !!me.access && me.access !== "all";
    const canSales = !limited || me!.access === "sales";
    const canDelivery = !limited || me!.access === "delivery";
    const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const db = getDb();
    const key = /^([a-z][a-z0-9]{1,9})-(\d+)$/i.exec(q);
    const [taskRows, projectRows, clientRows, leadRows] = await Promise.all([
      canDelivery
        ? db
            .select({ id: issues.id, number: issues.number, title: issues.title, status: issues.status, projectId: projects.id, key: projects.key, project: projects.name })
            .from(issues)
            .innerJoin(projects, eq(issues.projectId, projects.id))
            .where(key ? and(sql`lower(${projects.key}) = ${key[1]!.toLowerCase()}`, eq(issues.number, Number(key[2]))) : or(ilike(issues.title, like), sql`(${projects.key} || '-' || ${issues.number}) ilike ${like}`))
            .orderBy(desc(issues.updatedAt))
            .limit(8)
        : [],
      canDelivery ? db.select({ id: projects.id, key: projects.key, name: projects.name, status: projects.status }).from(projects).where(or(ilike(projects.name, like), ilike(projects.key, like))).orderBy(desc(projects.updatedAt)).limit(5) : [],
      canDelivery ? db.select({ id: customers.id, name: customers.name }).from(customers).where(ilike(customers.name, like)).limit(4) : [],
      canSales
        ? db
            .select({ id: leads.id, title: rawItems.title, score: leads.score, status: leads.status, company: rawItems.companyName })
            .from(leads)
            .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
            .where(and(ne(leads.status, "hidden"), or(ilike(rawItems.title, like), ilike(rawItems.companyName, like))))
            .orderBy(desc(leads.score))
            .limit(5)
        : [],
    ]);
    return c.json({ tasks: taskRows, projects: projectRows, clients: clientRows, leads: leadRows });
  });
  return app;
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import { and, desc, gte, inArray, type SQL } from "drizzle-orm";
import { leads, type Db } from "@radar/db";

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

  // GET /leads?minScore=70&tiers=T1,T2&limit=50
  app.get("/leads", async (c) => {
    const minScore = Number(c.req.query("minScore") ?? 0);
    const tiers = c.req.query("tiers")?.split(",").filter(Boolean) as ("T1" | "T2" | "T3" | "DOMESTIC")[] | undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const where: SQL[] = [gte(leads.score, minScore)];
    if (tiers?.length) where.push(inArray(leads.tier, tiers));
    const rows = await getDb().select().from(leads).where(and(...where)).orderBy(desc(leads.score)).limit(limit);
    return c.json({ items: rows });
  });

  return app;
}

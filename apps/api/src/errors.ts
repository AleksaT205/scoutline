import { createHash } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { appErrors, type Db } from "@radar/db";
import { sendTelegramText } from "@radar/scoring";

/**
 * Praćenje grešaka (ugrađeno, bez spoljnog servisa):
 *  - web šalje greške na POST /errors (i bez prijave — greška može da se desi i na stranici za prijavu),
 *  - server beleži svoje (app.onError, unhandledRejection),
 *  - ista greška se broji (fingerprint), a nova (ili ponovo posle „Resolved“) stiže na Telegram — najviše jednom na sat.
 */
type Source = "web" | "api" | "worker";
const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : null);

/** Ista greška = isti izvor + poruka bez brojeva/id-jeva + prvo mesto u kodu. */
function fingerprint(source: Source, message: string, stack: string | null) {
  const norm = message.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>").replace(/\d+/g, "<n>").slice(0, 300);
  const frame = (stack ?? "").split("\n").find((l) => /at |@/.test(l) && !/node_modules|node:internal/.test(l))?.replace(/:\d+:\d+\)?$/, "").replace(/\?[^)\s]*/g, "").trim() ?? "";
  return createHash("sha256").update(`${source}|${norm}|${frame}`).digest("hex").slice(0, 32);
}

export async function recordError(db: Db, e: { source: Source; message: string; stack?: string | null; url?: string | null; userAgent?: string | null; userName?: string | null }) {
  const message = (e.message || "Unknown error").slice(0, 1000);
  const stack = e.stack ? e.stack.slice(0, 8000) : null;
  const fp = fingerprint(e.source, message, stack);
  const now = new Date();
  const [row] = await db
    .insert(appErrors)
    .values({ fingerprint: fp, source: e.source, message, stack, url: e.url?.slice(0, 500) ?? null, userAgent: e.userAgent?.slice(0, 300) ?? null, userName: e.userName?.slice(0, 120) ?? null })
    .onConflictDoUpdate({
      target: appErrors.fingerprint,
      set: { count: sql`${appErrors.count} + 1`, lastSeen: now, stack: sql`coalesce(excluded.stack, ${appErrors.stack})`, url: sql`coalesce(excluded.url, ${appErrors.url})`, userAgent: sql`coalesce(excluded.user_agent, ${appErrors.userAgent})`, userName: sql`coalesce(excluded.user_name, ${appErrors.userName})` },
    })
    .returning();
  if (!row) return;
  // Telegram: nova greška, ili se vratila posle „Resolved“ — najviše jednom na sat po grešci
  const fresh = row.count === 1 || row.resolved;
  const quiet = row.notifiedAt && now.getTime() - row.notifiedAt.getTime() < 60 * 60_000;
  if (row.resolved) await db.update(appErrors).set({ resolved: false }).where(eq(appErrors.id, row.id));
  if (fresh && !quiet) {
    const ok = await sendTelegramText(`⚠️ <b>New ${row.source} error</b>\n${esc(message.slice(0, 300))}${row.url ? `\n<i>${esc(row.url.slice(0, 200))}</i>` : ""}${row.userName ? `\nUser: ${esc(row.userName)}` : ""}\n\nScoutline → Settings → System`).catch(() => false);
    if (ok) await db.update(appErrors).set({ notifiedAt: now }).where(eq(appErrors.id, row.id));
  }
}

export function errorRoutes(getDb: () => Db, a: { require: (r: "owner" | "member" | "viewer") => MiddlewareHandler; actorFrom: (c: Context) => Promise<{ name: string } | null> }) {
  const app = new Hono();
  // Zaštita od zatrpavanja: najviše 30 prijava u minuti po adresi
  const hits = new Map<string, { n: number; until: number }>();
  app.post("/errors", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const h = hits.get(ip);
    if (h && h.until > Date.now()) {
      if (h.n >= 30) return c.json({ ok: false }, 429);
      h.n++;
    } else hits.set(ip, { n: 1, until: Date.now() + 60_000 });
    if (hits.size > 5000) hits.clear();
    const raw = await c.req.text().catch(() => "");
    if (raw.length > 20_000) return c.json({ ok: false }, 413);
    let b: Record<string, unknown> = {};
    try {
      b = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false }, 400);
    }
    const message = clip(b.message, 1000);
    if (!message) return c.json({ ok: false }, 400);
    const actor = await a.actorFrom(c).catch(() => null);
    await recordError(getDb(), { source: "web", message, stack: clip(b.stack, 8000), url: clip(b.url, 500), userAgent: c.req.header("user-agent") ?? null, userName: actor?.name ?? null }).catch(() => undefined);
    return c.json({ ok: true });
  });

  // Pregled za vlasnika (Settings → System)
  app.get("/system/errors", a.require("owner"), async (c) => {
    const show = c.req.query("show") === "resolved" ? true : false;
    const rows = await getDb().select().from(appErrors).where(eq(appErrors.resolved, show)).orderBy(desc(appErrors.lastSeen)).limit(100);
    const [open] = await getDb().select({ n: sql<number>`count(*)::int` }).from(appErrors).where(eq(appErrors.resolved, false));
    return c.json({ errors: rows, open: open?.n ?? 0 });
  });
  app.post("/system/errors/:id/resolve", a.require("owner"), async (c) => {
    const id = c.req.param("id")!;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Not found." }, 404);
    await getDb().update(appErrors).set({ resolved: true }).where(eq(appErrors.id, id));
    return c.json({ ok: true });
  });
  app.post("/system/errors/resolve-all", a.require("owner"), async (c) => {
    await getDb().update(appErrors).set({ resolved: true }).where(eq(appErrors.resolved, false));
    return c.json({ ok: true });
  });
  app.post("/system/errors/clear-resolved", a.require("owner"), async (c) => {
    await getDb().delete(appErrors).where(and(eq(appErrors.resolved, true)));
    return c.json({ ok: true });
  });
  return app;
}

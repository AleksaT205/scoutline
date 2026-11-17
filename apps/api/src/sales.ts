import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { leadEvents, leads, rawItems, settings, sources, type Db } from "@radar/db";
import { sendTelegramText } from "@radar/scoring";
import { callFree } from "./assistant.js";
import { loadOrganization } from "./workspace.js";

/**
 * Sales: AI nacrt odgovora (mejl / ponuda, srpski / engleski), podsetnici „javi se ponovo“ (Telegram + zvonce),
 * „Also on“ (isti oglas iz drugog izvora) i nedeljni izveštaj ponedeljkom na Telegram.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "https://scoutline-app.netlify.app";
const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
type Actor = { id: string | null; name: string };

export function salesRoutes(getDb: () => Db, a: { require: (r: "owner" | "member" | "viewer") => MiddlewareHandler }) {
  const app = new Hono();
  const actorName = (c: Context) => (c.get("actor" as never) as Actor | undefined)?.name ?? "team";

  // Podsetnik: { at: ISO | null }
  app.patch("/leads/:id/follow-up", a.require("member"), async (c) => {
    const id = c.req.param("id")!;
    if (!UUID.test(id)) return c.json({ error: "Lead not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { at?: string | null };
    const at = b.at ? new Date(b.at) : null;
    if (at && Number.isNaN(at.getTime())) return c.json({ error: "Pick a valid date." }, 400);
    const db = getDb();
    const [row] = await db.update(leads).set({ followUpAt: at, followUpNotifiedAt: null, updatedAt: new Date() }).where(eq(leads.id, id)).returning({ id: leads.id });
    if (!row) return c.json({ error: "Lead not found." }, 404);
    await db.insert(leadEvents).values({ leadId: id, type: "follow_up", data: { at: at?.toISOString() ?? null }, actor: actorName(c) });
    return c.json({ followUpAt: at?.toISOString() ?? null });
  });

  // Isti oglas iz drugih izvora („Also on“)
  app.get("/leads/:id/related", a.require("viewer"), async (c) => {
    const id = c.req.param("id")!;
    if (!UUID.test(id)) return c.json({ related: [] });
    const db = getDb();
    const [me] = await db.select({ key: rawItems.titleKey, dup: leads.duplicateOf }).from(leads).innerJoin(rawItems, eq(leads.rawItemId, rawItems.id)).where(eq(leads.id, id)).limit(1);
    if (!me?.key) return c.json({ related: [] });
    const rows = await db
      .select({ id: leads.id, source: sources.name, url: rawItems.url, title: rawItems.title })
      .from(leads)
      .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
      .innerJoin(sources, eq(rawItems.sourceId, sources.id))
      .where(and(eq(rawItems.titleKey, me.key), ne(leads.id, id), sql`(${leads.duplicateOf} = ${id} or ${leads.id} = ${me.dup ?? id} or ${leads.duplicateOf} = ${me.dup ?? id})`))
      .limit(6);
    return c.json({ related: rows.map((r) => ({ ...r, url: r.url.startsWith("http") ? r.url : null })) });
  });

  // AI nacrt odgovora: { kind: "email" | "proposal", lang: "sr" | "en" } → { subject, body }
  app.post("/leads/:id/draft", a.require("member"), async (c) => {
    const id = c.req.param("id")!;
    if (!UUID.test(id)) return c.json({ error: "Lead not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { kind?: string; lang?: string };
    const kind = b.kind === "proposal" ? "proposal" : "email";
    const lang = b.lang === "sr" ? "sr" : "en";
    const db = getDb();
    const [row] = await db.select({ lead: leads, raw: rawItems }).from(leads).innerJoin(rawItems, eq(leads.rawItemId, rawItems.id)).where(eq(leads.id, id)).limit(1);
    if (!row) return c.json({ error: "Lead not found." }, 404);
    const org = await loadOrganization(db);
    const { lead, raw } = row;
    const facts = [
      `Title: ${raw.title}`,
      raw.companyName ? `Organization: ${raw.companyName}` : "",
      lead.leadType ? `Type: ${lead.leadType}` : "",
      lead.country ? `Country: ${lead.country}` : "",
      lead.budgetEur ? `Budget: about €${lead.budgetEur}` : "",
      raw.deadline ? `Deadline: ${raw.deadline.toISOString().slice(0, 10)}` : "",
      lead.painPoint ? `Their need: ${lead.painPoint}` : "",
      lead.ourOffer ? `What we can offer: ${lead.ourOffer}` : "",
      raw.url?.startsWith("http") ? `Link: ${raw.url}` : "",
      `Description:\n${(raw.body ?? "").slice(0, 3500)}`,
    ]
      .filter(Boolean)
      .join("\n");
    const who = `${org.name || "our software agency"}${org.website ? ` (${org.website})` : ""} — a small software agency building web and mobile apps`;
    const system = [
      `You write outreach for ${who}.`,
      lang === "sr" ? "Write in Serbian (Latin script), natural business tone, no anglicisms where a Serbian word exists." : "Write in clear, natural English.",
      kind === "email"
        ? "Write a short first email (90–150 words): one sentence showing you understood their need, 2–3 concrete points how we'd do it, one relevant proof point if obvious, and a simple call to action (a 15-minute call). No buzzwords, no exaggerated claims, no placeholders except [Name] for the sender."
        : "Write a short proposal outline (200–350 words) with headings: Understanding, Approach (3–5 steps), Timeline, What we need from you, Next step. Concrete and realistic; no invented prices unless a budget is given.",
      "Never mention AI. Output exactly:\nSubject: <subject line>\n\n<body>",
    ].join("\n");
    try {
      const out = await callFree("smart", system, [{ role: "user", content: facts }], kind === "email" ? 600 : 1100);
      const m = /^\s*(?:Subject|Naslov|Tema)\s*:\s*(.+)\n+([\s\S]+)$/i.exec(out.text.trim());
      const subject = (m?.[1] ?? raw.title).replace(/\*+/g, "").trim().slice(0, 200);
      const body = (m?.[2] ?? out.text).trim().slice(0, 6000);
      await db.update(leads).set({ emailSubject: subject, emailBody: body, updatedAt: new Date() }).where(eq(leads.id, id));
      await db.insert(leadEvents).values({ leadId: id, type: "email_drafted", data: { kind, lang, model: out.model }, actor: actorName(c) });
      return c.json({ subject, body, model: out.model });
    } catch (e) {
      return c.json({ error: `The free AI models didn't answer right now — try again in a minute. (${(e as Error).message.slice(0, 120)})` }, 502);
    }
  });

  return app;
}

/** Podsetnici koji su stigli → Telegram (jednom po podsetniku). */
export async function remindFollowUps(db: Db) {
  const due = await db
    .select({ id: leads.id, title: rawItems.title, status: leads.status, at: leads.followUpAt })
    .from(leads)
    .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
    .where(and(isNotNull(leads.followUpAt), lte(leads.followUpAt, new Date()), isNull(leads.followUpNotifiedAt), ne(leads.status, "hidden")))
    .limit(20);
  for (const l of due) {
    const ok = await sendTelegramText(`⏰ <b>Follow up</b> (${l.status})\n${esc(l.title.slice(0, 200))}\n\n<a href="${esc(DASHBOARD_URL)}/#/pipeline">Open pipeline</a>`).catch(() => false);
    // I bez Telegrama: označi, a zvonce u aplikaciji ga i dalje prikazuje dok se ne pomeri
    await db.update(leads).set({ followUpNotifiedAt: new Date() }).where(eq(leads.id, l.id));
    void ok;
  }
}

/** Nedeljni izveštaj: ponedeljkom od 8h (Beograd), jednom nedeljno. */
export async function weeklyReport(db: Db, now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Belgrade" }));
  if (local.getDay() !== 1 || local.getHours() < 8) return false;
  const week = `${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}`;
  const [st] = await db.select().from(settings).where(eq(settings.key, "weekly_report")).limit(1);
  if ((st?.value as { week?: string } | undefined)?.week === week) return false;
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const top = await db
    .select({ title: rawItems.title, score: leads.score, type: leads.leadType, budget: leads.budgetEur })
    .from(leads)
    .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
    .where(and(gte(leads.createdAt, since), ne(leads.status, "hidden"), ne(leads.leadType, "hiring_signal")))
    .orderBy(desc(leads.score))
    .limit(5);
  const counts = await db.select({ status: leads.status, n: sql<number>`count(*)::int` }).from(leads).where(inArray(leads.status, ["contacted", "replied", "meeting", "won"])).groupBy(leads.status);
  const [fresh] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(gte(leads.createdAt, since), ne(leads.status, "hidden")));
  const upcoming = await db
    .select({ title: rawItems.title, at: leads.followUpAt })
    .from(leads)
    .innerJoin(rawItems, eq(leads.rawItemId, rawItems.id))
    .where(and(isNotNull(leads.followUpAt), lte(leads.followUpAt, new Date(now.getTime() + 7 * 86_400_000)), ne(leads.status, "hidden")))
    .orderBy(leads.followUpAt)
    .limit(5);
  const n = (s: string) => counts.find((x) => x.status === s)?.n ?? 0;
  const text = [
    "📊 <b>Scoutline — this week</b>",
    `${fresh?.n ?? 0} new leads · pipeline: ${n("contacted")} contacted, ${n("replied")} replied, ${n("meeting")} meetings, ${n("won")} won`,
    top.length ? `\n<b>Best new</b>\n${top.map((t) => `• ${t.score} — ${esc(t.title.slice(0, 90))}${t.budget ? ` (€${t.budget.toLocaleString("en")})` : ""}`).join("\n")}` : "",
    upcoming.length ? `\n<b>Follow-ups this week</b>\n${upcoming.map((u) => `• ${u.at!.toISOString().slice(5, 10)} — ${esc(u.title.slice(0, 80))}`).join("\n")}` : "",
    `\n<a href="${esc(DASHBOARD_URL)}">Open Scoutline</a>`,
  ]
    .filter(Boolean)
    .join("\n");
  const ok = await sendTelegramText(text).catch(() => false);
  if (ok) await db.insert(settings).values({ key: "weekly_report", value: { week } }).onConflictDoUpdate({ target: settings.key, set: { value: { week }, updatedAt: new Date() } });
  return ok;
}

export function startSalesJobs(getDb: () => Db) {
  const tick = () => {
    const db = getDb();
    void remindFollowUps(db).catch((e) => console.warn("[sales] follow-ups:", (e as Error).message));
    void weeklyReport(db).catch((e) => console.warn("[sales] weekly:", (e as Error).message));
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 10 * 60_000);
}

/**
 * Worker: periodično preuzima oglase sa izvora, ocenjuje ih i šalje dobre na Telegram.
 * Tok: izvor → novi oglasi → prefilter → lead → ocena (AI ili pravila) → Telegram.
 */
import { createDb, settings } from "@radar/db";
import { CONNECTORS } from "./connectors/sources.js";
import { aiConfigured } from "@radar/scoring";
import { telegramConfigured } from "@radar/scoring";
import { clearRunRequest, ingest, lastSuccess, notifyNew, purgeExpired, registerSources, scorePending, sourceControls } from "./pipeline/run.js";
import { githubConfigured, syncGithub } from "./pipeline/github.js";
import { refreshRuntime } from "./runtime.js";
import { maybeLearnRouterRules } from "./pipeline/router-learn.js";

const GITHUB_EVERY_MS = 5 * 60_000;
let githubAt = 0;

const TICK_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
const SCORE_BATCH = Number(process.env.SCORE_BATCH ?? 10);
const ENABLED = (process.env.SOURCES ?? CONNECTORS.map((c) => c.id).join(",")).split(",");

const db = createDb();
// Izvor bez podešavanja (npr. Email-in bez IMAP naloga, SAM.gov bez ključa) se ne pokreće.
// Podešavanja mogu da se promene u aplikaciji, pa se lista proverava na svaki krug.
await refreshRuntime(db);
const activeConnectors = () => CONNECTORS.filter((c) => ENABLED.includes(c.id) && (c.enabled?.() ?? true));
const connectors = activeConnectors();
const skipped = CONNECTORS.filter((c) => c.enabled && !c.enabled()).map((c) => c.id);
const registered = new Set(connectors.map((c) => c.id));
const lastRun = new Map<string, number>();
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await refreshRuntime(db);
    const now = activeConnectors();
    const fresh = now.filter((c) => !registered.has(c.id));
    if (fresh.length) {
      await registerSources(db, fresh);
      fresh.forEach((c) => registered.add(c.id));
      console.log(`[worker] uključeni izvori: ${fresh.map((c) => c.id).join(", ")}`);
    }
    const controls = await sourceControls(db);
    for (const c of now) {
      const ctl = controls.get(c.id);
      const last = lastRun.get(c.id) ?? 0;
      const manual = !!ctl?.runAt && ctl.runAt.getTime() > last; // „Run now“ radi i za pauziran izvor
      const due = (ctl?.enabled ?? true) && Date.now() - last >= (ctl?.interval ?? c.intervalMinutes) * 60_000;
      if (!due && !manual) continue;
      lastRun.set(c.id, Date.now());
      await ingest(db, c);
      if (manual) await clearRunRequest(db, c.id);
    }
    await scorePending(db, SCORE_BATCH);
    await notifyNew(db);
    await purgeExpired(db);
    // Delivery: PR-ovi → status taskova (na 5 min)
    if (githubConfigured() && Date.now() - githubAt >= GITHUB_EVERY_MS) {
      githubAt = Date.now();
      await syncGithub(db);
    }
    // AI Router: predlozi izmene pravila iz statistike (jednom dnevno, bez poziva modela)
    await maybeLearnRouterRules(db);
    // Otkucaj srca — API proverava da worker radi (monitoring)
    const beat = { at: new Date().toISOString(), ai: aiConfigured() };
    await db.insert(settings).values({ key: "worker_heartbeat", value: beat }).onConflictDoUpdate({ target: settings.key, set: { value: beat, updatedAt: new Date() } });
  } catch (e) {
    console.error("[worker] greška", e);
  } finally {
    busy = false;
  }
}

await registerSources(db, connectors);
for (const [id, at] of await lastSuccess(db)) lastRun.set(id, at);
console.log(
  `[worker] start · izvori: ${connectors.map((c) => c.id).join(", ")}${skipped.length ? ` (nije podešeno: ${skipped.join(", ")})` : ""} · AI: ${aiConfigured() ? "da" : "ne (pravila)"} · Telegram: ${telegramConfigured() ? "da" : "ne"} · GitHub: ${githubConfigured() ? "da" : "ne"}`,
);
await tick();
setInterval(() => void tick(), TICK_MS);

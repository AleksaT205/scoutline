/**
 * Worker: periodično preuzima oglase sa izvora, ocenjuje ih i šalje dobre na Telegram.
 * Tok: izvor → novi oglasi → prefilter → lead → ocena (AI ili pravila) → Telegram.
 */
import { createDb, settings } from "@radar/db";
import { CONNECTORS } from "./connectors/sources.js";
import { aiConfigured } from "@radar/scoring";
import { telegramConfigured } from "@radar/scoring";
import { ingest, notifyNew, registerSources, scorePending } from "./pipeline/run.js";

const TICK_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
const SCORE_BATCH = Number(process.env.SCORE_BATCH ?? 10);
const ENABLED = (process.env.SOURCES ?? CONNECTORS.map((c) => c.id).join(",")).split(",");

const db = createDb();
const connectors = CONNECTORS.filter((c) => ENABLED.includes(c.id));
const lastRun = new Map<string, number>();
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (const c of connectors) {
      const due = Date.now() - (lastRun.get(c.id) ?? 0) >= c.intervalMinutes * 60_000;
      if (!due) continue;
      lastRun.set(c.id, Date.now());
      await ingest(db, c);
    }
    await scorePending(db, SCORE_BATCH);
    await notifyNew(db);
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
console.log(
  `[worker] start · izvori: ${connectors.map((c) => c.id).join(", ")} · AI: ${aiConfigured() ? "da" : "ne (pravila)"} · Telegram: ${telegramConfigured() ? "da" : "ne"}`,
);
await tick();
setInterval(() => void tick(), TICK_MS);

/**
 * Worker: periodično pokreće konektore, ocenjuje i šalje obaveštenja.
 * Faza 0: samo kostur petlje. Konektori stižu u Fazi 1 (docs/PLAN.md §6).
 */
import { tierOf } from "@radar/shared";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);

async function tick() {
  // TODO Faza 1: for (const c of connectors) { fetch → dedup → prefilter → geo → AI ocena → Telegram }
  console.log(`[worker] tick ${new Date().toISOString()} (tier test: US=${tierOf("US")})`);
}

await tick();
setInterval(() => void tick().catch((e) => console.error("[worker] greška", e)), INTERVAL_MS);

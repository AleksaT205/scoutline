import { eq } from "drizzle-orm";
import { settings, sources, type Db } from "@radar/db";
import { sendTelegramText } from "@radar/scoring";

/**
 * Monitoring iznutra: API svakih 5 min proverava da li worker radi i da li izvori prolaze.
 * Kad nešto pukne — jedna poruka na Telegram; kad se popravi — poruka "ponovo radi".
 * (Ako padne ceo server, ovo ne može da javi — za to služi spoljni monitoring, vidi docs/PRODUCTION.md.)
 */
export interface Health {
  ok: boolean;
  db: boolean;
  worker: { ok: boolean; lastBeat: string | null; minutesAgo: number | null };
  sources: Array<{ id: string; name: string; ok: boolean; lastSuccessAt: string | null; lastError: string | null }>;
}

const WORKER_STALE_MIN = 10;

export async function checkHealth(db: Db): Promise<Health> {
  try {
    const [beat] = await db.select().from(settings).where(eq(settings.key, "worker_heartbeat")).limit(1);
    const at = (beat?.value as { at?: string } | undefined)?.at ?? null;
    const minutesAgo = at ? Math.round((Date.now() - Date.parse(at)) / 60_000) : null;
    const srcs = await db.select().from(sources);
    const list = srcs
      .filter((s) => s.kind !== "manual" && s.enabled)
      .map((s) => {
        // Izvor je "loš" ako ima grešku i nije uspeo duže od 3 svoja intervala
        const late = !s.lastSuccessAt || Date.now() - s.lastSuccessAt.getTime() > Math.max(3 * s.intervalMinutes, 180) * 60_000;
        return { id: s.id, name: s.name, ok: !(s.lastError && late), lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, lastError: s.lastError };
      });
    const workerOk = minutesAgo !== null && minutesAgo <= WORKER_STALE_MIN;
    return { ok: workerOk && list.every((s) => s.ok), db: true, worker: { ok: workerOk, lastBeat: at, minutesAgo }, sources: list };
  } catch {
    return { ok: false, db: false, worker: { ok: false, lastBeat: null, minutesAgo: null }, sources: [] };
  }
}

export function startWatchdog(getDb: () => Db) {
  const down = new Set<string>(); // šta je trenutno prijavljeno kao problem
  const tick = async () => {
    const h = await checkHealth(getDb());
    const problems = new Map<string, string>();
    if (!h.db) problems.set("db", "🔴 <b>Database unreachable</b> — the API can't read the database.");
    else if (!h.worker.ok)
      problems.set("worker", `🔴 <b>Worker stopped</b> — no activity for ${h.worker.minutesAgo ?? "?"} min. New leads aren't being collected.`);
    for (const s of h.sources) if (!s.ok) problems.set(`source:${s.id}`, `🟠 <b>${s.name}</b> is failing: ${(s.lastError ?? "").slice(0, 160)}`);

    for (const [key, text] of problems) if (!down.has(key) && (await sendTelegramText(`${text}\n\nScoutline monitoring`))) down.add(key);
    for (const key of [...down])
      if (!problems.has(key)) {
        const label = key === "db" ? "Database" : key === "worker" ? "Worker" : key.replace("source:", "Source ");
        if (await sendTelegramText(`✅ <b>${label}</b> is working again.\n\nScoutline monitoring`)) down.delete(key);
      }
  };
  // Prva provera posle 3 min (da worker stigne da se pokrene posle deploy-a), pa svakih 5 min
  setTimeout(() => {
    void tick();
    setInterval(() => void tick().catch(() => undefined), 5 * 60_000);
  }, 3 * 60_000);
}

import { loadIntegrations, type Db, type Effective } from "@radar/db";
import { setTelegramConfig } from "@radar/scoring";

/**
 * Trenutna podešavanja integracija u API procesu (Settings → Integrations, inače env).
 * Osvežava se na minut i odmah posle čuvanja u aplikaciji.
 */
let current: Effective | null = null;
let loadedAt = 0;

export async function refreshRuntime(db: Db): Promise<Effective> {
  current = await loadIntegrations(db);
  loadedAt = Date.now();
  setTelegramConfig({ token: current.telegramToken, chatId: current.telegramChatId });
  return current;
}

export async function runtime(db: Db): Promise<Effective> {
  if (!current || Date.now() - loadedAt > 60_000) await refreshRuntime(db);
  return current!;
}

import { loadIntegrations, type Db, type Effective } from "@radar/db";
import { setTelegramConfig } from "@radar/scoring";

/** Podešavanja integracija u workeru (Settings → Integrations, inače env) — osvežava se na svaki krug. */
const env = process.env;
export let rt: Effective = {
  githubToken: env.GITHUB_TOKEN ?? "",
  githubRepo: env.GITHUB_REPO ?? "",
  telegramToken: env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: env.TELEGRAM_CHAT_ID ?? "",
  imap: { host: env.IMAP_HOST ?? "", port: Number(env.IMAP_PORT ?? 993), secure: (env.IMAP_SECURE ?? "true") !== "false", user: env.IMAP_USER ?? "", pass: env.IMAP_PASSWORD ?? "", mailbox: env.IMAP_MAILBOX ?? "INBOX" },
  samKey: env.SAM_API_KEY ?? "",
  anthropicKey: "",
  source: { github: "none", telegram: "none", imap: "none", sam: "none", anthropic: "none" },
};

export async function refreshRuntime(db: Db) {
  try {
    rt = await loadIntegrations(db);
    setTelegramConfig({ token: rt.telegramToken, chatId: rt.telegramChatId });
  } catch (e) {
    console.warn(`[integrations] ${(e as Error).message}`);
  }
}

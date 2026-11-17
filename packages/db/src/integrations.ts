import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { settings, users } from "./schema.js";
import type { Db } from "./index.js";

/**
 * Integracije (ključevi i tokeni) koje se podešavaju iz aplikacije umesto u Coolify-ju.
 * Tajne se čuvaju šifrovano (AES-256-GCM). Ključ: SECRETS_KEY, inače izveden iz SESSION_SECRET / API_TOKEN.
 * Pravilo: vrednost iz aplikacije ima prednost; ako je nema, koristi se promenljiva sa servera (env).
 */
export interface Secret {
  enc: string; // v1:iv:tag:ciphertext (base64url)
  hint: string; // npr. „…a1b2“ — za prikaz
}

export interface WorkspaceIntegrations {
  github?: { token?: Secret; repo?: string };
  telegram?: { botToken?: Secret; chatId?: string };
  imap?: { host?: string; port?: number; secure?: boolean; user?: string; password?: Secret; mailbox?: string };
  sam?: { apiKey?: Secret };
  anthropic?: { apiKey?: Secret }; // Claude za AI asistenta (trošak ide firmi)
}

export interface UserIntegrations {
  githubToken?: Secret;
  githubLogin?: string;
  agent?: "claude" | "codex";
  anthropicKey?: Secret; // lični Claude ključ za AI asistenta (trošak ide toj osobi)
}

const key = () => createHash("sha256").update(process.env.SECRETS_KEY || `scoutline-secrets:${process.env.SESSION_SECRET || process.env.API_TOKEN || "dev"}`).digest();

export function encryptSecret(plain: string): Secret {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const b = (x: Buffer) => x.toString("base64url");
  return { enc: `v1:${b(iv)}:${b(c.getAuthTag())}:${b(ct)}`, hint: plain.length > 8 ? `…${plain.slice(-4)}` : "…" };
}

/** null kad tajna ne postoji ili ne može da se dešifruje (npr. promenjen API_TOKEN — treba je uneti ponovo). */
export function decryptSecret(s: Secret | undefined | null): string | null {
  if (!s?.enc) return null;
  try {
    const [v, iv, tag, ct] = s.enc.split(":");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function readWorkspaceIntegrations(db: Db): Promise<WorkspaceIntegrations> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "integrations")).limit(1);
  return (row?.value as WorkspaceIntegrations | undefined) ?? {};
}

export async function writeWorkspaceIntegrations(db: Db, value: WorkspaceIntegrations) {
  await db
    .insert(settings)
    .values({ key: "integrations", value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Stvarna podešavanja koja aplikacija koristi (aplikacija → env). */
export interface Effective {
  githubToken: string;
  githubRepo: string;
  telegramToken: string;
  telegramChatId: string;
  imap: { host: string; port: number; secure: boolean; user: string; pass: string; mailbox: string };
  samKey: string;
  anthropicKey: string;
  source: Record<"github" | "telegram" | "imap" | "sam" | "anthropic", "app" | "server" | "none">;
}

export async function loadIntegrations(db: Db): Promise<Effective> {
  const w = await readWorkspaceIntegrations(db).catch(() => ({}) as WorkspaceIntegrations);
  const env = process.env;
  const ghApp = decryptSecret(w.github?.token);
  const tgApp = decryptSecret(w.telegram?.botToken);
  const imapApp = decryptSecret(w.imap?.password);
  const samApp = decryptSecret(w.sam?.apiKey);
  const anthropicApp = decryptSecret(w.anthropic?.apiKey);
  const imapFromApp = Boolean(w.imap?.host && w.imap?.user && imapApp);
  const src = (app: boolean, server: boolean) => (app ? "app" : server ? "server" : "none") as "app" | "server" | "none";
  return {
    githubToken: ghApp ?? env.GITHUB_TOKEN ?? "",
    githubRepo: w.github?.repo || env.GITHUB_REPO || "",
    telegramToken: tgApp ?? env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatId: (tgApp ? w.telegram?.chatId : undefined) || env.TELEGRAM_CHAT_ID || "",
    imap: imapFromApp
      ? { host: w.imap!.host!, port: w.imap!.port ?? 993, secure: w.imap!.secure ?? true, user: w.imap!.user!, pass: imapApp!, mailbox: w.imap!.mailbox || "INBOX" }
      : { host: env.IMAP_HOST ?? "", port: Number(env.IMAP_PORT ?? 993), secure: (env.IMAP_SECURE ?? "true") !== "false", user: env.IMAP_USER ?? "", pass: env.IMAP_PASSWORD ?? "", mailbox: env.IMAP_MAILBOX ?? "INBOX" },
    samKey: samApp ?? env.SAM_API_KEY ?? "",
    anthropicKey: anthropicApp ?? env.ANTHROPIC_API_KEY ?? "",
    source: {
      github: src(!!ghApp, !!env.GITHUB_TOKEN),
      telegram: src(!!(tgApp && w.telegram?.chatId), !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)),
      imap: src(imapFromApp, !!(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASSWORD)),
      sam: src(!!samApp, !!env.SAM_API_KEY),
      anthropic: src(!!anthropicApp, !!env.ANTHROPIC_API_KEY),
    },
  };
}

export async function readUserIntegrations(db: Db, userId: string): Promise<UserIntegrations> {
  const [u] = await db.select({ integrations: users.integrations }).from(users).where(eq(users.id, userId)).limit(1);
  return (u?.integrations as UserIntegrations | null) ?? {};
}

/** Lični GitHub token korisnika (ako ga je povezao). */
export async function userGithubToken(db: Db, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  return decryptSecret((await readUserIntegrations(db, userId)).githubToken);
}

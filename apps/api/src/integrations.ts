import { Hono, type Context, type MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import {
  decryptSecret,
  encryptSecret,
  readUserIntegrations,
  readWorkspaceIntegrations,
  users,
  writeWorkspaceIntegrations,
  type Db,
  type Secret,
  type UserIntegrations,
  type WorkspaceIntegrations,
} from "@radar/db";
import { refreshRuntime, runtime } from "./runtime.js";

/**
 * Settings → Integrations: ključevi se podešavaju u aplikaciji, bez Coolify-ja i bez redeploy-a.
 * - Firma (samo vlasnik menja): GitHub, Telegram, Email-in (IMAP), SAM.gov.
 * - Lično (svaki korisnik): svoj GitHub token i podrazumevani AI agent.
 * Tajne se nikad ne vraćaju — samo „…a1b2“ i da li postoje.
 */
interface Guards {
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
}
type Actor = { id: string | null; name: string; role: string };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** undefined = ne menjaj · "" ili null = obriši · tekst = nova tajna */
function nextSecret(cur: Secret | undefined, v: unknown): Secret | undefined {
  if (v === undefined) return cur;
  if (v === null || (typeof v === "string" && !v.trim())) return undefined;
  return typeof v === "string" ? encryptSecret(v.trim().slice(0, 500)) : cur;
}
const view = (s: Secret | undefined) => (s ? { set: true, hint: s.hint, readable: decryptSecret(s) !== null } : { set: false });

async function githubWhoami(token: string, repo?: string) {
  const h = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "scoutline", "X-GitHub-Api-Version": "2022-11-28" };
  const me = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}/user`, { headers: h, signal: AbortSignal.timeout(10_000) });
  if (!me.ok) throw new Error(me.status === 401 ? "GitHub rejected this token (wrong or expired)." : `GitHub: HTTP ${me.status}`);
  const login = ((await me.json()) as { login?: string }).login ?? "?";
  if (repo) {
    const r = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repo}`, { headers: h, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`Signed in as ${login}, but the token can't see ${repo} — add this repo to the token's access.`);
  }
  return login;
}

export function integrationRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => c.get("actor" as never) as Actor;

  // ── Firma ──
  app.get("/", g.require("member"), async (c) => {
    const db = getDb();
    const w = await readWorkspaceIntegrations(db);
    const rt = await runtime(db);
    return c.json({
      canEdit: actor(c).role === "owner",
      github: { token: view(w.github?.token), repo: w.github?.repo ?? "", source: rt.source.github, effectiveRepo: rt.githubRepo },
      telegram: { botToken: view(w.telegram?.botToken), chatId: w.telegram?.chatId ?? "", source: rt.source.telegram },
      imap: { host: w.imap?.host ?? "", port: w.imap?.port ?? 993, user: w.imap?.user ?? "", mailbox: w.imap?.mailbox ?? "INBOX", password: view(w.imap?.password), source: rt.source.imap, effectiveUser: rt.imap.user },
      sam: { apiKey: view(w.sam?.apiKey), source: rt.source.sam },
    });
  });

  // PUT /integrations { github?: {token, repo}, telegram?: {botToken, chatId}, imap?: {...}, sam?: {apiKey} }
  app.put("/", g.require("owner"), async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, Record<string, unknown> | undefined>;
    const db = getDb();
    const w: WorkspaceIntegrations = await readWorkspaceIntegrations(db);
    if (b.github) w.github = { token: nextSecret(w.github?.token, b.github.token), repo: str(b.github.repo, 120) ?? w.github?.repo };
    if (b.telegram) w.telegram = { botToken: nextSecret(w.telegram?.botToken, b.telegram.botToken), chatId: str(b.telegram.chatId, 40) ?? w.telegram?.chatId };
    if (b.imap) {
      const port = Number(b.imap.port);
      w.imap = {
        host: str(b.imap.host, 120) ?? w.imap?.host,
        port: Number.isFinite(port) && port > 0 ? port : (w.imap?.port ?? 993),
        secure: true,
        user: str(b.imap.user, 200) ?? w.imap?.user,
        password: nextSecret(w.imap?.password, b.imap.password),
        mailbox: str(b.imap.mailbox, 80) || w.imap?.mailbox || "INBOX",
      };
    }
    if (b.sam) w.sam = { apiKey: nextSecret(w.sam?.apiKey, b.sam.apiKey) };
    await writeWorkspaceIntegrations(db, w);
    await refreshRuntime(db);
    return c.json({ ok: true });
  });

  // POST /integrations/test/:kind — proverava sačuvano podešavanje (ili poslate vrednosti pre čuvanja)
  app.post("/test/:kind", g.require("owner"), async (c) => {
    const kind = c.req.param("kind");
    const b = (await c.req.json().catch(() => ({}))) as Record<string, string | undefined>;
    const rt = await runtime(getDb());
    try {
      if (kind === "github") {
        const login = await githubWhoami(b.token?.trim() || rt.githubToken, b.repo?.trim() || rt.githubRepo || undefined);
        return c.json({ ok: true, message: `Connected as ${login}${rt.githubRepo || b.repo ? ` · repo ${b.repo?.trim() || rt.githubRepo} is reachable` : ""}.` });
      }
      if (kind === "telegram") {
        const token = b.botToken?.trim() || rt.telegramToken;
        const chatId = b.chatId?.trim() || rt.telegramChatId;
        if (!token || !chatId) return c.json({ ok: false, message: "Add the bot token and chat ID first." }, 400);
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "✅ Scoutline is connected to this chat." }),
          signal: AbortSignal.timeout(10_000),
        });
        const d = (await res.json().catch(() => ({}))) as { description?: string };
        return res.ok ? c.json({ ok: true, message: "Test message sent — check Telegram." }) : c.json({ ok: false, message: `Telegram: ${d.description ?? `HTTP ${res.status}`}` }, 400);
      }
      if (kind === "imap") {
        const cfg = { host: b.host?.trim() || rt.imap.host, port: Number(b.port) || rt.imap.port, user: b.user?.trim() || rt.imap.user, pass: b.password?.trim() || rt.imap.pass, mailbox: b.mailbox?.trim() || rt.imap.mailbox };
        if (!cfg.host || !cfg.user || !cfg.pass) return c.json({ ok: false, message: "Add host, email and app password first." }, 400);
        const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.port !== 143, auth: { user: cfg.user, pass: cfg.pass }, logger: false, socketTimeout: 20_000 });
        try {
          await client.connect();
          const st = await client.status(cfg.mailbox, { unseen: true, messages: true });
          if (!st) return c.json({ ok: false, message: `Connected, but folder “${cfg.mailbox}” wasn't found.` }, 400);
          return c.json({ ok: true, message: `Connected · ${st.messages ?? 0} emails in ${cfg.mailbox}, ${st.unseen ?? 0} unread.` });
        } finally {
          await client.logout().catch(() => undefined);
        }
      }
      return c.json({ ok: false, message: "Unknown integration." }, 400);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ ok: false, message: /auth|credentials|login/i.test(msg) ? "Wrong email or app password." : msg }, 400);
    }
  });

  // ── Lično ──
  app.get("/me", g.require("viewer"), async (c) => {
    const a = actor(c);
    if (!a.id) return c.json({ account: false });
    const u = await readUserIntegrations(getDb(), a.id);
    return c.json({ account: true, github: { ...view(u.githubToken), login: u.githubLogin ?? null }, agent: u.agent ?? "claude" });
  });

  // PUT /integrations/me { githubToken?: string | null, agent?: "claude" | "codex" }
  app.put("/me", g.require("viewer"), async (c) => {
    const a = actor(c);
    if (!a.id) return c.json({ error: "Sign in with your own account to connect personal integrations." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { githubToken?: string | null; agent?: string };
    const db = getDb();
    const u: UserIntegrations = await readUserIntegrations(db, a.id);
    if (b.githubToken !== undefined) {
      const tok = typeof b.githubToken === "string" ? b.githubToken.trim() : "";
      if (tok) {
        try {
          u.githubLogin = await githubWhoami(tok); // proveri pre čuvanja
        } catch (e) {
          return c.json({ error: (e as Error).message }, 400);
        }
        u.githubToken = encryptSecret(tok);
      } else {
        delete u.githubToken;
        delete u.githubLogin;
      }
    }
    if (b.agent === "claude" || b.agent === "codex") u.agent = b.agent;
    await db.update(users).set({ integrations: u, updatedAt: new Date() }).where(eq(users.id, a.id));
    return c.json({ ok: true, github: { ...view(u.githubToken), login: u.githubLogin ?? null }, agent: u.agent ?? "claude" });
  });

  return app;
}

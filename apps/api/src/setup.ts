import { Hono, type Context, type MiddlewareHandler } from "hono";
import { sql } from "drizzle-orm";
import { claudeCodeTokenFor, ghFetch, projects, userGithubToken, users, type Db } from "@radar/db";
import { autodeployMissing } from "./autodeploy.js";
import { callFree } from "./assistant.js";
import { checkHealth } from "./monitor.js";
import { runtime } from "./runtime.js";
import { loadOrganization } from "./workspace.js";

/**
 * Settings → Setup (vlasnik): jedna lista koja proverava šta je podešeno i šta fali, sa koracima za svaku stavku.
 * Ništa ne menja — samo čita stanje. Ključevi se upisuju u Settings → Integrations ili u Coolify (env).
 */
type State = "ok" | "warn" | "missing";
interface Item {
  key: string;
  group: "Basics" | "GitHub & Claude" | "AI & alerts" | "Server";
  title: string;
  state: State;
  detail: string;
  steps: string[]; // šta da se uradi (prazno kad je sve u redu)
  link?: string; // gde u aplikaciji
  required: boolean;
}
type Actor = { id: string | null; name: string };

export function setupRoutes(getDb: () => Db, a: { require: (r: "owner" | "member" | "viewer") => MiddlewareHandler }) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };

  app.get("/system/setup", a.require("owner"), async (c) => {
    const db = getDb();
    const rt = await runtime(db);
    const org = await loadOrganization(db);
    const [team] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
    const [withRepo] = await db.select({ n: sql<number>`count(*) filter (where ${projects.repoUrl} is not null)::int`, sites: sql<number>`count(*) filter (where ${projects.siteUrl} is not null)::int`, all: sql<number>`count(*)::int` }).from(projects);
    const health = await checkHealth(db);
    const items: Item[] = [];
    const add = (i: Item) => items.push(i);

    // ── Osnovno ──
    add({
      key: "org",
      group: "Basics",
      title: "Company details",
      state: org.name ? (org.invoiceDetails ? "ok" : "warn") : "missing",
      detail: org.name ? (org.invoiceDetails ? `${org.name} · invoice details filled in` : `${org.name} · invoice details are empty`) : "No company name yet",
      steps: org.name && org.invoiceDetails ? [] : ["Settings → Organization: fill in the name, logo, website and contact email.", "Add “Invoice details” (address, company ID, VAT number, bank account) — they're printed on invoices."],
      link: "#/settings?tab=organization",
      required: true,
    });
    add({
      key: "team",
      group: "Basics",
      title: "Team accounts",
      state: (team?.n ?? 0) > 0 ? "ok" : "missing",
      detail: (team?.n ?? 0) > 0 ? `${team!.n} account${team!.n === 1 ? "" : "s"}` : "No accounts yet — everyone is using the team password",
      steps: (team?.n ?? 0) > 0 ? [] : ["Settings → Team: create the owner account, then invite the team by link."],
      link: "#/settings?tab=team",
      required: true,
    });
    // Ključ za prijave i šifrovanje sačuvanih tokena: SESSION_SECRET, inače se izvodi iz API_TOKEN.
    // Naknadna promena bilo kog od njih čini sačuvane tokene nečitljivim — zato se ovde ne preporučuje izmena kad već radi.
    const hasSecret = !!process.env.SESSION_SECRET;
    const hasTeamPw = !!process.env.API_TOKEN;
    add({
      key: "secrets",
      group: "Basics",
      title: "Secret key on the server",
      state: hasSecret || hasTeamPw ? "ok" : "missing",
      detail: hasSecret
        ? "SESSION_SECRET is set — sign-ins and saved tokens are encrypted with it. Don't change it."
        : hasTeamPw
          ? "Derived from the team password (API_TOKEN). Works as is — don't change API_TOKEN or add SESSION_SECRET now, or saved tokens stop working and must be entered again."
          : "Neither SESSION_SECRET nor API_TOKEN is set — sign-ins and saved tokens use a default key",
      steps: hasSecret || hasTeamPw ? [] : ["Coolify → Environment Variables: add SESSION_SECRET with a long random value (e.g. from `openssl rand -hex 32`), then Redeploy.", "Do it before saving any tokens, and don't change it later — saved tokens are encrypted with it."],
      required: true,
    });

    // ── GitHub i Claude ──
    const myGh = await userGithubToken(db, actor(c).id);
    let ghWho: string | null = null;
    const tok = myGh ?? rt.githubToken;
    if (tok) {
      const r = await ghFetch(tok, "/user").catch(() => null);
      ghWho = r?.ok ? ((await r.json()) as { login?: string }).login ?? null : null;
    }
    add({
      key: "github",
      group: "GitHub & Claude",
      title: "GitHub token",
      state: tok ? (ghWho ? "ok" : "warn") : "missing",
      detail: !tok ? "No GitHub token" : ghWho ? `Connected as ${ghWho}${myGh ? " (your personal token)" : " (workspace token)"}` : "A token is saved, but GitHub rejected it (expired or revoked)",
      steps: tok && ghWho ? [] : ["GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.", "Repository access: your project repos (or All repositories).", "Permissions: Contents, Issues, Pull requests, Actions, Workflows, Secrets — Read and write.", "Paste it in Settings → Integrations → Your GitHub → Connect."],
      link: "#/settings?tab=integrations",
      required: true,
    });
    const cc = await claudeCodeTokenFor(db, actor(c).id);
    add({
      key: "claude",
      group: "GitHub & Claude",
      title: "Claude Code token",
      state: cc ? "ok" : "missing",
      detail: cc ? `Saved (${cc.owner === "personal" ? "your subscription" : cc.owner === "workspace" ? "workspace subscription" : "server env"})` : "Not saved — Build with Claude can't start",
      steps: cc ? [] : ["In a terminal run `claude setup-token` and sign in with your Claude Pro/Max account.", "Paste the token in Settings → Integrations → Your Claude Code token → Save."],
      link: "#/settings?tab=integrations",
      required: true,
    });
    add({
      key: "repos",
      group: "GitHub & Claude",
      title: "Projects linked to GitHub",
      state: (withRepo?.all ?? 0) === 0 ? "warn" : (withRepo?.n ?? 0) > 0 ? "ok" : "warn",
      detail: (withRepo?.all ?? 0) === 0 ? "No projects yet" : `${withRepo!.n} of ${withRepo!.all} projects have a repo`,
      steps: (withRepo?.n ?? 0) > 0 ? [] : ["Open a project → Code → Repos → paste the GitHub link.", "Click the “Claude” status there → Set up automatically (adds the workflow and the secret)."],
      link: "#/delivery",
      required: false,
    });

    // ── AI i obaveštenja ──
    let ai: { ok: boolean; note: string } = { ok: false, note: "LiteLLM isn't configured (LITELLM_URL / LITELLM_KEY)" };
    if (process.env.LITELLM_KEY) {
      const r = await fetch(`${process.env.LITELLM_URL ?? "http://localhost:4000"}/v1/models`, { headers: { Authorization: `Bearer ${process.env.LITELLM_KEY}` }, signal: AbortSignal.timeout(6000) }).catch(() => null);
      if (r?.ok) {
        const groups = [...new Set((((await r.json().catch(() => ({}))) as { data?: Array<{ id: string }> }).data ?? []).map((m) => m.id))];
        ai = { ok: groups.length > 0, note: groups.length ? `LiteLLM is up · model groups: ${groups.join(", ")}` : "LiteLLM is up but has no models" };
      } else ai = { ok: false, note: "LiteLLM doesn't answer — check the litellm container in Coolify" };
    }
    add({
      key: "ai",
      group: "AI & alerts",
      title: "Free AI models (scoring, drafts, assistant)",
      state: ai.ok ? "ok" : "missing",
      detail: ai.note,
      steps: ai.ok ? ["Use “Test AI” to make sure the provider keys actually work."] : ["Get free keys: Google AI Studio (GEMINI_API_KEY), Groq (GROQ_API_KEY), OpenRouter (OPENROUTER_API_KEY).", "Coolify → Environment Variables: add them, then Redeploy.", "Come back here and click “Test AI”."],
      required: true,
    });
    add({
      key: "telegram",
      group: "AI & alerts",
      title: "Telegram alerts",
      state: rt.telegramToken && rt.telegramChatId ? "ok" : "missing",
      detail: rt.telegramToken && rt.telegramChatId ? `Connected (${rt.source.telegram === "app" ? "saved in the app" : "server env"})` : "Not connected — no lead alerts, reminders or outage messages",
      steps: rt.telegramToken && rt.telegramChatId ? [] : ["In Telegram open @BotFather → /newbot → copy the bot token.", "Send any message to your new bot, then open https://api.telegram.org/bot<TOKEN>/getUpdates and copy chat.id.", "Settings → Integrations → Telegram: paste both and Save, then “Send test”."],
      link: "#/settings?tab=integrations",
      required: true,
    });
    add({
      key: "email",
      group: "AI & alerts",
      title: "Email-in (Upwork, tenders and forwarded enquiries)",
      state: rt.imap.host && rt.imap.user ? "ok" : "warn",
      detail: rt.imap.host && rt.imap.user ? `Reading ${rt.imap.user}` : "Not connected — leads from email alerts aren't collected",
      steps: rt.imap.host && rt.imap.user ? [] : ["Create a mailbox for alerts (e.g. Gmail) and turn on an App password.", "Settings → Integrations → Email-in: host imap.gmail.com, the address and the App password.", "Subscribe that address to job alerts (Upwork, PeoplePerHour, Portal javnih nabavki…)."],
      link: "#/settings?tab=integrations",
      required: false,
    });

    // ── Server ──
    const badSources = health.sources.filter((s) => !s.ok);
    add({
      key: "worker",
      group: "Server",
      title: "Worker and lead sources",
      state: !health.worker.ok ? "missing" : badSources.length ? "warn" : "ok",
      detail: !health.worker.ok ? `Worker hasn't reported for ${health.worker.minutesAgo ?? "?"} min` : badSources.length ? `${badSources.length} source${badSources.length === 1 ? "" : "s"} failing: ${badSources.map((s) => s.name).slice(0, 3).join(", ")}` : `Worker is running · ${health.sources.length} sources healthy`,
      steps: !health.worker.ok ? ["Coolify → the worker container: check it's running and look at its logs, then Redeploy."] : badSources.length ? ["Sales → Sources: open the failing source to see the error."] : [],
      link: "#/sources",
      required: true,
    });
    const miss = autodeployMissing();
    add({
      key: "deploy",
      group: "Server",
      title: "Auto-deploy",
      state: miss.length ? "warn" : "ok",
      detail: miss.length ? "Off — after every push you click Redeploy in Coolify" : "On — the server redeploys itself when CI passes",
      steps: miss.length ? ["Coolify → Keys & Tokens → API tokens → create one with the “deploy” permission.", "Coolify → Environment Variables: COOLIFY_API_TOKEN, COOLIFY_API_URL (e.g. http://192.168.x.x:8000) and DEPLOY_REPO (owner/repo).", "Project settings in Coolify: turn on “Include Source Commit in Build”, then Redeploy once."] : [],
      link: "#/settings?tab=system",
      required: false,
    });
    add({
      key: "sites",
      group: "Server",
      title: "Client sites monitored",
      state: (withRepo?.sites ?? 0) > 0 ? "ok" : "warn",
      detail: (withRepo?.sites ?? 0) > 0 ? `${withRepo!.sites} site${withRepo!.sites === 1 ? "" : "s"} checked every 5 minutes` : "No site addresses yet",
      steps: (withRepo?.sites ?? 0) > 0 ? [] : ["Open a project → Edit → “Live site”: paste the client's site address."],
      link: "#/delivery",
      required: false,
    });

    const required = items.filter((i) => i.required);
    return c.json({ items, done: required.filter((i) => i.state === "ok").length, total: required.length });
  });

  // Proba besplatnih AI modela (stvarni poziv — pokazuje da ključevi rade)
  app.post("/system/setup/test-ai", a.require("owner"), async (c) => {
    try {
      const out = await callFree("fast", "Reply with one short word.", [{ role: "user", content: "Say: ready" }], 20);
      return c.json({ ok: true, model: out.model, text: out.text.slice(0, 60) });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message.slice(0, 300) });
    }
  });
  return app;
}

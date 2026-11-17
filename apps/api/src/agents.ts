import { createHash } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import sodium from "libsodium-wrappers";
import { asc } from "drizzle-orm";
import { branchName } from "@radar/shared";
import { issueEvents } from "@radar/db";
import { claudeCodeTokenFor, customers, ghFetch, issues as tasks, projectRepoNames, projects, userGithubToken, users, type Db } from "@radar/db";
import { runtime } from "./runtime.js";

/**
 * Faza 16 — Claude Code iz aplikacije (preko GitHub-a, na pretplati korisnika — bez API ključa):
 *  - povezivanje repoa jednim linkom + „Set up Claude“ (workflow fajl i secret CLAUDE_CODE_OAUTH_TOKEN),
 *  - „Build with Claude“: prompt → GitHub issue sa @claude → Claude radi u GitHub Actions → PR,
 *  - praćenje sesija (status, trajanje, PR) i odgovori Claude-u iz aplikacije,
 *  - potrošnja: broj sesija i minuti po osobi (pretplata nema cenu po pozivu).
 * Sesije se ne čuvaju u bazi — to su GitHub issue-i sa oznakom „scoutline“.
 */
interface Guards {
  readGuard: MiddlewareHandler;
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
}
type Actor = { id: string | null; name: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL = "scoutline";
const SECRET = "CLAUDE_CODE_OAUTH_TOKEN";
const WORKFLOW_PATH = ".github/workflows/claude.yml";
const MARKER = "# scoutline:claude-v5";
const MODELS = ["sonnet", "opus", "haiku"] as const;
const EFFORTS = ["low", "medium", "high", "max"] as const;
type Effort = (typeof EFFORTS)[number];
/** Koliko Claude razmišlja: Claude Code prepoznaje „think“ / „think hard“ / „ultrathink“ u zadatku. */
const EFFORT_WORD: Record<Effort, string> = { low: "", medium: "think", high: "think hard", max: "ultrathink" };
/** Auto: pitanje → malo, običan rad → srednje, redizajn / refaktor / arhitektura / dug zadatak → puno. */
export function autoEffort(text: string): Effort {
  const t = text.toLowerCase().trim();
  if (t.length > 700 || /\b(redesign|redizajn|refactor|refaktor|architecture|arhitektur|migrat|security|bezbednost|performance|performans|optimi[sz]|from scratch|od nule|premium|ceo sajt|whole app)/.test(t)) return "high";
  if (/\?\s*$/.test(t) || /^(what|how|where|why|which|who|is|are|can|kako|gde|šta|sta|zašto|zasto|koji|koja|dokle|da li|ima li)\b/.test(t)) return "low";
  return "medium";
}
/** Auto model po effort-u: običan rad i pitanja → Sonnet, veliki zadaci (High/Max) → Opus. */
const autoModel = (e: Effort): Model => (e === "high" || e === "max" ? "opus" : "sonnet");
const pickEffort = (v: unknown, text: string): Effort => (EFFORTS.includes(v as Effort) ? (v as Effort) : autoEffort(text));
const withEffort = (text: string, e: Effort) => (EFFORT_WORD[e] ? `${text}\n\n(${EFFORT_WORD[e]})` : text);
type Model = (typeof MODELS)[number];
export const APP_INSTALL_URL = "https://github.com/apps/claude/installations/new";

/**
 * Workflow koji Scoutline upisuje u repo. Claude sam otvara PR (gh pr create).
 * Nigde u git-u nema „Claude“: autor commit-a je vlasnik (bot_name/bot_id), grane su feature/…, bez co-author linija.
 */
export const claudeWorkflow = (author?: { login: string; id: number } | null) => `${MARKER}
# @claude u issue-u ili komentaru → Claude Code radi task i otvara pull request.
# Radi na Claude Pro/Max pretplati: secret CLAUDE_CODE_OAUTH_TOKEN (claude setup-token). Postavlja ga Scoutline.
name: Claude Code

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@claude')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
      actions: read
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1
      - uses: anthropics/claude-code-action@v1
        id: claude
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        with:
          claude_code_oauth_token: \${{ secrets.${SECRET} }}
          branch_prefix: "feature/"
${author ? `          bot_name: "${author.login}"\n          bot_id: "${author.id}"\n` : ""}          settings: |
            { "includeCoAuthoredBy": false }
          # Model bira Scoutline oznakom na issue-u / PR-u (model:opus, model:sonnet, model:haiku); bez oznake = podrazumevani
          claude_args: |
            --max-turns 40
            \${{ (contains(toJSON(github.event.issue.labels), '"model:opus"') || contains(toJSON(github.event.pull_request.labels), '"model:opus"')) && '--model opus' || ((contains(toJSON(github.event.issue.labels), '"model:haiku"') || contains(toJSON(github.event.pull_request.labels), '"model:haiku"')) && '--model haiku' || ((contains(toJSON(github.event.issue.labels), '"model:sonnet"') || contains(toJSON(github.event.pull_request.labels), '"model:sonnet"')) && '--model sonnet' || '')) }}
            --allowedTools "Bash(npm *),Bash(npx *),Bash(pnpm *),Bash(git *),Bash(gh pr create:*),Bash(gh pr view:*)"
      # Potrošnja za Scoutline (tokeni, koraci, trajanje, cena na API-ju) — samo brojevi, bez sadržaja
      - name: Scoutline usage
        if: always()
        continue-on-error: true
        env:
          F: \${{ steps.claude.outputs.execution_file }}
        run: |
          [ -f "$F" ] && node -e 'const a=[].concat(JSON.parse(require("fs").readFileSync(process.env.F,"utf8")));const r=a.reverse().find(m=>m&&m.type==="result")||{};const u=r.usage||{};console.log("SCOUTLINE_USAGE "+JSON.stringify({cost:r.total_cost_usd??null,turns:r.num_turns??null,ms:r.duration_ms??null,in:(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0),out:u.output_tokens||0}))' || true
`;

// Terminal iz Scoutline-a: komanda se izvršava u GitHub Actions (čista mašina, samo čitanje repoa, bez tajni)
const TERMINAL_PATH = ".github/workflows/scoutline-terminal.yml";
const TERMINAL_MARKER = "# scoutline:terminal-v1";
export const TERMINAL_WORKFLOW = `${TERMINAL_MARKER}
# Terminal iz Scoutline-a (Code → Terminal): komanda radi na čistoj GitHub mašini sa ovim repoom.
# Samo čitanje repoa i bez tajni — ne može da menja kod ni da vidi ključeve.
name: Scoutline terminal
run-name: terminal \${{ inputs.id }}
on:
  workflow_dispatch:
    inputs:
      command:
        description: Command to run
        required: true
      ref:
        description: Branch (empty = default)
        required: false
        default: ""
      id:
        description: Scoutline run id
        required: false
        default: ""
permissions:
  contents: read
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
        with:
          ref: \${{ inputs.ref || github.ref }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run command
        env:
          CMD: \${{ inputs.command }}
        run: bash -lc "$CMD"
`;

/** Izlaz komande iz GitHub log-a: bez vremena i bez koraka pripreme (checkout, node). */
const commandOutput = (log: string) => {
  const lines = log.split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""));
  const start = lines.findIndex((l) => /^##\[group\]Run bash -lc/.test(l));
  if (start < 0) return lines.slice(-200).join("\n");
  let i = start + 1;
  while (i < lines.length && !lines[i]!.startsWith("##[endgroup]")) i++;
  const out: string[] = [];
  for (i = i + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^##\[group\](Post |Run actions\/)|^Post job cleanup|^Cleaning up orphan/.test(l)) break;
    out.push(l.replace(/^##\[error\]/, "✕ "));
  }
  const text = out.join("\n").trim();
  return text.length > 60_000 ? `…\n${text.slice(-60_000)}` : text;
};

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  created_at: string;
  user: { login: string } | null;
  pull_request?: unknown;
}
interface GhPull {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  body: string | null;
  head: { ref: string };
  created_at: string;
}
interface GhRun {
  id: number;
  display_title: string;
  status: string;
  conclusion: string | null;
  run_started_at?: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}
interface GhComment {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  user: { login: string; type?: string } | null;
}

export function agentRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };
  const member = g.require("member");
  const ghToken = async (c: Context) => (await userGithubToken(getDb(), actor(c).id)) ?? (await runtime(getDb())).githubToken;

  /** GitHub poziv koji baca razumljivu grešku. */
  const gh = async <T>(tok: string, path: string, init?: RequestInit): Promise<T> => {
    const r = await ghFetch(tok, path, init);
    if (!r.ok) {
      const msg = ((await r.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${r.status}`;
      throw Object.assign(new Error(r.status === 404 ? `GitHub: not found (${path.split("?")[0]}) — check the repo and the token's access.` : `GitHub: ${msg}`), { status: r.status });
    }
    return (r.status === 204 ? null : await r.json()) as T;
  };

  /** Repo mora da pripada projektu. */
  const repoOf = async (c: Context) => {
    const id = c.req.param("id")!;
    if (!UUID.test(id)) return null;
    const [p] = await getDb().select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!p) return null;
    const names = await projectRepoNames(getDb(), p);
    const want = c.req.query("repo") ?? names[0];
    const full = names.find((n) => n.toLowerCase() === (want ?? "").toLowerCase());
    return full ? { p, full } : null;
  };

  /** Model za sledeći rad: oznaka model:* na issue-u ili PR-u (workflow je čita). */
  const setModel = async (tok: string, full: string, n: number, model: Model | null) => {
    const cur = await gh<Array<{ name: string }>>(tok, `/repos/${full}/issues/${n}/labels`).catch(() => [] as Array<{ name: string }>);
    const next = [...cur.map((l) => l.name).filter((l) => !l.startsWith("model:")), ...(model ? [`model:${model}`] : [])];
    await gh(tok, `/repos/${full}/issues/${n}/labels`, { method: "PUT", body: JSON.stringify({ labels: next }) });
  };

  /** Kontekst iz Scoutline-a za Claude-a: projekat i taskovi po statusu (Claude ih inače ne vidi — nisu u repou). */
  const projectContext = async (p: typeof projects.$inferSelect) => {
    const db = getDb();
    const [cust] = p.customerId ? await db.select({ name: customers.name }).from(customers).where(eq(customers.id, p.customerId)).limit(1) : [];
    const list = await db
      .select({ number: tasks.number, title: tasks.title, status: tasks.status, priority: tasks.priority, due: tasks.dueDate, who: users.name, labels: tasks.labels })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(eq(tasks.projectId, p.id))
      .orderBy(asc(tasks.sortOrder))
      .limit(80);
    const order = ["in_progress", "in_review", "todo", "backlog", "triage", "done"] as const;
    const names: Record<string, string> = { in_progress: "In progress", in_review: "In review", todo: "To do", backlog: "Backlog", triage: "Requests (not accepted yet)", done: "Done" };
    const prio = ["", "urgent", "high", "medium", "low"];
    const groups = order
      .map((st) => {
        const items = list.filter((t) => t.status === st);
        if (!items.length) return "";
        const rows = items.slice(0, st === "done" ? 10 : 25).map((t) => `- ${p.key}-${t.number} ${t.title}${t.who ? ` · ${t.who}` : ""}${t.priority ? ` · ${prio[t.priority]}` : ""}${t.due ? ` · due ${t.due.toISOString().slice(0, 10)}` : ""}${t.labels.length ? ` · [${t.labels.join(", ")}]` : ""}`);
        return `**${names[st]}** (${items.length})\n${rows.join("\n")}`;
      })
      .filter(Boolean);
    return [
      "<details><summary>Project context from Scoutline</summary>",
      "",
      `Project **${p.name}** (${p.key}) · status ${p.status}${cust?.name ? ` · client ${cust.name}` : ""}${p.dueDate ? ` · target ${p.dueDate.toISOString().slice(0, 10)}` : ""}${p.budgetEur ? ` · budget €${p.budgetEur}` : ""}`,
      p.description ? `\n${p.description.slice(0, 1500)}\n` : "",
      groups.length ? `Tasks in Scoutline (the team's plan — task keys like ${p.key}-1):\n\n${groups.join("\n\n")}` : "No tasks in Scoutline yet.",
      "",
      "</details>",
    ].join("\n");
  };

  /** Secret u repou (GitHub traži šifrovanje javnim ključem repoa — sealed box). */
  const setRepoSecret = async (tok: string, full: string, value: string) => {
    await sodium.ready;
    const pub = await gh<{ key: string; key_id: string }>(tok, `/repos/${full}/actions/secrets/public-key`);
    const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(pub.key, sodium.base64_variants.ORIGINAL));
    await gh(tok, `/repos/${full}/actions/secrets/${SECRET}`, { method: "PUT", body: JSON.stringify({ encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: pub.key_id }) });
  };

  const setupState = async (c: Context, tok: string, full: string) => {
    const out: {
      repo: string;
      access: boolean;
      canPush: boolean;
      defaultBranch: string | null;
      workflow: "missing" | "outdated" | "ok";
      terminal: "missing" | "outdated" | "ok";
      secret: boolean | null; // null = token nema dozvolu „Secrets“ pa ne znamo
      claudeToken: "personal" | "workspace" | "server" | null;
      appInstallUrl: string;
      error?: string;
    } = { repo: full, access: false, canPush: false, defaultBranch: null, workflow: "missing", terminal: "missing", secret: null, claudeToken: null, appInstallUrl: APP_INSTALL_URL };
    out.claudeToken = (await claudeCodeTokenFor(getDb(), actor(c).id))?.owner ?? null;
    try {
      const r = await gh<{ default_branch: string; permissions?: { push?: boolean } }>(tok, `/repos/${full}`);
      out.access = true;
      out.canPush = r.permissions?.push !== false;
      out.defaultBranch = r.default_branch;
    } catch (e) {
      out.error = (e as Error).message;
      return out;
    }
    const wf = await ghFetch(tok, `/repos/${full}/contents/${WORKFLOW_PATH}`, { headers: { Accept: "application/vnd.github.raw" } });
    if (wf.ok) out.workflow = (await wf.text()).includes(MARKER) ? "ok" : "outdated";
    const tw = await ghFetch(tok, `/repos/${full}/contents/${TERMINAL_PATH}`, { headers: { Accept: "application/vnd.github.raw" } });
    if (tw.ok) out.terminal = (await tw.text()).includes(TERMINAL_MARKER) ? "ok" : "outdated";
    const sec = await ghFetch(tok, `/repos/${full}/actions/secrets/${SECRET}`);
    out.secret = sec.status === 200 ? true : sec.status === 404 ? false : null;
    return out;
  };

  // ── Limit Claude plana (kao na claude.ai → Usage): trenutna sesija (5 h) i ova nedelja ──
  // Isti podatak koji Claude Code prikazuje komandom /usage, čita se tokenom osobe (lični → firme). Nije javni API:
  // ako Anthropic promeni odgovor ili token nema pristup, vraćamo „available: false“ i aplikacija samo sakrije trake.
  const planCache = new Map<string, { at: number; data: unknown }>();
  app.get("/claude/usage", g.readGuard, async (c) => {
    const cc = await claudeCodeTokenFor(getDb(), actor(c).id);
    if (!cc) return c.json({ available: false, reason: "no_token" });
    const key = createHash("sha256").update(cc.token).digest("hex").slice(0, 16);
    const hit = planCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return c.json(hit.data);
    try {
      const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: { Authorization: `Bearer ${cc.token}`, "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json", "User-Agent": "scoutline" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const data = { available: false, reason: r.status === 401 || r.status === 403 ? "token" : "unavailable", status: r.status };
        planCache.set(key, { at: Date.now(), data });
        return c.json(data);
      }
      type Window = { utilization?: number | null; resets_at?: string | null } | null | undefined;
      const d = (await r.json()) as { five_hour?: Window; seven_day?: Window; seven_day_opus?: Window };
      const win = (w: Window) => (w && typeof w.utilization === "number" ? { pct: Math.round(w.utilization), resetsAt: w.resets_at ?? null } : null);
      const data = { available: true, owner: cc.owner, session: win(d.five_hour), week: win(d.seven_day), opusWeek: win(d.seven_day_opus) };
      planCache.set(key, { at: Date.now(), data });
      return c.json(data);
    } catch {
      return c.json({ available: false, reason: "unavailable" });
    }
  });

  // ── Stanje podešavanja (checklist) ──
  app.get("/projects/:id/agent/setup", g.readGuard, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet — add yours in Settings → Integrations." }, 400);
    return c.json(await setupState(c, tok, r.full));
  });

  // ── „Set up Claude“: workflow fajl + secret (ako je Claude Code token sačuvan) ──
  app.post("/projects/:id/agent/setup", member, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet — add yours in Settings → Integrations." }, 400);
    const notes: string[] = [];
    try {
      const cur = await ghFetch(tok, `/repos/${r.full}/contents/${WORKFLOW_PATH}`);
      const sha = cur.ok ? ((await cur.json()) as { sha?: string }).sha : undefined;
      await gh(tok, `/repos/${r.full}/contents/${WORKFLOW_PATH}`, {
        method: "PUT",
        body: JSON.stringify({ message: "Set up project automation", content: Buffer.from(claudeWorkflow(await gh<{ login: string; id: number }>(tok, "/user").catch(() => null))).toString("base64"), ...(sha ? { sha } : {}) }),
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      notes.push(status === 403 || status === 404 ? "Couldn't write the workflow — the GitHub token needs “Contents: Read and write” and “Workflows: Read and write” on this repo." : (e as Error).message);
    }
    // Terminal workflow (Code → Terminal)
    try {
      const cur = await ghFetch(tok, `/repos/${r.full}/contents/${TERMINAL_PATH}`);
      const sha = cur.ok ? ((await cur.json()) as { sha?: string }).sha : undefined;
      await gh(tok, `/repos/${r.full}/contents/${TERMINAL_PATH}`, {
        method: "PUT",
        body: JSON.stringify({ message: "Add project terminal", content: Buffer.from(TERMINAL_WORKFLOW).toString("base64"), ...(sha ? { sha } : {}) }),
      });
    } catch (e) {
      if (!notes.length) notes.push(`Couldn't add the terminal workflow: ${(e as Error).message}`);
    }
    const cc = await claudeCodeTokenFor(getDb(), actor(c).id);
    if (cc) {
      try {
        await setRepoSecret(tok, r.full, cc.token);
      } catch (e) {
        const status = (e as { status?: number }).status;
        notes.push(status === 403 || status === 404 ? "Couldn't set the repo secret — the GitHub token needs “Secrets: Read and write”. Or add CLAUDE_CODE_OAUTH_TOKEN in the repo settings by hand." : (e as Error).message);
      }
    } else notes.push("Add your Claude Code token in Settings → Integrations (run `claude setup-token`) so Scoutline can set the repo secret.");
    return c.json({ ...(await setupState(c, tok, r.full)), notes });
  });

  // ── Potrošnja po sesiji: red „SCOUTLINE_USAGE {...}“ iz log-a (keš — log se čita jednom po sesiji) ──
  type Usage = { cost: number | null; turns: number | null; ms: number | null; in: number; out: number };
  const usageCache = new Map<string, Usage | null>();
  const usageOf = async (tok: string, full: string, runId: number): Promise<Usage | null> => {
    const k = `${full}#${runId}`;
    if (usageCache.has(k)) return usageCache.get(k)!;
    try {
      const jobs = await gh<{ jobs: Array<{ id: number }> }>(tok, `/repos/${full}/actions/runs/${runId}/jobs`);
      const job = jobs.jobs[0];
      if (!job) return null;
      const log = await ghFetch(tok, `/repos/${full}/actions/jobs/${job.id}/logs`);
      const m = log.ok ? /SCOUTLINE_USAGE (\{[^\n]*\})/.exec(await log.text()) : null;
      const u = m ? (JSON.parse(m[1]!) as Usage) : null;
      usageCache.set(k, u);
      return u;
    } catch {
      return null;
    }
  };

  // ── Sesije ──
  const matchPull = (pulls: GhPull[], n: number) =>
    pulls.find((p) => new RegExp(`(^|/)issue-${n}(-|$)`).test(p.head.ref) || new RegExp(`(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}\\b`, "i").test(p.body ?? "")) ?? null;
  const startedBy = (body: string | null) => /Started from Scoutline by ([^<\n]+)/.exec(body ?? "")?.[1]?.trim() ?? null;
  const minutesOf = (runs: GhRun[]) => Math.round(runs.filter((r) => r.status === "completed").reduce((a, r) => a + Math.max(0, Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at)), 0) / 60_000);
  const statusOf = (issue: GhIssue, pr: GhPull | null, runs: GhRun[]) => {
    if (runs.some((r) => r.status === "in_progress" || r.status === "queued" || r.status === "waiting")) return "working";
    if (pr) return pr.merged_at ? "merged" : pr.state === "open" ? "pr_open" : "closed";
    if (issue.state === "closed") return "closed";
    if (runs[0]?.conclusion === "failure") return "failed";
    return runs.length ? "replied" : "queued";
  };
  const pullView = (p: GhPull | null) => (p ? { number: p.number, url: p.html_url, title: p.title, state: p.merged_at ? "merged" : p.state, branch: p.head.ref } : null);

  app.get("/projects/:id/agent/runs", g.readGuard, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ runs: [], summary: null });
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet — add yours in Settings → Integrations." }, 400);
    try {
      const [issues, pulls, wf] = await Promise.all([
        gh<GhIssue[]>(tok, `/repos/${r.full}/issues?labels=${LABEL}&state=all&per_page=40&sort=created&direction=desc`),
        gh<GhPull[]>(tok, `/repos/${r.full}/pulls?state=all&per_page=60&sort=created&direction=desc`).catch(() => [] as GhPull[]),
        gh<{ workflow_runs: GhRun[] }>(tok, `/repos/${r.full}/actions/workflows/claude.yml/runs?per_page=100`).catch(() => ({ workflow_runs: [] as GhRun[] })),
      ]);
      const month0 = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).getTime();
      let budget = 25; // najviše novih log-ova po zahtevu (ostalo je u kešu)
      const runs = await Promise.all(
        issues
          .filter((i) => !i.pull_request)
          .map(async (i) => {
            const pr = matchPull(pulls, i.number);
            const mine = wf.workflow_runs.filter((w) => (w.display_title === i.title || (pr && w.display_title === pr.title)) && w.conclusion !== "skipped");
            const model = ((i as GhIssue & { labels?: Array<{ name: string }> }).labels ?? []).find((l) => l.name.startsWith("model:"))?.name.slice(6) ?? "default";
            const usage = { in: 0, out: 0, cost: 0, turns: 0, known: 0 };
            const sessionList: Array<{ id: number; at: string; minutes: number; status: string; conclusion: string | null; url: string; tokens: number | null; cost: number | null; turns: number | null }> = [];
            for (const w of mine) {
              let u: Usage | null = null;
              if (Date.parse(w.created_at) >= month0 && w.status === "completed" && (usageCache.has(`${r.full}#${w.id}`) || budget-- > 0)) u = await usageOf(tok, r.full, w.id);
              if (u) {
                usage.in += u.in;
                usage.out += u.out;
                usage.cost += u.cost ?? 0;
                usage.turns += u.turns ?? 0;
                usage.known++;
              }
              sessionList.push({
                id: w.id,
                at: w.run_started_at ?? w.created_at,
                minutes: w.status === "completed" ? Math.max(0, Math.round((Date.parse(w.updated_at) - Date.parse(w.run_started_at ?? w.created_at)) / 60_000)) : 0,
                status: w.status,
                conclusion: w.conclusion,
                url: w.html_url,
                tokens: u ? u.in + u.out : null,
                cost: u?.cost ?? null,
                turns: u?.turns ?? null,
              });
            }
            return { number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at, by: startedBy(i.body) ?? i.user?.login ?? null, model, status: statusOf(i, pr, mine), minutes: minutesOf(mine), sessions: mine.length, sessionList, pr: pullView(pr), usage: usage.known ? usage : null };
          }),
      );
      // Potrošnja ovog meseca: sesije (pokretanja Actions-a) i minuti, po osobi
      const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).getTime();
      const thisMonth = runs.filter((x) => Date.parse(x.createdAt) >= month);
      type Agg = { runs: number; sessions: number; minutes: number; tokens: number; cost: number };
      const add = (m: Record<string, Agg>, k: string, x: (typeof runs)[number]) => {
        const a = m[k] ?? { runs: 0, sessions: 0, minutes: 0, tokens: 0, cost: 0 };
        m[k] = { runs: a.runs + 1, sessions: a.sessions + x.sessions, minutes: a.minutes + x.minutes, tokens: a.tokens + (x.usage ? x.usage.in + x.usage.out : 0), cost: a.cost + (x.usage?.cost ?? 0) };
      };
      const byPerson: Record<string, Agg> = {};
      const byModel: Record<string, Agg> = {};
      for (const x of thisMonth) {
        add(byPerson, x.by ?? "unknown", x);
        add(byModel, x.model, x);
      }
      return c.json({
        runs,
        summary: {
          month: {
            runs: thisMonth.length,
            sessions: thisMonth.reduce((a, x) => a + x.sessions, 0),
            minutes: thisMonth.reduce((a, x) => a + x.minutes, 0),
            prs: thisMonth.filter((x) => x.pr).length,
            merged: thisMonth.filter((x) => x.pr?.state === "merged").length,
            tokensIn: thisMonth.reduce((a, x) => a + (x.usage?.in ?? 0), 0),
            tokensOut: thisMonth.reduce((a, x) => a + (x.usage?.out ?? 0), 0),
            cost: Math.round(thisMonth.reduce((a, x) => a + (x.usage?.cost ?? 0), 0) * 100) / 100,
            turns: thisMonth.reduce((a, x) => a + (x.usage?.turns ?? 0), 0),
          },
          byPerson,
          byModel,
          sessions: thisMonth
            .flatMap((x) => x.sessionList.map((sx) => ({ ...sx, task: x.title, number: x.number, by: x.by, model: x.model })))
            .sort((a, b) => b.at.localeCompare(a.at))
            .slice(0, 40),
        },
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.get("/projects/:id/agent/runs/:n", g.readGuard, async (c) => {
    const r = await repoOf(c);
    const n = Number(c.req.param("n"));
    if (!r || !Number.isInteger(n)) return c.json({ error: "Not found." }, 404);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet." }, 400);
    try {
      const [issue, comments, pulls] = await Promise.all([
        gh<GhIssue>(tok, `/repos/${r.full}/issues/${n}`),
        gh<GhComment[]>(tok, `/repos/${r.full}/issues/${n}/comments?per_page=100`),
        gh<GhPull[]>(tok, `/repos/${r.full}/pulls?state=all&per_page=60&sort=created&direction=desc`).catch(() => [] as GhPull[]),
      ]);
      const pr = matchPull(pulls, n);
      const prComments = pr ? await gh<GhComment[]>(tok, `/repos/${r.full}/issues/${pr.number}/comments?per_page=100`).catch(() => [] as GhComment[]) : [];
      const view = (x: GhComment, where: "issue" | "pr") => ({ id: x.id, where, author: x.user?.login ?? "?", bot: x.user?.type === "Bot" || /\[bot\]$/.test(x.user?.login ?? ""), body: x.body, createdAt: x.created_at, updatedAt: x.updated_at, url: x.html_url });
      return c.json({
        issue: { number: issue.number, title: issue.title, body: (issue.body ?? "").replace(/\n---\nWhen you're done:[\s\S]*$/, "").replace(/^@claude\s*/, "").replace(/\n*\((think|think hard|ultrathink)\)\s*$/, ""),
          model: ((issue as GhIssue & { labels?: Array<{ name: string }> }).labels ?? []).find((l) => l.name.startsWith("model:"))?.name.slice(6) ?? null, url: issue.html_url, state: issue.state, createdAt: issue.created_at, by: startedBy(issue.body) },
        comments: [...comments.map((x) => view(x, "issue")), ...prComments.map((x) => view(x, "pr"))].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        pr: pullView(pr),
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  /** Pre rada: lični Claude Code token korisnika ide u secret repoa, da sesija troši njegovu pretplatu. */
  /**
   * Pre svakog rada repo dobija token OSOBE KOJA POKREĆE (ili zajednički token firme, ako ga je vlasnik postavio).
   * Bez toga se rad odbija — niko ne može da troši tuđu pretplatu preko tokena koji je ostao u repou.
   */
  const useMyClaude = async (c: Context, tok: string, full: string): Promise<string | null> => {
    const cc = await claudeCodeTokenFor(getDb(), actor(c).id);
    if (!cc) return "Add your Claude Code token in Settings → Integrations first — Claude runs only on your own subscription.";
    try {
      await setRepoSecret(tok, full, cc.token);
      return null;
    } catch {
      return "Couldn't switch the repo to your Claude Code token — the GitHub token needs “Secrets: Read and write”. Stopped, so nobody else's subscription is used.";
    }
  };

  app.post("/projects/:id/agent/runs", member, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet — add yours in Settings → Integrations." }, 400);
    const input = (await c.req.json().catch(() => ({}))) as { prompt?: string; model?: string; effort?: string };
    const prompt = (input.prompt ?? "").trim().slice(0, 8000);
    const chosenModel = MODELS.includes(input.model as Model) ? (input.model as Model) : null;
    if (prompt.length < 3) return c.json({ error: "Describe what Claude should do." }, 400);
    const blocked = await useMyClaude(c, tok, r.full);
    if (blocked) return c.json({ error: blocked }, 400);
    const note = null;
    const first = prompt.split("\n")[0]!.replace(/\s+/g, " ").trim();
    const title = first.length > 90 ? `${first.slice(0, 87)}…` : first;
    const effort = pickEffort(input.effort, prompt);
    const model: Model = chosenModel ?? autoModel(effort);
    const body = [
      `@claude ${withEffort(prompt, effort)}`,
      "",
      "---",
      "When you're done: commit to a new branch and open a pull request with `gh pr create` (short English title, summary of the changes, and `Closes #<this issue>`). Keep changes focused. If this is only a question, answer in a comment and don't change files.",
      "Git hygiene: never mention Claude, AI, assistants or co-authors anywhere in git — not in commit messages, branch names, PR titles or PR descriptions — and no “Generated with …” footers. Write them as the developer would.",
      "",
      await projectContext(r.p),
      "",
      `<sub>Started from Scoutline by ${actor(c).name}</sub>`,
    ].join("\n");
    try {
      const created = await gh<GhIssue>(tok, `/repos/${r.full}/issues`, { method: "POST", body: JSON.stringify({ title, body, labels: [LABEL, `model:${model}`] }) });
      return c.json({ number: created.number, url: created.html_url, note, effort, effortAuto: !EFFORTS.includes(input.effort as Effort), model, modelAuto: !chosenModel }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.post("/projects/:id/agent/runs/:n/reply", member, async (c) => {
    const r = await repoOf(c);
    const n = Number(c.req.param("n"));
    if (!r || !Number.isInteger(n)) return c.json({ error: "Not found." }, 404);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { text?: string; pr?: number; model?: string; effort?: string };
    const text = (b.text ?? "").trim().slice(0, 8000);
    if (!text) return c.json({ error: "Write a message for Claude." }, 400);
    const blocked = await useMyClaude(c, tok, r.full);
    if (blocked) return c.json({ error: blocked }, 400);
    const note = null;
    // Ako postoji PR, odgovor ide tamo (Claude onda menja isti PR), inače na issue
    const target = Number.isInteger(b.pr) && b.pr! > 0 ? b.pr! : n;
    try {
      if (b.model !== undefined) await setModel(tok, r.full, target, MODELS.includes(b.model as Model) ? (b.model as Model) : autoModel(pickEffort(b.effort, text)));
      await gh(tok, `/repos/${r.full}/issues/${target}/comments`, { method: "POST", body: JSON.stringify({ body: `@claude ${withEffort(text, pickEffort(b.effort, text))}\n\n<sub>From Scoutline by ${actor(c).name}</sub>` }) });
      return c.json({ ok: true, note });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // ── „Work locally“: Claude Code na računaru korisnika (interaktivno), lokalni pregled, pa PR → main ──
  // Vraća jednu komandu: klonira/osveži repo, napravi granu po standardu i pokrene `claude` sa zadatkom i kontekstom.
  app.post("/projects/:id/local", member, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { issueId?: string; prompt?: string; model?: string; effort?: string };
    const db = getDb();
    const model = MODELS.includes(b.model as Model) ? (b.model as Model) : null;
    let title = "";
    let details = "";
    let key: string | null = null;
    let number: number | null = null;
    let labels: string[] = [];
    if (typeof b.issueId === "string" && UUID.test(b.issueId)) {
      const [t] = await db.select().from(tasks).where(eq(tasks.id, b.issueId)).limit(1);
      if (!t || t.projectId !== r.p.id) return c.json({ error: "Task not found." }, 404);
      title = t.title;
      details = t.description ?? "";
      key = r.p.key;
      number = t.number;
      labels = t.labels;
      // Rad je počeo → task u „In progress“
      if (t.status === "todo" || t.status === "backlog") {
        await db.update(tasks).set({ status: "in_progress", updatedAt: new Date() }).where(eq(tasks.id, t.id));
        await db.insert(issueEvents).values({ issueId: t.id, type: "status", data: { from: t.status, to: "in_progress", via: "work locally" }, actor: actor(c).name });
      }
    } else {
      details = (b.prompt ?? "").trim().slice(0, 6000);
      if (details.length < 3) return c.json({ error: "Describe what to build, or open a task." }, 400);
      title = details.split("\n")[0]!.slice(0, 80);
    }
    const tok = await ghToken(c);
    const main = tok ? ((await gh<{ default_branch: string }>(tok, `/repos/${r.full}`).catch(() => null))?.default_branch ?? "main") : "main";
    const branch = branchName({ key, number, title, labels });
    const dir = r.full.split("/")[1]!;
    const folder = `~/scoutline/${r.p.key}`;
    const ref = key && number ? `${key}-${number}` : null;
    const effort = pickEffort(b.effort, `${title}\n${details}`);
    const prompt = [
      EFFORT_WORD[effort] ? `${EFFORT_WORD[effort]}.` : "",
      `You're working on the Scoutline project ${r.p.name} (${r.p.key}), repo ${r.full}, on branch \`${branch}\` (from ${main}).`,
      "",
      ref ? `Task ${ref}: ${title}` : `Task: ${title}`,
      details && details !== title ? `\n${details}` : "",
      "",
      "How we work:",
      "1. Make the changes in this repo. Keep them focused and production quality.",
      "2. Start a local preview so I can check it (plain website: `npx --yes serve . -l 3000`; Node app: `npm install && npm run dev`) and tell me the URL. Keep it running while we iterate.",
      `3. When I say it's done: commit with a clear message, \`git push -u origin ${branch}\`, then open a pull request: \`gh pr create --base ${main} --title "${ref ? `[${ref}] ` : ""}<short title>" --body "<what changed>${ref ? `\\n\\nTask: ${ref}` : ""}"\`. Tell me the PR link.`,
      "4. Don't merge — the team merges in Scoutline.",
      "5. Never mention Claude, AI or co-authors in commit messages, branch names, PR titles or descriptions (no “Generated with …” footers).",
      "",
      await projectContext(r.p),
    ].join("\n");
    const claudeArgs = [`--model ${model ?? autoModel(effort)}`, `--settings '{"includeCoAuthoredBy":false}'`].filter(Boolean).join(" ");
    const command = [
      `mkdir -p ${folder} && cd ${folder} && { [ -d ${dir}/.git ] || git clone https://github.com/${r.full}.git; } && cd ${dir} \\`,
      `  && git fetch origin && git checkout ${main} && git pull --ff-only \\`,
      `  && { git checkout ${branch} 2>/dev/null || git checkout -b ${branch}; } \\`,
      `  && claude ${claudeArgs} "$(cat <<'SCOUTLINE_TASK'`,
      prompt.replace(/SCOUTLINE_TASK/g, "SCOUTLINE-TASK"),
      "SCOUTLINE_TASK",
      `)"`,
    ].join("\n");
    return c.json({ branch, main, folder: `${folder}/${dir}`, command, task: ref, effort });
  });

  // ── Terminal: POST pokreće komandu (GitHub Actions), GET vraća status i izlaz ──
  app.post("/projects/:id/terminal", member, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { command?: string; ref?: string };
    const command = (b.command ?? "").trim().slice(0, 2000);
    if (!command) return c.json({ error: "Type a command." }, 400);
    const ref = (b.ref ?? "").trim().slice(0, 200);
    try {
      const repo = await gh<{ default_branch: string }>(tok, `/repos/${r.full}`);
      const tw = await ghFetch(tok, `/repos/${r.full}/contents/${TERMINAL_PATH}`);
      if (!tw.ok) return c.json({ error: "The terminal isn't set up on this repo yet — click “Set up automatically” on the Code tab." }, 400);
      const id = Math.random().toString(36).slice(2, 10);
      await gh(tok, `/repos/${r.full}/actions/workflows/scoutline-terminal.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: repo.default_branch, inputs: { command, ref, id } }) });
      return c.json({ id, command, ref: ref || repo.default_branch }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.get("/projects/:id/terminal/:tid", g.readGuard, async (c) => {
    const r = await repoOf(c);
    const tid = c.req.param("tid")!;
    if (!r || !/^[a-z0-9]{4,12}$/.test(tid)) return c.json({ error: "Not found." }, 404);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet." }, 400);
    try {
      const runs = await gh<{ workflow_runs: GhRun[] }>(tok, `/repos/${r.full}/actions/workflows/scoutline-terminal.yml/runs?event=workflow_dispatch&per_page=30`);
      const run = runs.workflow_runs.find((w) => w.display_title === `terminal ${tid}`);
      if (!run) return c.json({ status: "queued", output: "" });
      if (run.status !== "completed") return c.json({ status: run.status === "in_progress" ? "running" : "queued", url: run.html_url, output: "" });
      const jobs = await gh<{ jobs: Array<{ id: number }> }>(tok, `/repos/${r.full}/actions/runs/${run.id}/jobs`);
      const job = jobs.jobs[0];
      let output = "";
      if (job) {
        const log = await ghFetch(tok, `/repos/${r.full}/actions/jobs/${job.id}/logs`, { redirect: "follow" });
        output = log.ok ? commandOutput(await log.text()) : "(logs aren't available yet — open the run on GitHub)";
      }
      const seconds = Math.round((Date.parse(run.updated_at) - Date.parse(run.run_started_at ?? run.created_at)) / 1000);
      return c.json({ status: "done", ok: run.conclusion === "success", conclusion: run.conclusion, url: run.html_url, seconds, output });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // „Obriši razgovor“: GitHub ne dozvoljava brisanje issue-a preko API-ja — zatvaramo ga i skidamo oznaku, pa nestaje sa liste
  app.post("/projects/:id/agent/runs/:n/delete", member, async (c) => {
    const r = await repoOf(c);
    const n = Number(c.req.param("n"));
    if (!r || !Number.isInteger(n)) return c.json({ error: "Not found." }, 404);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet." }, 400);
    try {
      const issue = await gh<GhIssue & { labels: Array<{ name: string }> }>(tok, `/repos/${r.full}/issues/${n}`);
      await gh(tok, `/repos/${r.full}/issues/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned", labels: issue.labels.map((l) => l.name).filter((l) => l !== LABEL && !l.startsWith("model:")) }) });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  return app;
}

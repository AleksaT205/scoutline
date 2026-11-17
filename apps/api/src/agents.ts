import { Hono, type Context, type MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import sodium from "libsodium-wrappers";
import { claudeCodeTokenFor, ghFetch, projectRepoNames, projects, userGithubToken, type Db } from "@radar/db";
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
const MARKER = "# scoutline:claude-v2";
export const APP_INSTALL_URL = "https://github.com/apps/claude/installations/new";

/** Workflow koji Scoutline upisuje u repo. Claude sam otvara PR (gh pr create) i ne dopisuje sebe u commit-e. */
export const CLAUDE_WORKFLOW = `${MARKER}
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
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        with:
          claude_code_oauth_token: \${{ secrets.${SECRET} }}
          settings: |
            { "includeCoAuthoredBy": false }
          claude_args: |
            --max-turns 40
            --allowedTools "Bash(npm *),Bash(npx *),Bash(pnpm *),Bash(git *),Bash(gh pr create:*),Bash(gh pr view:*)"
`;

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
      secret: boolean | null; // null = token nema dozvolu „Secrets“ pa ne znamo
      claudeToken: "personal" | "workspace" | "server" | null;
      appInstallUrl: string;
      error?: string;
    } = { repo: full, access: false, canPush: false, defaultBranch: null, workflow: "missing", secret: null, claudeToken: null, appInstallUrl: APP_INSTALL_URL };
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
    const sec = await ghFetch(tok, `/repos/${full}/actions/secrets/${SECRET}`);
    out.secret = sec.status === 200 ? true : sec.status === 404 ? false : null;
    return out;
  };

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
        body: JSON.stringify({ message: "Set up Claude Code (from Scoutline)", content: Buffer.from(CLAUDE_WORKFLOW).toString("base64"), ...(sha ? { sha } : {}) }),
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      notes.push(status === 403 || status === 404 ? "Couldn't write the workflow — the GitHub token needs “Contents: Read and write” and “Workflows: Read and write” on this repo." : (e as Error).message);
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
      const runs = issues
        .filter((i) => !i.pull_request)
        .map((i) => {
          const pr = matchPull(pulls, i.number);
          const mine = wf.workflow_runs.filter((w) => w.display_title === i.title || (pr && w.display_title === pr.title));
          return { number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at, by: startedBy(i.body) ?? i.user?.login ?? null, status: statusOf(i, pr, mine), minutes: minutesOf(mine), sessions: mine.length, pr: pullView(pr) };
        });
      // Potrošnja ovog meseca: sesije (pokretanja Actions-a) i minuti, po osobi
      const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).getTime();
      const thisMonth = runs.filter((x) => Date.parse(x.createdAt) >= month);
      const byPerson: Record<string, { runs: number; minutes: number }> = {};
      for (const x of thisMonth) {
        const k = x.by ?? "unknown";
        byPerson[k] = { runs: (byPerson[k]?.runs ?? 0) + 1, minutes: (byPerson[k]?.minutes ?? 0) + x.minutes };
      }
      return c.json({
        runs,
        summary: { month: { runs: thisMonth.length, sessions: thisMonth.reduce((a, x) => a + x.sessions, 0), minutes: thisMonth.reduce((a, x) => a + x.minutes, 0), prs: thisMonth.filter((x) => x.pr).length, merged: thisMonth.filter((x) => x.pr?.state === "merged").length }, byPerson },
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
        issue: { number: issue.number, title: issue.title, body: (issue.body ?? "").replace(/\n---\nWhen you're done:[\s\S]*$/, "").replace(/^@claude\s*/, ""), url: issue.html_url, state: issue.state, createdAt: issue.created_at, by: startedBy(issue.body) },
        comments: [...comments.map((x) => view(x, "issue")), ...prComments.map((x) => view(x, "pr"))].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        pr: pullView(pr),
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  /** Pre rada: lični Claude Code token korisnika ide u secret repoa, da sesija troši njegovu pretplatu. */
  const useMyClaude = async (c: Context, tok: string, full: string) => {
    const cc = await claudeCodeTokenFor(getDb(), actor(c).id);
    if (cc?.owner !== "personal") return null;
    try {
      await setRepoSecret(tok, full, cc.token);
      return null;
    } catch {
      return "Couldn't switch the repo to your Claude Code token (the GitHub token needs “Secrets: Read and write”) — the repo's current token is used.";
    }
  };

  app.post("/projects/:id/agent/runs", member, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet — add yours in Settings → Integrations." }, 400);
    const prompt = (((await c.req.json().catch(() => ({}))) as { prompt?: string }).prompt ?? "").trim().slice(0, 8000);
    if (prompt.length < 3) return c.json({ error: "Describe what Claude should do." }, 400);
    const note = await useMyClaude(c, tok, r.full);
    const first = prompt.split("\n")[0]!.replace(/\s+/g, " ").trim();
    const title = first.length > 90 ? `${first.slice(0, 87)}…` : first;
    const body = [
      `@claude ${prompt}`,
      "",
      "---",
      "When you're done: commit to a new branch and open a pull request with `gh pr create` (short English title, summary of the changes, and `Closes #<this issue>`). Keep changes focused. Don't add yourself as a co-author.",
      "",
      `<sub>Started from Scoutline by ${actor(c).name}</sub>`,
    ].join("\n");
    try {
      const created = await gh<GhIssue>(tok, `/repos/${r.full}/issues`, { method: "POST", body: JSON.stringify({ title, body, labels: [LABEL] }) });
      return c.json({ number: created.number, url: created.html_url, note }, 201);
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
    const b = (await c.req.json().catch(() => ({}))) as { text?: string; pr?: number };
    const text = (b.text ?? "").trim().slice(0, 8000);
    if (!text) return c.json({ error: "Write a message for Claude." }, 400);
    const note = await useMyClaude(c, tok, r.full);
    // Ako postoji PR, odgovor ide tamo (Claude onda menja isti PR), inače na issue
    const target = Number.isInteger(b.pr) && b.pr! > 0 ? b.pr! : n;
    try {
      await gh(tok, `/repos/${r.full}/issues/${target}/comments`, { method: "POST", body: JSON.stringify({ body: `@claude ${text}\n\n<sub>From Scoutline by ${actor(c).name}</sub>` }) });
      return c.json({ ok: true, note });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  return app;
}

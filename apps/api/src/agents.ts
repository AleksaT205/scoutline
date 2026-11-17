import { createHash } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, desc, eq } from "drizzle-orm";
import sodium from "libsodium-wrappers";
import { asc } from "drizzle-orm";
import { branchName } from "@radar/shared";
import { issueEvents } from "@radar/db";
import { claudeCodeTokenFor, customers, ghFetch, issues as tasks, projectRepoNames, projects, userGithubToken, users, type Db } from "@radar/db";
import { runtime } from "./runtime.js";
import { attachmentUrl, publicBase } from "./preview.js";
import { agentMessages, agentRuns, attachments } from "@radar/db";
import { inArray } from "drizzle-orm";

/**
 * Faza 16 — Claude Code iz aplikacije (preko GitHub Actions, na pretplati korisnika — bez API ključa):
 *  - povezivanje repoa + „Set up automatically“ (workflow „Scoutline agent“, terminal i secret CLAUDE_CODE_OAUTH_TOKEN),
 *  - „Build with Claude“: prompt → workflow_dispatch → Claude radi na grani, commit pod imenom korisnika → Scoutline otvara PR,
 *  - razgovor i potrošnja se čuvaju u Scoutline-u (agent_runs / agent_messages) — na GitHub-u nema issue-a ni bot komentara.
 */
interface Guards {
  readGuard: MiddlewareHandler;
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
}
type Actor = { id: string | null; name: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = "CLAUDE_CODE_OAUTH_TOKEN";
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

export const APP_INSTALL_URL = "https://github.com/apps/claude/installations/new";

/**
 * Workflow „Scoutline agent“: Scoutline ga pokreće sa zadatkom (workflow_dispatch). Claude Code radi na grani,
 * commit-uje pod imenom osobe koja je pokrenula rad, a workflow push-uje. Bez GitHub issue-a i bot komentara —
 * razgovor je u Scoutline-u, PR otvara Scoutline korisnikovim tokenom. Odgovor ide u log kao „SCOUTLINE_RESULT <base64>“.
 */
const AGENT_FILE = "scoutline-agent.yml";
const AGENT_PATH = `.github/workflows/${AGENT_FILE}`;
const AGENT_MARKER = "# scoutline:agent-v1";
const OLD_WORKFLOW_PATH = ".github/workflows/claude.yml"; // stari način (issue + @claude) — Scoutline ga uklanja pri podešavanju
export const AGENT_WORKFLOW = `${AGENT_MARKER}
# Pokreće ga Scoutline: zadatak iz aplikacije → izmene na grani, commit pod imenom osobe koja je pokrenula rad.
# Pull request otvara Scoutline. Radi na pretplati te osobe (secret ${SECRET}, postavlja ga Scoutline).
name: Scoutline agent
run-name: agent \${{ inputs.id }}
on:
  workflow_dispatch:
    inputs:
      id:
        description: Scoutline run id
        required: true
      branch:
        description: Branch to work on
        required: true
      base:
        description: Base for a new branch
        required: false
        default: ""
      model:
        description: Model
        required: false
        default: sonnet
      task:
        description: Task (base64)
        required: true
      author_name:
        description: Commit author name
        required: false
        default: ""
      author_email:
        description: Commit author email
        required: false
        default: ""
permissions:
  contents: write
concurrency:
  group: scoutline-agent-\${{ inputs.branch }}
  cancel-in-progress: false
jobs:
  work:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Prepare branch
        env:
          BRANCH: \${{ inputs.branch }}
          BASE: \${{ inputs.base || github.event.repository.default_branch }}
          AN: \${{ inputs.author_name }}
          AE: \${{ inputs.author_email }}
        run: |
          git config user.name "\${AN:-$GITHUB_ACTOR}"
          git config user.email "\${AE:-$GITHUB_ACTOR@users.noreply.github.com}"
          if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
            git checkout -q -B "$BRANCH" "origin/$BRANCH"
          else
            git checkout -q -B "$BRANCH" "origin/$BASE"
          fi
          echo "START_SHA=$(git rev-parse HEAD)" >> "$GITHUB_ENV"
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Work
        env:
          ${SECRET}: \${{ secrets.${SECRET} }}
          TASK: \${{ inputs.task }}
          MODEL: \${{ inputs.model }}
        run: |
          printf '%s' "$TASK" | base64 -d > "$RUNNER_TEMP/task.md"
          npx -y @anthropic-ai/claude-code@latest -p "$(cat "$RUNNER_TEMP/task.md")" --model "$MODEL" --max-turns 80 \\
            --output-format stream-json --verbose --permission-mode acceptEdits \\
            --settings '{"includeCoAuthoredBy":false}' \\
            --allowedTools "Bash(npm *),Bash(npx *),Bash(pnpm *),Bash(yarn *),Bash(node *),Bash(git *),Bash(curl *),Bash(ls *),Bash(cat *),Bash(mkdir *),Read,Write,Edit,MultiEdit,Glob,Grep,LS" \\
            > "$RUNNER_TEMP/out.jsonl" || echo "agent exited with code $?"
      - name: Save
        if: always()
        env:
          BRANCH: \${{ inputs.branch }}
        run: |
          git add -A
          git diff --cached --quiet || git commit -q -m "Update from task"
          if [ "$(git rev-parse HEAD)" != "$START_SHA" ]; then git push -q origin "HEAD:refs/heads/$BRANCH" && echo "pushed $BRANCH"; fi
      - name: Result
        if: always()
        run: |
          cat > "$RUNNER_TEMP/result.js" <<'JS'
          const fs = require("fs");
          const f = process.env.RUNNER_TEMP + "/out.jsonl";
          const lines = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\\n") : [];
          let result = null;
          const steps = [];
          for (const l of lines) {
            let m;
            try { m = JSON.parse(l); } catch (e) { continue; }
            if (m.type === "result") result = m;
            if (m.type === "assistant" && m.message && Array.isArray(m.message.content)) {
              for (const c of m.message.content) {
                if (c.type !== "tool_use" || steps.length >= 60) continue;
                const i = c.input || {};
                steps.push((c.name + " " + String(i.file_path || i.path || i.command || i.pattern || "")).slice(0, 160));
              }
            }
          }
          const u = (result && result.usage) || {};
          let commits = [];
          try { commits = require("child_process").execSync('git log --format=%s "$START_SHA..HEAD"', { encoding: "utf8" }).split("\\n").filter(Boolean); } catch (e) {}
          const out = {
            ok: !!result && !result.is_error,
            text: (result && typeof result.result === "string" && result.result) || "",
            cost: result && typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
            turns: result && typeof result.num_turns === "number" ? result.num_turns : null,
            ms: result && typeof result.duration_ms === "number" ? result.duration_ms : null,
            in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
            out: u.output_tokens || 0,
            steps,
            commits: commits.slice(0, 30),
          };
          console.log("SCOUTLINE_RESULT " + Buffer.from(JSON.stringify(out)).toString("base64"));
          JS
          node "$RUNNER_TEMP/result.js"
`;

const newId = () => Math.random().toString(36).slice(2, 10);
const encRef = (b: string) => b.split("/").map(encodeURIComponent).join("/");
type AgentResult = { ok: boolean; text: string; cost: number | null; turns: number | null; ms: number | null; in: number; out: number; steps: string[]; commits: string[] };
const parseResult = (log: string): AgentResult | null => {
  const m = /SCOUTLINE_RESULT ([A-Za-z0-9+/=]+)/.exec(log);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1]!, "base64").toString("utf8")) as AgentResult;
  } catch {
    return null;
  }
};
async function ghJ<T>(tok: string, path: string, init?: RequestInit): Promise<T> {
  const r = await ghFetch(tok, path, init);
  if (!r.ok) {
    const msg = ((await r.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${r.status}`;
    throw Object.assign(new Error(`GitHub: ${msg}`), { status: r.status });
  }
  return (r.status === 204 ? null : await r.json()) as T;
}

/**
 * Proveri sesiju na GitHub-u. Kad je gotova: upiši odgovor u razgovor, a ako ima novih commit-a i još nema PR-a —
 * preimenuj privremenu granu po standardu i otvori PR (tokenom osobe koja je pokrenula rad → autor PR-a je ta osoba).
 */
const syncing = new Set<string>();
export async function syncAgentRun(db: Db, run: typeof agentRuns.$inferSelect): Promise<typeof agentRuns.$inferSelect> {
  if (run.status !== "queued" && run.status !== "working") return run;
  if (!run.dispatchId) {
    // Odgovor nije upisan (prekid usred upisa) → posle 10 min označi kao neuspelo, da ne visi zauvek
    if (Date.now() - run.updatedAt.getTime() < 10 * 60_000) return run;
    const [upd] = await db.update(agentRuns).set({ status: "failed", updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).returning();
    return upd ?? run;
  }
  if (syncing.has(run.id)) return run;
  syncing.add(run.id);
  try {
    const tok = (await userGithubToken(db, run.createdById)) ?? (await runtime(db)).githubToken;
    if (!tok) return run;
    const list = await ghJ<{ workflow_runs: GhRun[] }>(tok, `/repos/${run.repo}/actions/workflows/${AGENT_FILE}/runs?event=workflow_dispatch&per_page=40`).catch(() => null);
    if (!list) return run;
    const w = list.workflow_runs.find((x) => x.display_title === `agent ${run.dispatchId}`);
    if (!w) {
      if (Date.now() - run.updatedAt.getTime() < 20 * 60_000) return run;
      const [upd] = await db.update(agentRuns).set({ status: "failed", dispatchId: null, updatedAt: new Date() }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.dispatchId, run.dispatchId))).returning();
      if (upd) await db.insert(agentMessages).values({ runId: run.id, role: "assistant", body: "The job didn't start on GitHub (Actions may be off or out of minutes for this repo). Try again, or check the repo's Actions tab.", meta: { ok: false } });
      return upd ?? run;
    }
    if (w.status !== "completed") {
      if (run.status === "working" && run.ghRunId === String(w.id)) return run;
      const [upd] = await db.update(agentRuns).set({ status: w.status === "in_progress" ? "working" : "queued", ghRunId: String(w.id), ghRunUrl: w.html_url, startedAt: w.run_started_at ? new Date(w.run_started_at) : null }).where(eq(agentRuns.id, run.id)).returning();
      return upd ?? run;
    }
    // Gotovo — preuzmi sesiju (samo jedan proces upisuje odgovor)
    const [claimed] = await db.update(agentRuns).set({ dispatchId: null, ghRunId: String(w.id), ghRunUrl: w.html_url }).where(and(eq(agentRuns.id, run.id), eq(agentRuns.dispatchId, run.dispatchId))).returning();
    if (!claimed) return run;
    let res: AgentResult | null = null;
    const jobs = await ghJ<{ jobs: Array<{ id: number }> }>(tok, `/repos/${run.repo}/actions/runs/${w.id}/jobs`).catch(() => ({ jobs: [] as Array<{ id: number }> }));
    if (jobs.jobs[0]) {
      const log = await ghFetch(tok, `/repos/${run.repo}/actions/jobs/${jobs.jobs[0].id}/logs`, { redirect: "follow" });
      if (log.ok) res = parseResult(await log.text());
    }
    const ok = w.conclusion === "success" && (res?.ok ?? false);
    const text = res?.text?.trim() || (w.conclusion === "success" ? "Done." : `The run stopped (${w.conclusion ?? "unknown"}). Open the job on GitHub for details.`);
    // PR: novi commit-i, a PR još ne postoji → lepo ime grane + PR
    let { branch, prNumber, prUrl } = claimed;
    let prNote = "";
    if (!prNumber) {
      try {
        const repo = await ghJ<{ default_branch: string }>(tok, `/repos/${run.repo}`);
        const base = claimed.base ?? repo.default_branch;
        const cmp = await ghJ<{ ahead_by: number; commits: Array<{ commit: { message: string } }> }>(tok, `/repos/${run.repo}/compare/${encRef(base)}...${encRef(branch)}`).catch(() => null);
        if (cmp && cmp.ahead_by > 0) {
          const [p] = await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1);
          const firstMsg = await db.select({ body: agentMessages.body }).from(agentMessages).where(and(eq(agentMessages.runId, run.id), eq(agentMessages.role, "user"))).orderBy(asc(agentMessages.createdAt)).limit(1);
          const num = p ? new RegExp(`\\b${p.key}-(\\d+)\\b`, "i").exec(firstMsg[0]?.body ?? "")?.[1] : undefined;
          const title = cmp.commits[0]?.commit.message.split("\n")[0]?.trim() || run.title;
          if (branch.startsWith("wip/")) {
            let name = branchName({ key: num ? p!.key : null, number: num ? Number(num) : null, title: title.replace(/^\[[^\]]+\]\s*/, "") });
            if ((await ghFetch(tok, `/repos/${run.repo}/branches/${encRef(name)}`)).ok) name = `${name}-${newId().slice(0, 4)}`;
            await ghJ(tok, `/repos/${run.repo}/branches/${encRef(branch)}/rename`, { method: "POST", body: JSON.stringify({ new_name: name }) });
            branch = name;
          }
          const list = cmp.commits.map((x) => `- ${x.commit.message.split("\n")[0]}`).slice(0, 20).join("\n");
          const pr = await ghJ<{ number: number; html_url: string }>(tok, `/repos/${run.repo}/pulls`, {
            method: "POST",
            body: JSON.stringify({ title: (num ? `[${p!.key.toUpperCase()}-${num}] ${title}` : title).slice(0, 120), head: branch, base, body: `${list}${num ? `\n\nTask: ${p!.key.toUpperCase()}-${num}` : ""}` }),
          });
          prNumber = pr.number;
          prUrl = pr.html_url;
        }
      } catch (e) {
        prNote = `\n\n_Couldn't open the pull request automatically: ${(e as Error).message}_`;
      }
    }
    await db.insert(agentMessages).values({
      runId: run.id,
      role: "assistant",
      body: `${text}${prNote}`,
      meta: { ok, conclusion: w.conclusion, url: w.html_url, cost: res?.cost ?? null, in: res?.in ?? null, out: res?.out ?? null, turns: res?.turns ?? null, ms: res?.ms ?? Math.max(0, Date.parse(w.updated_at) - Date.parse(w.run_started_at ?? w.created_at)), steps: res?.steps ?? [], commits: res?.commits ?? [] },
    });
    const [upd] = await db.update(agentRuns).set({ status: ok || res?.text ? "done" : "failed", branch, prNumber, prUrl, updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).returning();
    return upd ?? run;
  } finally {
    syncing.delete(run.id);
  }
}

/** Pozadinska provera na minut: aktivne sesije se završe (odgovor + PR) i kad niko nema otvorenu aplikaciju. */
export function startAgentPoller(getDb: () => Db) {
  const tick = async () => {
    const db = getDb();
    const rows = await db.select().from(agentRuns).where(inArray(agentRuns.status, ["queued", "working"])).limit(25).catch(() => []);
    for (const r of rows) await syncAgentRun(db, r).catch((e) => console.warn(`[agent] ${r.id}: ${(e as Error).message}`));
  };
  setInterval(() => void tick(), 60_000);
  setTimeout(() => void tick(), 10_000);
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

  /** Slike iz razgovora: markdown slika (vide je ljudi na GitHub-u i u Scoutline-u) + kako da ih Claude preuzme i pogleda. */
  const imageBlock = async (c: Context, projectId: string, ids: unknown) => {
    const list = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 6);
    if (!list.length) return "";
    const rows = await getDb().select({ id: attachments.id, mime: attachments.mime, projectId: attachments.projectId }).from(attachments).where(inArray(attachments.id, list));
    const ok = rows.filter((r) => r.projectId === projectId);
    if (!ok.length) return "";
    const base = publicBase(c);
    return [
      "",
      ...ok.map((r, i) => `![image ${i + 1}](${attachmentUrl(base, r.id, r.mime)})`),
      "",
      `<sub>Images: download each with \`curl -sL "URL" -o /tmp/image-N.png\` and open it with Read before you start.</sub>`,
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
    const wf = await ghFetch(tok, `/repos/${full}/contents/${AGENT_PATH}`, { headers: { Accept: "application/vnd.github.raw" } });
    if (wf.ok) out.workflow = (await wf.text()).includes(AGENT_MARKER) ? "ok" : "outdated";
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
      const cur = await ghFetch(tok, `/repos/${r.full}/contents/${AGENT_PATH}`);
      const sha = cur.ok ? ((await cur.json()) as { sha?: string }).sha : undefined;
      await gh(tok, `/repos/${r.full}/contents/${AGENT_PATH}`, {
        method: "PUT",
        body: JSON.stringify({ message: "Set up project automation", content: Buffer.from(AGENT_WORKFLOW).toString("base64"), ...(sha ? { sha } : {}) }),
      });
      // Stari način (issue + @claude) više ne treba — uklanja se samo naš fajl
      const old = await ghFetch(tok, `/repos/${r.full}/contents/${OLD_WORKFLOW_PATH}`);
      if (old.ok) {
        const o = (await old.json()) as { sha: string; content?: string };
        if (Buffer.from(o.content ?? "", "base64").toString("utf8").includes("scoutline:claude-v")) {
          await gh(tok, `/repos/${r.full}/contents/${OLD_WORKFLOW_PATH}`, { method: "DELETE", body: JSON.stringify({ message: "Remove old automation", sha: o.sha }) }).catch(() => undefined);
        }
      }
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

  // ── Razgovori sa Claude-om (bez GitHub issue-a): čuvaju se u Scoutline-u, rad ide kroz workflow „Scoutline agent“ ──
  /** Pre rada: lični Claude Code token korisnika ide u secret repoa, da sesija troši njegovu pretplatu. */
  /**
   * Strogo: svaka sesija mora da troši pretplatu osobe koja je pokreće (lični token, pa token firme ako ga je vlasnik sačuvao).
   * Bez tokena — nema pokretanja, da se ne potroši tuđa pretplata.
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

  /** Zadatak za agenta: zahtev, pravila za git, dosadašnji razgovor i kontekst projekta. */
  const buildTask = async (p: typeof projects.$inferSelect, o: { text: string; effort: Effort; images: string; branch: string; prNumber: number | null; history: Array<{ role: string; body: string }> }) => {
    const rules = [
      "---",
      "How to work (from Scoutline):",
      `- You're in the repo on branch \`${o.branch}\`${o.prNumber ? ` (open pull request #${o.prNumber})` : ""}. Make the change, then commit with short English messages that say what changed (git add + git commit).`,
      "- Don't push, don't open pull requests, and don't create, rename or switch branches — Scoutline does that.",
      "- Git hygiene: never mention Claude, AI, assistants or co-authors anywhere — not in commit messages, code comments or docs — and no “Generated with …” lines. Write as the developer would.",
      "- If this is only a question, answer it and don't change files.",
      "- Finish with a short summary for the team: what you changed (files) and anything to check. Reply in the language the request is written in.",
    ].join("\n");
    const ctx = await projectContext(p);
    const head = `${withEffort(o.text, o.effort)}${o.images}\n\n${rules}`;
    // GitHub prima najviše ~64 KB ulaza — skraćujemo istoriju (najnovije poruke ostaju)
    let budget = 40_000 - head.length - ctx.length;
    const lines: string[] = [];
    for (const m of [...o.history].reverse()) {
      const row = `**${m.role === "user" ? "Team" : "You (earlier)"}:** ${m.body.length > 1500 ? `${m.body.slice(0, 1500)}…` : m.body}`;
      if (budget - row.length < 0) break;
      budget -= row.length;
      lines.unshift(row);
    }
    return [head, lines.length ? `\nConversation so far (oldest first):\n\n${lines.join("\n\n")}` : "", "", ctx].join("\n");
  };

  /** Pokreni rad: grana (postojeći otvoren PR ili nova privremena), autor commit-a = korisnik, zadatak u workflow. */
  const dispatchRun = async (c: Context, tok: string, r: { p: typeof projects.$inferSelect; full: string }, run: typeof agentRuns.$inferSelect, o: { text: string; model: Model; effort: Effort; images: string }) => {
    const repo = await gh<{ default_branch: string }>(tok, `/repos/${r.full}`);
    const wf = await ghFetch(tok, `/repos/${r.full}/contents/${AGENT_PATH}`);
    if (!wf.ok) throw Object.assign(new Error("Claude isn't set up on this repo yet — click “Set up automatically” above."), { status: 400 });
    let branch = run.branch;
    let prNumber = run.prNumber;
    let prUrl = run.prUrl;
    if (prNumber) {
      const pr = await gh<{ state: string; html_url: string; head: { ref: string } }>(tok, `/repos/${r.full}/pulls/${prNumber}`).catch(() => null);
      if (pr?.state === "open") branch = pr.head.ref;
      else {
        // PR je spojen ili zatvoren → novi rad ide na novu granu i dobija novi PR
        prNumber = null;
        prUrl = null;
        branch = `wip/${newId()}`;
      }
    }
    const dispatchId = newId();
    const me = await gh<{ login: string; id: number; name: string | null }>(tok, "/user").catch(() => null);
    const history = await getDb().select({ role: agentMessages.role, body: agentMessages.body }).from(agentMessages).where(eq(agentMessages.runId, run.id)).orderBy(asc(agentMessages.createdAt));
    const task = await buildTask(r.p, { text: o.text, effort: o.effort, images: o.images, branch, prNumber, history: history.slice(0, -1) });
    await gh(tok, `/repos/${r.full}/actions/workflows/${AGENT_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref: repo.default_branch,
        inputs: { id: dispatchId, branch, base: run.base ?? repo.default_branch, model: o.model, task: Buffer.from(task).toString("base64"), author_name: me?.name || me?.login || actor(c).name, author_email: me ? `${me.id}+${me.login}@users.noreply.github.com` : "" },
      }),
    });
    await getDb()
      .update(agentRuns)
      .set({ dispatchId, status: "queued", branch, base: run.base ?? repo.default_branch, prNumber, prUrl, model: o.model, ghRunId: null, ghRunUrl: null, startedAt: null, updatedAt: new Date() })
      .where(eq(agentRuns.id, run.id));
    return dispatchId;
  };

  const runView = (x: typeof agentRuns.$inferSelect, msgs: Array<typeof agentMessages.$inferSelect>, prState?: string) => {
    const done = msgs.filter((m) => m.role === "assistant");
    const sum = (k: string) => done.reduce((a, m) => a + (typeof m.meta[k] === "number" ? (m.meta[k] as number) : 0), 0);
    const known = done.some((m) => typeof m.meta.in === "number");
    return {
      id: x.id,
      title: x.title,
      status: x.status === "done" && x.prNumber ? (prState === "merged" ? "merged" : prState === "closed" ? "closed" : "pr_open") : x.status === "done" ? "replied" : x.status,
      by: x.createdBy,
      model: x.model ?? "sonnet",
      createdAt: x.createdAt.toISOString(),
      updatedAt: x.updatedAt.toISOString(),
      branch: x.branch,
      minutes: Math.round(sum("ms") / 60_000),
      sessions: done.length,
      pr: x.prNumber ? { number: x.prNumber, url: x.prUrl ?? "", branch: x.branch, state: prState ?? "open" } : null,
      usage: known ? { in: sum("in"), out: sum("out"), cost: Math.round(sum("cost") * 100) / 100, turns: sum("turns") } : null,
    };
  };

  app.get("/projects/:id/agent/runs", g.readGuard, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ runs: [], summary: null });
    const db = getDb();
    let rows = await db.select().from(agentRuns).where(and(eq(agentRuns.projectId, r.p.id), eq(agentRuns.repo, r.full))).orderBy(desc(agentRuns.createdAt)).limit(40);
    // Aktivne sesije osveži odmah (pozadinska provera ide i bez otvorene aplikacije)
    const active = rows.filter((x) => x.status === "queued" || x.status === "working").slice(0, 4);
    if (active.length) {
      await Promise.all(active.map((x) => syncAgentRun(db, x).catch(() => undefined)));
      rows = await db.select().from(agentRuns).where(and(eq(agentRuns.projectId, r.p.id), eq(agentRuns.repo, r.full))).orderBy(desc(agentRuns.createdAt)).limit(40);
    }
    const msgs = rows.length ? await db.select().from(agentMessages).where(inArray(agentMessages.runId, rows.map((x) => x.id))) : [];
    // Stanje PR-ova (spojen / zatvoren) jednim pozivom
    const tok = await ghToken(c);
    const states = new Map<number, string>();
    if (tok && rows.some((x) => x.prNumber)) {
      const pulls = await gh<Array<{ number: number; state: string; merged_at: string | null }>>(tok, `/repos/${r.full}/pulls?state=all&per_page=60&sort=created&direction=desc`).catch(() => []);
      for (const p of pulls) states.set(p.number, p.merged_at ? "merged" : p.state);
    }
    const runs = rows.map((x) => runView(x, msgs.filter((m) => m.runId === x.id), x.prNumber ? states.get(x.prNumber) : undefined));
    const month0 = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
    const thisMonth = runs.filter((x) => Date.parse(x.createdAt) >= month0);
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
    const sessions = msgs
      .filter((m) => m.role === "assistant" && m.createdAt.getTime() >= month0)
      .map((m) => {
        const run = runs.find((x) => x.id === m.runId)!;
        const n = (k: string) => (typeof m.meta[k] === "number" ? (m.meta[k] as number) : null);
        return { id: m.id, at: m.createdAt.toISOString(), minutes: Math.round((n("ms") ?? 0) / 60_000), status: "completed", conclusion: m.meta.ok ? "success" : "failure", url: typeof m.meta.url === "string" ? m.meta.url : "", tokens: n("in") !== null ? (n("in") ?? 0) + (n("out") ?? 0) : null, cost: n("cost"), turns: n("turns"), task: run?.title ?? "", runId: m.runId, by: run?.by ?? null, model: run?.model ?? "" };
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 40);
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
        sessions,
      },
    });
  });

  /** Razgovor iz baze (+ stanje PR-a sa GitHub-a). */
  const loadRun = async (c: Context) => {
    const r = await repoOf(c);
    const rid = c.req.param("rid") ?? "";
    if (!r || !UUID.test(rid)) return null;
    const [run] = await getDb().select().from(agentRuns).where(and(eq(agentRuns.id, rid), eq(agentRuns.projectId, r.p.id))).limit(1);
    return run ? { r, run } : null;
  };

  app.get("/projects/:id/agent/runs/:rid", g.readGuard, async (c) => {
    const found = await loadRun(c);
    if (!found) return c.json({ error: "Not found." }, 404);
    const db = getDb();
    const run = await syncAgentRun(db, found.run).catch(() => found.run);
    const msgs = await db.select().from(agentMessages).where(eq(agentMessages.runId, run.id)).orderBy(asc(agentMessages.createdAt));
    const tok = await ghToken(c);
    let pr: { number: number; url: string; title: string; state: string; branch: string; branchExists: boolean | null } | null = null;
    if (tok && run.prNumber) {
      const p = await gh<{ number: number; html_url: string; title: string; state: string; merged_at: string | null; head: { ref: string } }>(tok, `/repos/${run.repo}/pulls/${run.prNumber}`).catch(() => null);
      if (p) {
        const state = p.merged_at ? "merged" : p.state;
        const branchExists = state !== "open" ? (await ghFetch(tok, `/repos/${run.repo}/branches/${encRef(p.head.ref)}`)).ok : null;
        pr = { number: p.number, url: p.html_url, title: p.title, state, branch: p.head.ref, branchExists };
      }
    }
    return c.json({
      run: { ...runView(run, msgs, pr?.state), working: run.status === "queued" || run.status === "working", jobUrl: run.ghRunUrl },
      messages: msgs.map((m) => ({ id: m.id, role: m.role, body: m.body, author: m.author, createdAt: m.createdAt.toISOString(), meta: m.meta })),
      pr,
    });
  });

  /** Novi razgovor: red u bazi + prva poruka + pokretanje. */
  const createRun = async (c: Context, tok: string, r: { p: typeof projects.$inferSelect; full: string }, i: { prompt: string; model: Model | null; effort: unknown; images: unknown }) => {
    const blocked = await useMyClaude(c, tok, r.full);
    if (blocked) return { error: blocked, status: 400 };
    const first = i.prompt.split("\n")[0]!.replace(/\s+/g, " ").trim();
    const title = first.length > 90 ? `${first.slice(0, 87)}…` : first;
    const effort = pickEffort(i.effort, i.prompt);
    const model: Model = i.model ?? autoModel(effort);
    const images = await imageBlock(c, r.p.id, i.images);
    const db = getDb();
    const [run] = await db.insert(agentRuns).values({ projectId: r.p.id, repo: r.full, title, status: "queued", model, branch: `wip/${newId()}`, createdById: actor(c).id, createdBy: actor(c).name }).returning();
    await db.insert(agentMessages).values({ runId: run!.id, role: "user", body: `${i.prompt}${images}`, author: actor(c).name, meta: { model, effort } });
    try {
      await dispatchRun(c, tok, r, run!, { text: i.prompt, model, effort, images });
      return { id: run!.id, effort, effortAuto: !EFFORTS.includes(i.effort as Effort), model, modelAuto: !i.model };
    } catch (e) {
      await db.delete(agentRuns).where(eq(agentRuns.id, run!.id));
      return { error: (e as Error).message, status: (e as { status?: number }).status === 400 ? 400 : 502 };
    }
  };

  app.post("/projects/:id/agent/runs", member, async (c) => {
    const r = await repoOf(c);
    if (!r) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet — add yours in Settings → Integrations." }, 400);
    const input = (await c.req.json().catch(() => ({}))) as { prompt?: string; model?: string; effort?: string; images?: unknown };
    const prompt = (input.prompt ?? "").trim().slice(0, 8000);
    const chosenModel = MODELS.includes(input.model as Model) ? (input.model as Model) : null;
    if (prompt.length < 3) return c.json({ error: "Describe what Claude should do." }, 400);
    const out = await createRun(c, tok, r, { prompt, model: chosenModel, effort: input.effort, images: input.images });
    return "error" in out ? c.json({ error: out.error }, out.status as 400) : c.json(out, 201);
  });

  /** „Assign to Claude“ iz taska: brief taska → novi razgovor (ključ taska ide u naslov PR-a, pa se task sam veže). */
  app.post("/issues/:tid/claude", member, async (c) => {
    const tid = c.req.param("tid")!;
    if (!UUID.test(tid)) return c.json({ error: "Task not found." }, 404);
    const db = getDb();
    const [row] = await db.select({ t: tasks, p: projects }).from(tasks).innerJoin(projects, eq(tasks.projectId, projects.id)).where(eq(tasks.id, tid)).limit(1);
    if (!row) return c.json({ error: "Task not found." }, 404);
    const full = (await projectRepoNames(db, row.p))[0];
    if (!full) return c.json({ error: "Link a GitHub repo to the project first (Code tab)." }, 400);
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet — add yours in Settings → Integrations." }, 400);
    const key = `${row.p.key}-${row.t.number}`;
    const prompt = [`${key}: ${row.t.title}`, row.t.description?.trim() ? `\n${row.t.description.trim().slice(0, 5000)}` : "", row.t.labels.length ? `\nLabels: ${row.t.labels.join(", ")}` : ""].join("");
    const out = await createRun(c, tok, { p: row.p, full }, { prompt, model: null, effort: undefined, images: [] });
    if ("error" in out) return c.json({ error: out.error }, out.status as 400);
    if (row.t.status === "todo" || row.t.status === "backlog" || row.t.status === "triage") {
      await db.update(tasks).set({ status: "in_progress", agent: "claude", updatedAt: new Date() }).where(eq(tasks.id, tid));
      await db.insert(issueEvents).values({ issueId: tid, type: "status", data: { from: row.t.status, to: "in_progress", via: "Claude" }, actor: actor(c).name });
    } else await db.update(tasks).set({ agent: "claude", updatedAt: new Date() }).where(eq(tasks.id, tid));
    return c.json({ ...out, projectId: row.p.id, repo: full }, 201);
  });

  app.post("/projects/:id/agent/runs/:rid/reply", member, async (c) => {
    const found = await loadRun(c);
    if (!found) return c.json({ error: "Not found." }, 404);
    const { r, run } = found;
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "No GitHub token yet." }, 400);
    if (run.status === "queued" || run.status === "working") return c.json({ error: "Claude is still working on the last message — wait for the answer first." }, 409);
    const b = (await c.req.json().catch(() => ({}))) as { text?: string; model?: string; effort?: string; images?: unknown };
    const text = ((b.text ?? "").trim() || (Array.isArray(b.images) && b.images.length ? "See the attached image(s)." : "")).slice(0, 8000);
    if (!text) return c.json({ error: "Write a message for Claude." }, 400);
    const blocked = await useMyClaude(c, tok, r.full);
    if (blocked) return c.json({ error: blocked }, 400);
    const effort = pickEffort(b.effort, text);
    const model: Model = MODELS.includes(b.model as Model) ? (b.model as Model) : MODELS.includes(run.model as Model) ? (run.model as Model) : autoModel(effort);
    const images = await imageBlock(c, r.p.id, b.images);
    const db = getDb();
    const [msg] = await db.insert(agentMessages).values({ runId: run.id, role: "user", body: `${text}${images}`, author: actor(c).name, meta: { model, effort } }).returning();
    try {
      await dispatchRun(c, tok, r, run, { text, model, effort, images });
      return c.json({ ok: true, note: null });
    } catch (e) {
      await db.delete(agentMessages).where(eq(agentMessages.id, msg!.id));
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // „Obriši razgovor“: briše se iz Scoutline-a; grana i PR na GitHub-u ostaju
  app.post("/projects/:id/agent/runs/:rid/delete", member, async (c) => {
    const found = await loadRun(c);
    if (!found) return c.json({ error: "Not found." }, 404);
    await getDb().delete(agentRuns).where(eq(agentRuns.id, found.run.id));
    return c.json({ ok: true });
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

  return app;
}

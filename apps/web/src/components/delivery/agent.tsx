import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, CircleAlert, ExternalLink, GitMerge, GitPullRequest, Loader2, Play, RefreshCw, Send, Sparkles, Wrench } from "lucide-react";
import { useCached } from "../../lib/cache";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";
import { Dialog, ErrorNote, btnPrimary, btnSecondary } from "./parts";
import { CreateTasksButton } from "./tasks-from-text";
import { useHashParam, useOptionalHashParam } from "../../lib/hashParams";
import { AttachButton, AttachedThumbs, MessageImages, splitImages, useImageAttachments } from "./attachments";
import { askConfirm } from "../../lib/confirm";
import { VoiceButton } from "../../lib/voice";
import { PrFiles } from "./pr-files";
import { AskPanel, Md } from "./assistant";

/**
 * Faza 16 — Claude Code iz aplikacije: „Build with Claude“ (prompt → Claude radi u repou → PR),
 * praćenje sesija i odgovori Claude-u, potrošnja, i checklist za podešavanje repoa.
 */
interface Setup {
  repo: string;
  access: boolean;
  canPush: boolean;
  defaultBranch: string | null;
  workflow: "missing" | "outdated" | "ok";
  terminal?: "missing" | "outdated" | "ok";
  secret: boolean | null;
  claudeToken: "personal" | "workspace" | "server" | null;
  appInstallUrl: string;
  error?: string;
  notes?: string[];
}
interface Run {
  id: string;
  title: string;
  branch?: string;
  createdAt: string;
  by: string | null;
  status: "working" | "pr_open" | "merged" | "closed" | "failed" | "replied" | "queued";
  minutes: number;
  sessions: number;
  model?: string;
  pr: { number: number; url: string; title?: string; state: string; branch: string; branchExists?: boolean | null } | null;
}
interface Agg {
  runs: number;
  sessions?: number;
  minutes: number;
  tokens?: number;
  cost?: number;
}
interface Summary {
  month: { runs: number; sessions: number; minutes: number; prs: number; merged: number; tokensIn?: number; tokensOut?: number; cost?: number; turns?: number };
  byPerson: Record<string, Agg>;
  byModel?: Record<string, Agg>;
  sessions?: Array<{ id: number; at: string; minutes: number; status: string; conclusion: string | null; url: string; tokens: number | null; cost: number | null; turns: number | null; task: string; runId: string; by: string | null; model: string }>;
}
const fmtTok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const fmtUsd = (n: number) => (n >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);

/** Limit Claude plana kao na claude.ai → Usage: trenutna sesija i ova nedelja (procenat i reset). */
interface PlanUsage {
  available: boolean;
  reason?: string;
  owner?: string;
  session?: { pct: number; resetsAt: string | null } | null;
  week?: { pct: number; resetsAt: string | null } | null;
  opusWeek?: { pct: number; resetsAt: string | null } | null;
}
const resetIn = (iso: string | null | undefined, weekly = false) => {
  if (!iso) return weekly ? "" : "Starts with your first message";
  const d = new Date(iso);
  const mins = Math.round((d.getTime() - Date.now()) / 60_000);
  if (!weekly && mins > 0 && mins < 24 * 60) return `Resets in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}`;
  return `Resets ${d.toLocaleString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit" })}`;
};
function UsageBar({ s }: { s: Summary }) {
  const u = useCached<PlanUsage>("/delivery/claude/usage", { staleMs: 60_000, refreshMs: 120_000 });
  const [showSessions, setShowSessions] = useState(false);
  const d = u.data;
  const Row = ({ label, w, weekly }: { label: string; w: { pct: number; resetsAt: string | null }; weekly?: boolean }) => (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.5rem] items-center gap-3">
      <div className="min-w-0">
        <div className="text-[12.5px] text-fg">{label}</div>
        <div className="truncate text-[11px] text-faint">{resetIn(w.resetsAt, weekly)}</div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${w.pct >= 90 ? "bg-danger" : w.pct >= 70 ? "bg-warning" : "bg-accent"}`} style={{ width: `${Math.min(100, Math.max(w.pct ? 2 : 0, w.pct))}%` }} />
      </div>
      <div className="num text-right text-[12px] text-muted">{w.pct}% used</div>
    </div>
  );
  return (
    <div className="space-y-2 border-b border-line bg-bg px-4 py-2.5">
      {d?.available && (d.session || d.week) ? (
        <>
          {d.session && <Row label="Current session" w={d.session} />}
          {d.week && <Row label="This week" w={d.week} weekly />}
          {d.opusWeek && d.opusWeek.pct > 0 && <Row label="This week · Opus" w={d.opusWeek} weekly />}
        </>
      ) : d?.reason === "no_token" ? (
        <div className="text-[11.5px] text-faint">Add your Claude Code token in Settings → Integrations — Claude runs only on your own subscription.</div>
      ) : null}
      {/* Limiti plana (sesija / nedelja) dolaze samo ako ih Anthropic da za ovaj token; token iz `claude setup-token` ih ne dobija — tada samo pregled meseca */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
        <span>
          This month: {s.month.runs} tasks · {s.month.sessions} sessions · {s.month.merged} merged
        </span>
        {(s.sessions?.length ?? 0) > 0 && (
          <button type="button" onClick={() => setShowSessions(!showSessions)} className="ml-auto text-[11.5px] text-muted hover:text-fg">
            {showSessions ? "Hide sessions" : "Sessions"}
          </button>
        )}
      </div>
      {showSessions && s.sessions && (
        <div className="max-h-[280px] overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="px-2 py-1.5 font-normal">When</th>
                <th className="px-2 py-1.5 font-normal">Task</th>
                <th className="px-2 py-1.5 font-normal">Who</th>
                <th className="px-2 py-1.5 font-normal">Model</th>
                <th className="px-2 py-1.5 text-right font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {s.sessions.map((x) => (
                <tr key={x.id} className="border-t border-line">
                  <td className="num whitespace-nowrap px-2 py-1.5">
                    <a href={x.url} target="_blank" rel="noreferrer" className="hover:text-fg" title="Open the job log on GitHub">
                      {new Date(x.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </a>
                  </td>
                  <td className="max-w-[280px] truncate px-2 py-1.5 text-fg" title={x.task}>
                    {x.task}
                  </td>
                  <td className="px-2 py-1.5">{x.by ?? "—"}</td>
                  <td className="px-2 py-1.5 capitalize">{x.model}</td>
                  <td className="num px-2 py-1.5 text-right">
                    {x.status !== "completed" ? <span className="text-warning">running</span> : x.conclusion === "success" ? `${x.minutes} min` : <span className="text-danger">{x.conclusion ?? "failed"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  body: string;
  author: string | null;
  createdAt: string;
  meta: { ok?: boolean; url?: string; cost?: number | null; in?: number | null; out?: number | null; turns?: number | null; ms?: number | null; steps?: string[]; commits?: string[]; model?: string; effort?: string };
}
interface Thread {
  run: Run & { working: boolean; jobUrl: string | null };
  messages: Msg[];
  pr: Run["pr"];
}
const fmtMin = (ms?: number | null) => (!ms ? "" : ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)} min`);

const STATUS: Record<Run["status"], { label: string; cls: string }> = {
  working: { label: "Claude is working", cls: "bg-warning/15 text-warning" },
  queued: { label: "Starting…", cls: "bg-surface-2 text-muted" },
  replied: { label: "Replied", cls: "bg-accent-soft text-accent" },
  pr_open: { label: "PR ready", cls: "bg-success-soft text-success" },
  merged: { label: "Merged", cls: "bg-accent-soft text-accent" },
  failed: { label: "Failed", cls: "bg-danger/10 text-danger" },
  closed: { label: "Closed", cls: "bg-surface-2 text-muted" },
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
/** Claude-ov komentar: liste zadataka kao kvačice, bez praznih redova između stavki. */
const tidy = (md: string) =>
  md
    .replace(/^\*\*Claude (finished|is working)[^*]*\*\*[^\n]*\n?/i, "")
    .replace(/<details><summary>Project context from Scoutline<\/summary>[\s\S]*?<\/details>/, "")
    .replace(/^\s*[·•]\s*\[?\s*`?branch\b[^\n]*$/gim, "")
    .replace(/^\s*[·•]?\s*\[?`?[\w.-]+\/issue-\d+-\d{8}-\d{4}`?\]?(\([^)\s]*\))?\s*$/gim, "")
    .replace(/\s*•?\s*\[Create PR ➔\]\([^)]*\)/g, "")
    .replace(/^(\s*)[-*] \[x\]\s*/gim, "$1✓ ")
    .replace(/^(\s*)[-*] \[ \]\s*/gm, "$1○ ")
    .replace(/\n{3,}/g, "\n\n");
/** Zaglavlje Claude-ovog komentara: „Claude finished … in 11s — View job“ → kratko i sa linkom. */
const headOf = (md: string) => {
  const m = /^\*\*Claude (finished|is working)[^*]*?(?:in ([^*]+?))?\*\*[^\n]*?(?:\[View job\]\((https?:[^)\s]+)\))?/i.exec(md);
  return m ? { done: /finished/i.test(m[1]!), took: m[2]?.trim() ?? null, job: m[3] ?? null } : null;
};
const MODEL_OPTIONS = [
  ["", "Model: Auto"],
  ["sonnet", "Sonnet"],
  ["opus", "Opus · strongest"],
  ["haiku", "Haiku · fastest"],
] as const;
const savedModel = () => {
  try {
    return localStorage.getItem("claude-model") ?? "";
  } catch {
    return "";
  }
};
function ModelSelect({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        try {
          localStorage.setItem("claude-model", e.target.value);
        } catch {
          /* ništa */
        }
      }}
      className={`h-[34px] min-w-0 rounded-md border border-line bg-surface px-2 text-[12.5px] ${className}`}
      aria-label="Claude model"
      title="Model for this task. Opus is strongest (uses more of your subscription), Haiku is fastest."
    >
      {MODEL_OPTIONS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
const EFFORT_OPTIONS = [
  ["", "Effort: Auto"],
  ["low", "Effort: Low"],
  ["medium", "Effort: Medium"],
  ["high", "Effort: High"],
  ["max", "Effort: Max"],
] as const;
const savedEffort = () => {
  try {
    return localStorage.getItem("claude-effort") ?? "";
  } catch {
    return "";
  }
};
/** Koliko Claude razmišlja pre rada. Auto: pitanje → Low, rad → Medium, redizajn/refaktor → High. */
function EffortSelect({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        try {
          localStorage.setItem("claude-effort", e.target.value);
        } catch {
          /* ništa */
        }
      }}
      className={`h-[34px] min-w-0 rounded-md border border-line bg-surface px-2 text-[12.5px] ${className}`}
      aria-label="Effort"
      title="How hard Claude thinks before working. Auto picks it from the task: questions → Low, normal work → Medium, redesigns and refactors → High. Higher = better results, slower, uses more of your subscription."
    >
      {EFFORT_OPTIONS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
/** Dugme samo sa ikonicom, iste visine kao polja (34px). */
const iconBtn = "inline-grid size-[34px] shrink-0 place-items-center rounded-md border border-line bg-surface text-muted hover:text-fg [&>span]:hidden";
const repoQ = (repo: string) => `repo=${encodeURIComponent(repo)}`;
/** Pregled grane u StackBlitz-u (aplikacije sa build korakom). */
export const previewUrl = (repo: string, branch: string) => `https://stackblitz.com/github/${repo}/tree/${encodeURIComponent(branch)}`;

/** Potpisan link za ugrađeni pregled sajta iz repoa (Scoutline, bez spoljnog servisa). */
export const makePreview = (projectId: string, repo: string, ref?: string) =>
  teamFetch<{ url: string }>(`/delivery/projects/${projectId}/preview?${repoQ(repo)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`, { method: "POST", body: "{}" }).then((d) => d.url);

/** Dugme „Preview“: otvara sajt iz te grane u novom tabu (prozor se otvara odmah, da ga pregledač ne blokira). */
export function PreviewButton({ projectId, repo, branch, className, children }: { projectId: string; repo: string; branch?: string; className?: string; children?: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={className ?? btnSecondary}
      title="Opens this version of the website in a new tab (plain HTML/CSS/JS sites)"
      onClick={async () => {
        const w = window.open("about:blank", "_blank");
        setBusy(true);
        try {
          const url = await makePreview(projectId, repo, branch);
          if (w) w.location.href = url;
          else window.open(url, "_blank");
        } catch (e) {
          w?.close();
          window.alert((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {children ?? "Preview"}
    </button>
  );
}

// ── „Work locally“: Claude Code na tvom računaru (interaktivno), lokalni pregled, pa PR → main ──
export function LocalWorkDialog({ open, onClose, projectId, repo, issueId, prompt, model: initialModel, effort: initialEffort }: { open: boolean; onClose: () => void; projectId: string; repo?: string; issueId?: string; prompt?: string; model?: string; effort?: string }) {
  const [d, setD] = useState<{ branch: string; main: string; folder: string; command: string; task: string | null; effort?: string } | null>(null);
  const [model, setModel] = useState(initialModel ?? savedModel());
  const [effort, setEffort] = useState(initialEffort ?? savedEffort());
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open) return;
    setD(null);
    setErr(null);
    teamFetch<NonNullable<typeof d>>(`/delivery/projects/${projectId}/local${repo ? `?${repoQ(repo)}` : ""}`, { method: "POST", body: JSON.stringify({ issueId, prompt, model: model || undefined, effort: effort || undefined }) })
      .then(setD)
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model, effort]);
  return (
    <Dialog open={open} onClose={onClose} title="Work locally with Claude Code" width={680}>
      <div className="space-y-3 px-4 py-4 text-[13px]">
        <p className="text-muted">Claude Code runs on your computer, in your terminal — you talk to it directly and see the site live on localhost. When it's done it opens a pull request, and you merge it here into {d?.main ?? "main"}.</p>
        {err && <ErrorNote>{err}</ErrorNote>}
        {!d && !err && <div className="h-40 animate-pulse rounded-lg bg-surface-2" />}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-muted">Branch</span>
              <code className="num rounded bg-surface-2 px-1.5 py-0.5 text-fg">{d.branch}</code>
              <span className="text-faint">from {d.main}</span>
              {d.task && <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] text-accent">{d.task} → In progress</span>}
              <span className="ml-auto flex gap-2">
                <ModelSelect value={model} onChange={setModel} />
                <EffortSelect value={effort} onChange={setEffort} />
              </span>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-muted">
              <li>Copy the command and paste it into Terminal. It gets the code into <code className="num text-fg">{d.folder}</code>, creates the branch and starts Claude with the task and the project's plan.</li>
              <li>Work with Claude there. It starts a local preview (e.g. <code className="num">localhost:3000</code>) — open it and ask for changes.</li>
              <li>Say <b className="text-fg">“done, push and open the PR”</b>. The PR shows up in Scoutline (Code → Pull requests and on the task) — review, Preview, Merge → {d.main}. The task moves to Done.</li>
            </ol>
            <pre className="num max-h-56 overflow-auto rounded-lg border border-line bg-bg p-3 text-[11.5px] leading-relaxed text-fg">{d.command.split("\n").slice(0, 5).join("\n")}{"\n"}…</pre>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(d.command);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
                className={btnPrimary}
              >
                {copied ? <Check size={14} /> : <Play size={14} />} {copied ? "Copied — paste into Terminal" : "Copy command"}
              </button>
              <span className="text-[11.5px] text-faint">Needs Git, the GitHub CLI signed in (<code className="num">gh auth login</code>) and Claude Code (<code className="num">claude</code>).</span>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ── Checklist: šta treba da bi Claude radio na repou ──
/**
 * Stanje Claude-a na repou. `quiet`: kad je sve podešeno ne prikazuje ništa (Ask AI);
 * `chip`: mala oznaka „Claude ready“ koja na klik otvara detalje (Code tab); `compact`: traka.
 */
export function ClaudeSetup({ projectId, repo, compact, quiet, chip }: { projectId: string; repo: string; compact?: boolean; quiet?: boolean; chip?: boolean }) {
  const user = useSessionUser();
  const s = useCached<Setup>(`/delivery/projects/${projectId}/agent/setup?${repoQ(repo)}`, { staleMs: 30_000 });
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const d = s.data;
  const ready = !!d && d.access && d.workflow === "ok" && d.secret !== false && d.terminal !== "missing";
  const run = async () => {
    setBusy(true);
    setNotes([]);
    try {
      const r = await teamFetch<Setup>(`/delivery/projects/${projectId}/agent/setup?${repoQ(repo)}`, { method: "POST", body: "{}" });
      s.setData(() => r);
      setNotes(r.notes ?? []);
    } catch (e) {
      setNotes([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };
  if (s.error) return <ErrorNote>{s.error}</ErrorNote>;
  if (!d) return quiet ? null : chip ? <span className="h-[28px] w-28 animate-pulse rounded-full bg-surface-2" /> : <div className="h-12 animate-pulse rounded-xl bg-surface-2" />;
  if (ready && quiet && !open) return null;
  if (ready && chip && !open)
    return (
      <button onClick={() => setOpen(true)} className="inline-flex h-[28px] items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-[12px] font-medium text-success hover:opacity-90" title="Claude is set up on this repo — click for details">
        <Check size={12} strokeWidth={3} /> Claude ready
      </button>
    );
  if (ready && compact && !open)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-success-soft/40 px-3 py-2 text-[12.5px]">
        <Check size={14} className="text-success" /> Claude is set up on <span className="num">{d.repo}</span>
        <button onClick={() => setOpen(true)} className="ml-auto text-[12px] text-muted hover:text-fg">
          Details
        </button>
      </div>
    );
  const Row = ({ ok, warn, title, hint }: { ok: boolean | null; warn?: boolean; title: string; hint?: React.ReactNode }) => (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full ${ok ? "bg-success-soft text-success" : warn ? "bg-warning/15 text-warning" : "bg-danger/10 text-danger"}`}>{ok ? <Check size={11} strokeWidth={3} /> : <CircleAlert size={11} />}</span>
      <span className="min-w-0">
        <span className="block text-[13px]">{title}</span>
        {hint && <span className="block text-[12px] text-faint">{hint}</span>}
      </span>
    </li>
  );
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${chip ? "order-last w-full basis-full bg-bg" : ""}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Bot size={15} className="text-accent" />
        <span className="text-[13.5px] font-semibold">Claude on {d.repo}</span>
        <span className={`rounded-full px-2 py-px text-[11px] ${ready ? "bg-success-soft text-success" : "bg-warning/15 text-warning"}`}>{ready ? "Ready" : "Needs setup"}</span>
        <button onClick={() => void s.reload()} className="ml-auto text-faint hover:text-fg" aria-label="Check again" title="Check again">
          <RefreshCw size={13} className={s.refreshing ? "animate-spin" : ""} />
        </button>
        {(compact || chip || quiet) && ready && (
          <button onClick={() => setOpen(false)} className="text-[12px] text-muted hover:text-fg">
            Hide
          </button>
        )}
      </div>
      <ul className="space-y-2">
        <Row ok={d.access} title={d.access ? "Scoutline can reach the repo" : "Scoutline can't reach the repo"} hint={!d.access ? (d.error ?? "Add this repo to your GitHub token's access (Settings → Integrations).") : !d.canPush ? "Read-only access — the token needs write access." : undefined} />
        <Row ok={d.workflow === "ok"} title={d.workflow === "ok" ? "Automation is in the repo" : d.workflow === "outdated" ? "Automation is an older version" : "Automation is missing"} hint={d.workflow !== "ok" ? "“Set up automatically” adds .github/workflows/scoutline-agent.yml. Nothing on GitHub mentions AI: no issues or bot comments, commits are under your name and Scoutline opens the PR." : undefined} />
        <Row ok={d.terminal === "ok"} warn={d.terminal === "outdated"} title={d.terminal === "ok" ? "Terminal is set up" : "Terminal workflow is missing"} hint={d.terminal !== "ok" ? "Adds .github/workflows/scoutline-terminal.yml so you can run commands from Code → Terminal." : undefined} />
        <Row
          ok={d.secret === true}
          warn={d.secret === null}
          title={d.secret ? "Claude Code token is in the repo secrets" : d.secret === null ? "Can't check the repo secret" : "Claude Code token is missing in the repo"}
          hint={
            d.secret
              ? undefined
              : d.claudeToken
                ? d.secret === null
                  ? "Your GitHub token has no “Secrets” permission — add it, or set CLAUDE_CODE_OAUTH_TOKEN in the repo settings by hand."
                  : "“Set up automatically” copies your saved Claude Code token into the repo."
                : (
                    <>
                      Save your Claude Code token first: run <code className="num">claude setup-token</code>, then paste it in{" "}
                      <a href="#/settings/integrations" className="underline">
                        Settings → Integrations
                      </a>
                      .
                    </>
                  )
          }
        />
      </ul>
      {canEdit(user) && !ready && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => void run()} disabled={busy || !d.access} className={btnPrimary}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />} Set up automatically
          </button>
          <span className="text-[12px] text-faint">Writes the workflow file and the secret for you.</span>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {notes.map((n) => (
            <li key={n} className="text-[12px] text-warning">
              {n}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Ask AI na projektu: „Build with Claude“ (radi u repou) ili „Ask“ (samo odgovara) ──
export function ProjectAI({ projectId, hasRepo }: { projectId: string; hasRepo: boolean }) {
  const [mode, setMode] = useHashParam<"build" | "ask">("ai", hasRepo ? "build" : "ask", ["build", "ask"]);
  const seg = (on: boolean) => `inline-flex h-[28px] flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[12.5px] sm:flex-none ${on ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`;
  return (
    <div className="space-y-3">
      <div className="flex w-full rounded-lg border border-line bg-surface p-0.5 sm:inline-flex sm:w-auto">
        <button className={seg(mode === "build")} onClick={() => setMode("build")}>
          <Sparkles size={13} /> Build with Claude
        </button>
        <button className={seg(mode === "ask")} onClick={() => setMode("ask")}>
          Ask a question
        </button>
      </div>
      {mode === "ask" ? <AskPanel projectId={projectId} hasRepo={hasRepo} /> : hasRepo ? <BuildPanel projectId={projectId} /> : <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center text-[13px] text-muted">Link a GitHub repo first (Code tab) — then Claude can make changes and open pull requests from here.</div>}
    </div>
  );
}

function BuildPanel({ projectId }: { projectId: string }) {
  const user = useSessionUser();
  const repos = useCached<{ repos: Array<{ full: string; label: string | null; primary: boolean }> }>(`/delivery/projects/${projectId}/repos`, { staleMs: 30_000 });
  const [repo, setRepo] = useState("");
  useEffect(() => {
    const list = repos.data?.repos ?? [];
    if (list.length && !list.some((r) => r.full === repo)) setRepo(list[0]!.full);
  }, [repos.data, repo]);
  const [anyWorking, setAnyWorking] = useState(false);
  const runs = useCached<{ runs: Run[]; summary: Summary | null; error?: string }>(repo ? `/delivery/projects/${projectId}/agent/runs?${repoQ(repo)}` : null, { staleMs: 5_000, refreshMs: anyWorking ? 15_000 : 60_000 });
  useEffect(() => setAnyWorking(!!runs.data?.runs.some((r) => r.status === "working" || r.status === "queued")), [runs.data]);
  const [sel, setSel] = useOptionalHashParam("run"); // otvoren razgovor ostaje i posle osvežavanja
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(savedModel);
  const [effort, setEffort] = useState(savedEffort);
  const [localOpen, setLocalOpen] = useState(false);
  const att = useImageAttachments(projectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const start = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await teamFetch<{ id: string; note?: string | null; effort?: string; effortAuto?: boolean; model?: string; modelAuto?: boolean }>(`/delivery/projects/${projectId}/agent/runs?${repoQ(repo)}`, { method: "POST", body: JSON.stringify({ prompt, model: model || undefined, effort: effort || undefined, images: att.ids }) });
      setPrompt("");
      att.clear();
      const cap = (x: string) => `${x[0]!.toUpperCase()}${x.slice(1)}`;
      const auto = [r.modelAuto && "model", r.effortAuto && "effort"].filter(Boolean).join(" and ");
      setNote([r.model ? `Model: ${cap(r.model)}` : "", r.effort ? `Effort: ${cap(r.effort)}` : ""].filter(Boolean).join(" · ") + (auto ? ` (${auto} picked automatically).` : ".") + (r.note ? ` ${r.note}` : ""));
      setSel(r.id);
      await runs.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const summary = runs.data?.summary;
  return (
    <div className="space-y-3">
      {repo && <ClaudeSetup projectId={projectId} repo={repo} quiet />}
      <section className="rounded-xl border border-line bg-surface">
        {(repos.data?.repos.length ?? 0) > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="text-[12.5px] text-muted">Repository</span>
            <select value={repo} onChange={(e) => (setRepo(e.target.value), setSel(null))} className="ml-auto h-[28px] rounded-md border border-line bg-bg px-2 text-[12.5px]" aria-label="Repository">
              {repos.data!.repos.map((r) => (
                <option key={r.full} value={r.full}>
                  {r.full}
                  {r.label ? ` · ${r.label}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {summary && <UsageBar s={summary} />}
        {canEdit(user) && (
          <form
            className="border-b border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
            {...att.dropProps}
          >
            <div className="relative">
              <textarea
                value={prompt}
                onPaste={att.onPaste}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), void start())}
                placeholder="What should Claude build or fix? e.g. “Add a contact page with a map and opening hours, mobile friendly.” — paste a screenshot with ⌘V, or talk"
                className="h-24 w-full resize-none rounded-lg border border-line bg-bg px-3 pb-10 pt-2 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60"
              />
              <VoiceButton value={prompt} onChange={setPrompt} size="sm" className="absolute bottom-2 right-2" />
            </div>
            {att.items.length > 0 && (
              <div className="mt-2">
                <AttachedThumbs items={att.items} onRemove={att.remove} />
              </div>
            )}
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-2">
                <AttachButton onFiles={att.add} className={iconBtn} />
                <ModelSelect value={model} onChange={setModel} className="flex-1 sm:flex-none" />
                <EffortSelect value={effort} onChange={setEffort} className="flex-1 sm:flex-none" />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
                <button type="button" disabled={prompt.trim().length < 3 || !repo} onClick={() => setLocalOpen(true)} className={btnSecondary} title="Run Claude Code on your computer instead of GitHub — live preview on localhost">
                  Work locally
                </button>
                <button disabled={busy || prompt.trim().length < 3 || !repo || att.uploading} className={btnPrimary} title={att.uploading ? "Uploading image…" : undefined}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Start
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-faint">
              <span className="hidden sm:inline">⌘ Enter to start · </span>Runs on your Claude subscription via GitHub Actions — usually 3–15 min.
            </p>
            {note && <p className="mt-1.5 text-[12px] text-muted">{note}</p>}
            {error && (
              <div className="mt-2">
                <ErrorNote>{error}</ErrorNote>
              </div>
            )}
          </form>
        )}
        <LocalWorkDialog open={localOpen} onClose={() => setLocalOpen(false)} projectId={projectId} repo={repo} prompt={prompt} model={model} effort={effort} />
        {runs.data?.error || runs.error ? (
          <div className="p-3">
            <ErrorNote>{runs.data?.error ?? runs.error}</ErrorNote>
          </div>
        ) : !runs.data ? (
          <div className="space-y-2 p-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ) : runs.data.runs.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12.5px] text-faint">No Claude tasks yet. Describe one above — you'll follow it here.</div>
        ) : (
          <ul className="divide-y divide-line">
            {runs.data.runs.map((r) => (
              <li key={r.id}>
                <button onClick={() => setSel(sel === r.id ? null : r.id)} className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-surface-2 ${sel === r.id ? "bg-surface-2" : ""}`}>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.title}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] ${STATUS[r.status].cls}`}>
                    {r.status === "working" && <Loader2 size={10} className="animate-spin" />}
                    {STATUS[r.status].label}
                  </span>
                  <span className="w-full text-[11.5px] text-faint sm:w-auto">
                    {r.by ?? "—"} · {ago(r.createdAt)}
                    {r.model && r.model !== "default" ? ` · ${r.model[0]!.toUpperCase()}${r.model.slice(1)}` : ""}
                    {r.minutes ? ` · ${r.minutes} min` : ""}
                  </span>
                </button>
                {sel === r.id && (
                  <RunThread
                    projectId={projectId}
                    repo={repo}
                    run={r}
                    onChanged={() => void runs.reload()}
                    onDeleted={() => {
                      setSel(null);
                      runs.setData((d) => (d ? { ...d, runs: d.runs.filter((x) => x.id !== r.id) } : d));
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunThread({ projectId, repo, run, onChanged, onDeleted }: { projectId: string; repo: string; run: Run; onChanged: () => void; onDeleted: () => void }) {
  const user = useSessionUser();
  const [live, setLive] = useState(run.status === "working" || run.status === "queued");
  const t = useCached<Thread>(`/delivery/projects/${projectId}/agent/runs/${run.id}?${repoQ(repo)}`, { staleMs: 3_000, refreshMs: live ? 10_000 : 0 });
  const working = t.data?.run.working ?? live;
  useEffect(() => {
    if (t.data) setLive(t.data.run.working);
  }, [t.data]);
  // Kad Claude završi, osveži i listu (status, PR)
  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current && !working) onChanged();
    wasWorking.current = working;
  }, [working, onChanged]);
  const [reply, setReply] = useState("");
  const att = useImageAttachments(projectId);
  const [model, setModel] = useState<string | null>(null); // null = isti kao do sad
  const [effort, setEffort] = useState(savedEffort);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => t.data?.messages ?? [], [t.data]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  const pr = t.data?.pr ?? run.pr;

  const send = async () => {
    if (!reply.trim() && !att.ids.length) return;
    setBusy("reply");
    setMsg(null);
    try {
      const r = await teamFetch<{ note?: string | null }>(`/delivery/projects/${projectId}/agent/runs/${run.id}/reply?${repoQ(repo)}`, { method: "POST", body: JSON.stringify({ text: reply, ...(model !== null ? { model } : {}), effort: effort || undefined, images: att.ids }) });
      setReply("");
      att.clear();
      setMsg({ ok: true, text: r.note ?? "Sent — Claude picks it up in a minute." });
      setLive(true);
      await t.reload();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const merge = async () => {
    if (!pr || !(await askConfirm({ title: `Merge pull request #${pr.number}?`, message: `Changes go into the main branch.\nBranch ${pr.branch} will be deleted on GitHub after merging.`, confirmLabel: "Merge" }))) return;
    setBusy("merge");
    setMsg(null);
    try {
      const r = await teamFetch<{ message?: string }>(`/delivery/projects/${projectId}/pulls/${pr.number}/merge?${repoQ(repo)}`, { method: "POST", body: JSON.stringify({ deleteBranch: true }) });
      setMsg({ ok: true, text: r.message ?? "Merged." });
      await t.reload();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 border-t border-line bg-bg px-4 py-3">
      {pr && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px]">
          {pr.state === "merged" ? <GitMerge size={14} className="text-accent" /> : <GitPullRequest size={14} className={pr.state === "open" ? "text-success" : "text-faint"} />}
          <a href={pr.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 basis-[60%] truncate hover:underline">
            <span className="num text-faint">#{pr.number}</span> {pr.title ?? pr.branch}
          </a>
          <PreviewButton projectId={projectId} repo={repo} branch={pr.branch} />
          <a href={previewUrl(repo, pr.branch)} target="_blank" rel="noreferrer" className="text-[12px] text-muted hover:text-fg" title="For apps with a build step (React, Next…)">
            StackBlitz ↗
          </a>
          {pr.state !== "open" && pr.branchExists && canEdit(user) && (
            <button
              onClick={async () => {
                if (!await askConfirm(`Delete branch ${pr.branch} on GitHub?`)) return;
                setBusy("branch");
                setMsg(null);
                try {
                  await teamFetch(`/delivery/projects/${projectId}/branches?${repoQ(repo)}&name=${encodeURIComponent(pr.branch)}`, { method: "DELETE" });
                  setMsg({ ok: true, text: `Deleted branch ${pr.branch} on GitHub.` });
                  await t.reload();
                } catch (e) {
                  setMsg({ ok: false, text: (e as Error).message });
                } finally {
                  setBusy(null);
                }
              }}
              disabled={!!busy}
              className={btnSecondary}
            >
              {busy === "branch" ? <Loader2 size={13} className="animate-spin" /> : null} Delete branch
            </button>
          )}
          {pr.state === "open" && canEdit(user) && (
            <button onClick={() => void merge()} disabled={!!busy} className={btnPrimary}>
              {busy === "merge" ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />} Merge
            </button>
          )}
        </div>
      )}
      {pr && <PrFiles projectId={projectId} repo={repo} number={pr.number} className="-mt-1" />}
      <div className="max-h-[460px] space-y-2.5 overflow-y-auto">
        {messages.map((m) =>
          m.role === "assistant" ? (
            <div key={m.id} className="max-w-[95%] rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2">
              <div className="mb-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
                <Bot size={12} className="text-accent" /> Claude · {ago(m.createdAt)}
                {m.meta.ms ? <span>· took {fmtMin(m.meta.ms)}</span> : null}
                {m.meta.ok === false && <span className="text-danger">· stopped</span>}
                {m.meta.url && (
                  <a href={m.meta.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-faint hover:text-fg" title="Job log on GitHub">
                    log <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <div className="text-[13px]">
                <Md text={tidy(m.body)} />
              </div>
              {(m.meta.commits?.length || m.meta.steps?.length) ? (
                <details className="mt-1.5 text-[12px] text-muted">
                  <summary className="cursor-pointer select-none hover:text-fg">
                    {[m.meta.commits?.length ? `${m.meta.commits.length} commit${m.meta.commits.length > 1 ? "s" : ""}` : "", m.meta.steps?.length ? `${m.meta.steps.length} steps` : ""].filter(Boolean).join(" · ")}
                  </summary>
                  {m.meta.commits?.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {m.meta.commits.map((c, k) => (
                        <li key={k} className="flex gap-1.5">
                          <GitMerge size={11} className="mt-[3px] shrink-0 text-faint" /> <span className="text-fg">{c}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.meta.steps?.length ? (
                    <ul className="num mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-faint">
                      {m.meta.steps.map((st, k) => (
                        <li key={k} className="truncate">
                          {st}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </details>
              ) : null}
              {canEdit(user) && (
                <div className="mt-1.5 border-t border-line pt-1.5">
                  <CreateTasksButton projectId={projectId} text={tidy(m.body)} />
                </div>
              )}
            </div>
          ) : (
            <div key={m.id} className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13px]">
              <div className="mb-0.5 text-[11px] text-muted">
                {m.author ?? "You"} · {ago(m.createdAt)}
              </div>
              {(() => {
                const parts = splitImages(m.body.replace(/\n*<sub>Images: download[\s\S]*?<\/sub>/, ""));
                return (
                  <>
                    {parts.text && <div className="whitespace-pre-wrap">{parts.text}</div>}
                    <MessageImages urls={parts.images} />
                  </>
                );
              })()}
            </div>
          ),
        )}
        {!t.data && <div className="h-16 animate-pulse rounded-lg bg-surface-2" />}
        {working && (
          <div className="inline-flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 size={13} className="animate-spin" /> Claude is working — this updates by itself.
          </div>
        )}
        <div ref={end} />
      </div>
      {canEdit(user) && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          {...att.dropProps}
        >
          {att.items.length > 0 && (
            <div className="w-full">
              <AttachedThumbs items={att.items} onRemove={att.remove} />
            </div>
          )}
          <div className="relative w-full min-w-0 sm:w-auto sm:flex-1">
            <input value={reply} onPaste={att.onPaste} onChange={(e) => setReply(e.target.value)} placeholder={pr?.state === "open" ? "Ask Claude to change something in this PR…" : "Reply to Claude — e.g. “go ahead and build it”"} className="h-[38px] w-full min-w-0 rounded-lg border border-line bg-surface pl-3 pr-[72px] text-[13px] outline-none placeholder:text-faint focus:border-accent/60" />
            <VoiceButton value={reply} onChange={setReply} size="sm" className="absolute right-1 top-1/2 -translate-y-1/2" />
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <AttachButton onFiles={att.add} className={iconBtn} />
            <ModelSelect value={model ?? t.data?.run.model ?? ""} onChange={setModel} className="flex-1 sm:flex-none" />
            <EffortSelect value={effort} onChange={setEffort} className="flex-1 sm:flex-none" />
            <button disabled={busy === "reply" || (!reply.trim() && !att.ids.length) || att.uploading} className={`${btnPrimary} w-[42px] shrink-0 px-0`} aria-label="Send to Claude">
              {busy === "reply" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </form>
      )}
      {msg && <p className={`text-[12px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-faint">
        {t.data?.run.jobUrl && (
          <a href={t.data.run.jobUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
            Job log <ExternalLink size={11} />
          </a>
        )}
        {canEdit(user) && (
          <button
            onClick={async () => {
              if (!await askConfirm("Delete this conversation? It's removed from Scoutline. The branch and any pull request stay on GitHub.")) return;
              setBusy("delete");
              try {
                await teamFetch(`/delivery/projects/${projectId}/agent/runs/${run.id}/delete?${repoQ(repo)}`, { method: "POST", body: "{}" });
                onDeleted();
              } catch (e) {
                setMsg({ ok: false, text: (e as Error).message });
                setBusy(null);
              }
            }}
            disabled={!!busy}
            className="ml-auto hover:text-danger"
          >
            {busy === "delete" ? "Deleting…" : "Delete conversation"}
          </button>
        )}
      </div>
    </div>
  );
}

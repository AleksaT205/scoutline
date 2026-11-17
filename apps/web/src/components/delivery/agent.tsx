import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, CircleAlert, ExternalLink, GitMerge, GitPullRequest, Loader2, Play, RefreshCw, Send, Sparkles, Wrench } from "lucide-react";
import { useCached } from "../../lib/cache";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";
import { ErrorNote, btnPrimary, btnSecondary } from "./parts";
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
  secret: boolean | null;
  claudeToken: "personal" | "workspace" | "server" | null;
  appInstallUrl: string;
  error?: string;
  notes?: string[];
}
interface Run {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  by: string | null;
  status: "working" | "pr_open" | "merged" | "closed" | "failed" | "replied" | "queued";
  minutes: number;
  sessions: number;
  pr: { number: number; url: string; title: string; state: string; branch: string } | null;
}
interface Thread {
  issue: { number: number; title: string; body: string; url: string; state: string; createdAt: string; by: string | null };
  comments: Array<{ id: number; where: "issue" | "pr"; author: string; bot: boolean; body: string; createdAt: string; updatedAt: string; url: string }>;
  pr: Run["pr"];
}

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
    .replace(/^(\s*)[-*] \[x\]\s*/gim, "$1✓ ")
    .replace(/^(\s*)[-*] \[ \]\s*/gm, "$1○ ")
    .replace(/\n{3,}/g, "\n\n");
const repoQ = (repo: string) => `repo=${encodeURIComponent(repo)}`;
/** Pregled grane u browseru (bez deploy-a). */
export const previewUrl = (repo: string, branch: string) => `https://stackblitz.com/github/${repo}/tree/${encodeURIComponent(branch)}`;

// ── Checklist: šta treba da bi Claude radio na repou ──
export function ClaudeSetup({ projectId, repo, compact }: { projectId: string; repo: string; compact?: boolean }) {
  const user = useSessionUser();
  const s = useCached<Setup>(`/delivery/projects/${projectId}/agent/setup?${repoQ(repo)}`, { staleMs: 30_000 });
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const d = s.data;
  const ready = !!d && d.access && d.workflow === "ok" && d.secret !== false;
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
  if (!d) return <div className="h-12 animate-pulse rounded-xl bg-surface-2" />;
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
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Bot size={15} className="text-accent" />
        <span className="text-[13.5px] font-semibold">Claude on {d.repo}</span>
        <span className={`rounded-full px-2 py-px text-[11px] ${ready ? "bg-success-soft text-success" : "bg-warning/15 text-warning"}`}>{ready ? "Ready" : "Needs setup"}</span>
        <button onClick={() => void s.reload()} className="ml-auto text-faint hover:text-fg" aria-label="Check again" title="Check again">
          <RefreshCw size={13} className={s.refreshing ? "animate-spin" : ""} />
        </button>
      </div>
      <ul className="space-y-2">
        <Row ok={d.access} title={d.access ? "Scoutline can reach the repo" : "Scoutline can't reach the repo"} hint={!d.access ? (d.error ?? "Add this repo to your GitHub token's access (Settings → Integrations).") : !d.canPush ? "Read-only access — the token needs write access." : undefined} />
        <Row ok={d.workflow === "ok"} title={d.workflow === "ok" ? "Claude workflow is in the repo" : d.workflow === "outdated" ? "Claude workflow is an older version" : "Claude workflow is missing"} hint={d.workflow !== "ok" ? "“Set up automatically” adds .github/workflows/claude.yml (opens pull requests, no co-author lines)." : undefined} />
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
        <Row
          ok={null}
          warn
          title="Claude GitHub app installed on the repo"
          hint={
            <>
              GitHub doesn't let us check this.{" "}
              <a href={d.appInstallUrl} target="_blank" rel="noreferrer" className="underline">
                Install or configure the app
              </a>{" "}
              — pick “All repositories” once and new repos just work.
            </>
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
  const [mode, setMode] = useState<"build" | "ask">(() => (hasRepo ? "build" : "ask"));
  const seg = (on: boolean) => `inline-flex h-[28px] items-center gap-1.5 rounded-md px-3 text-[12.5px] ${on ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`;
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
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
  const runs = useCached<{ runs: Run[]; summary: { month: { runs: number; sessions: number; minutes: number; prs: number; merged: number }; byPerson: Record<string, { runs: number; minutes: number }> } | null; error?: string }>(repo ? `/delivery/projects/${projectId}/agent/runs?${repoQ(repo)}` : null, { staleMs: 5_000, refreshMs: anyWorking ? 15_000 : 60_000 });
  useEffect(() => setAnyWorking(!!runs.data?.runs.some((r) => r.status === "working" || r.status === "queued")), [runs.data]);
  const [sel, setSel] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const start = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await teamFetch<{ number: number; note?: string | null }>(`/delivery/projects/${projectId}/agent/runs?${repoQ(repo)}`, { method: "POST", body: JSON.stringify({ prompt }) });
      setPrompt("");
      setNote(r.note ?? null);
      setSel(r.number);
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
      {repo && <ClaudeSetup projectId={projectId} repo={repo} compact />}
      <section className="rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Sparkles size={15} className="text-accent" />
          <span className="text-[13.5px] font-medium">Build with Claude</span>
          <span className="hidden text-[12px] text-faint sm:inline">Claude works in the repo on GitHub and opens a pull request</span>
          {(repos.data?.repos.length ?? 0) > 1 && (
            <select value={repo} onChange={(e) => (setRepo(e.target.value), setSel(null))} className="ml-auto h-[28px] rounded-md border border-line bg-bg px-2 text-[12.5px]" aria-label="Repository">
              {repos.data!.repos.map((r) => (
                <option key={r.full} value={r.full}>
                  {r.full}
                  {r.label ? ` · ${r.label}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        {summary && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line bg-bg px-4 py-1.5 text-[11.5px] text-muted">
            <span className="font-medium text-fg">This month</span>
            <span>
              <span className="num text-fg">{summary.month.runs}</span> tasks · <span className="num text-fg">{summary.month.sessions}</span> Claude sessions · <span className="num text-fg">{summary.month.minutes}</span> min
            </span>
            <span>
              <span className="num">{summary.month.prs}</span> PRs · <span className="num">{summary.month.merged}</span> merged
            </span>
            {Object.entries(summary.byPerson).map(([who, v]) => (
              <span key={who}>
                {who}: <span className="num">{v.runs}</span> · <span className="num">{v.minutes}</span> min
              </span>
            ))}
            <a href="https://claude.ai/settings/usage" target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-fg" title="Your subscription limits are shown on claude.ai">
              Subscription limits <ExternalLink size={11} />
            </a>
          </div>
        )}
        {canEdit(user) && (
          <form
            className="border-b border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), void start())}
              placeholder="What should Claude build or fix? e.g. “Add a contact page with a map and opening hours, mobile friendly.”"
              className="h-24 w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] text-faint">⌘ Enter to start · runs on your Claude subscription via GitHub Actions (usually 3–15 min)</span>
              <button disabled={busy || prompt.trim().length < 3 || !repo} className={`${btnPrimary} ml-auto`}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Start
              </button>
            </div>
            {note && <p className="mt-1.5 text-[12px] text-warning">{note}</p>}
            {error && (
              <div className="mt-2">
                <ErrorNote>{error}</ErrorNote>
              </div>
            )}
          </form>
        )}
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
              <li key={r.number}>
                <button onClick={() => setSel(sel === r.number ? null : r.number)} className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-surface-2 ${sel === r.number ? "bg-surface-2" : ""}`}>
                  <span className="num text-[12px] text-faint">#{r.number}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.title}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] ${STATUS[r.status].cls}`}>
                    {r.status === "working" && <Loader2 size={10} className="animate-spin" />}
                    {STATUS[r.status].label}
                  </span>
                  <span className="w-full text-[11.5px] text-faint sm:w-auto">
                    {r.by ?? "—"} · {ago(r.createdAt)}
                    {r.minutes ? ` · ${r.minutes} min` : ""}
                  </span>
                </button>
                {sel === r.number && <RunThread projectId={projectId} repo={repo} run={r} onChanged={() => void runs.reload()} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunThread({ projectId, repo, run, onChanged }: { projectId: string; repo: string; run: Run; onChanged: () => void }) {
  const user = useSessionUser();
  const working = run.status === "working" || run.status === "queued";
  const t = useCached<Thread>(`/delivery/projects/${projectId}/agent/runs/${run.number}?${repoQ(repo)}`, { staleMs: 3_000, refreshMs: working ? 10_000 : 0 });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const comments = useMemo(() => t.data?.comments ?? [], [t.data]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [comments.length]);
  const pr = t.data?.pr ?? run.pr;

  const send = async () => {
    if (!reply.trim()) return;
    setBusy("reply");
    setMsg(null);
    try {
      const r = await teamFetch<{ note?: string | null }>(`/delivery/projects/${projectId}/agent/runs/${run.number}/reply?${repoQ(repo)}`, { method: "POST", body: JSON.stringify({ text: reply, pr: pr?.state === "open" ? pr.number : undefined }) });
      setReply("");
      setMsg({ ok: true, text: r.note ?? "Sent — Claude picks it up in a minute." });
      await t.reload();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const merge = async () => {
    if (!pr || !window.confirm(`Merge PR #${pr.number} into the main branch?`)) return;
    setBusy("merge");
    setMsg(null);
    try {
      await teamFetch(`/delivery/projects/${projectId}/pulls/${pr.number}/merge?${repoQ(repo)}`, { method: "POST", body: "{}" });
      setMsg({ ok: true, text: "Merged." });
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
            <span className="num text-faint">#{pr.number}</span> {pr.title}
          </a>
          <a href={previewUrl(repo, pr.branch)} target="_blank" rel="noreferrer" className={btnSecondary} title="Runs this branch in the browser (StackBlitz)">
            <Play size={13} /> Preview
          </a>
          {pr.state === "open" && canEdit(user) && (
            <button onClick={() => void merge()} disabled={!!busy} className={btnPrimary}>
              {busy === "merge" ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />} Merge
            </button>
          )}
        </div>
      )}
      <div className="max-h-[460px] space-y-2.5 overflow-y-auto">
        {t.data && (
          <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13px]">
            <div className="mb-0.5 text-[11px] text-muted">{t.data.issue.by ?? "You"} · task</div>
            <div className="whitespace-pre-wrap">{t.data.issue.body.trim()}</div>
          </div>
        )}
        {comments.map((c) =>
          c.bot ? (
            <div key={c.id} className="max-w-[95%] rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
                <Bot size={12} className="text-accent" /> Claude {c.where === "pr" ? "· on the PR" : ""} · {ago(c.updatedAt)}
                <a href={c.url} target="_blank" rel="noreferrer" className="ml-auto text-faint hover:text-fg" aria-label="Open on GitHub">
                  <ExternalLink size={11} />
                </a>
              </div>
              <div className="text-[13px]">
                <Md text={tidy(c.body)} />
              </div>
            </div>
          ) : (
            <div key={c.id} className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13px]">
              <div className="mb-0.5 text-[11px] text-muted">
                {c.author} · {ago(c.createdAt)}
              </div>
              <div className="whitespace-pre-wrap">{c.body.replace(/^@claude\s*/, "").replace(/\n*<sub>From Scoutline by [^<]+<\/sub>\s*$/, "")}</div>
            </div>
          ),
        )}
        {!t.data && <div className="h-16 animate-pulse rounded-lg bg-surface-2" />}
        {working && (
          <div className="inline-flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 size={13} className="animate-spin" /> Claude is working on GitHub — this updates by itself.
          </div>
        )}
        <div ref={end} />
      </div>
      {canEdit(user) && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={pr?.state === "open" ? "Ask Claude to change something in this PR…" : "Reply to Claude…"} className="h-[36px] min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] outline-none placeholder:text-faint focus:border-accent/60" />
          <button disabled={busy === "reply" || !reply.trim()} className={btnPrimary} aria-label="Send to Claude">
            {busy === "reply" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </form>
      )}
      {msg && <p className={`text-[12px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      <a href={run.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-faint hover:text-fg">
        Open on GitHub <ExternalLink size={11} />
      </a>
    </div>
  );
}

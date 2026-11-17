import { useCallback, useEffect, useState } from "react";
import { Bot, Check, CircleAlert, ExternalLink, GitBranch, GitMerge, GitPullRequest, Loader2, Play, Plus, RefreshCw, Rocket, ShieldCheck, Trash2, X } from "lucide-react";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";
import { fmtDate } from "../../lib/delivery";
import { ErrorNote, field } from "./parts";

/** Faza 14 — tab „Code“: GitHub iz aplikacije (analitika, PR-ovi, grane, Actions, deploy). */
interface Repo {
  id: string;
  full: string;
  label: string | null;
  primary: boolean;
}
type Section = "insights" | "pulls" | "branches" | "actions" | "deploy";
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const inp = field.replace("w-full ", ""); // polja koja ne zauzimaju ceo red
const small = "inline-flex h-[28px] items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50";

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    setError(null);
    teamFetch<T>(path)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [path]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  return { data, error, reload: load, setData };
}

// ── Analitika ──
interface Insights {
  configured: boolean;
  repos: string[];
  weeks: Array<{ week: string; commits: number; opened: number; merged: number }>;
  totals: { commits: number; prsOpened: number; prsMerged: number; openPrs: number; medianMergeHours: number | null; ciSuccessPct: number | null };
  openPrs: Array<{ repo: string; number: number; title: string; author: string; ageDays: number; draft: boolean; url: string }>;
  people: Array<{ login: string; commits: number; prs: number }>;
  lastRun: { repo: string; name: string; conclusion: string | null; at: string; url: string } | null;
  milestones: Array<{ repo: string; title: string; open: number; closed: number; due: string | null }>;
  errors: string[];
  at: string;
}
function InsightsView({ projectId }: { projectId: string }) {
  const [fresh, setFresh] = useState(0);
  const { data, error } = useLoad<Insights>(`/delivery/projects/${projectId}/insights${fresh ? `?fresh=1&t=${fresh}` : ""}`);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <div className="h-48 animate-pulse rounded-xl bg-surface-2" />;
  if (!data.configured) return <p className="text-[13px] text-muted">Add a GitHub repo to the project to see activity.</p>;
  const max = Math.max(1, ...data.weeks.map((w) => Math.max(w.commits, w.opened + w.merged)));
  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-6">
        {[
          ["Commits · 12 wk", t.commits],
          ["PRs opened", t.prsOpened],
          ["PRs merged", t.prsMerged],
          ["Open PRs", t.openPrs],
          ["Time to merge", t.medianMergeHours === null ? "—" : t.medianMergeHours < 48 ? `${t.medianMergeHours} h` : `${Math.round(t.medianMergeHours / 24)} d`],
          ["CI passing", t.ciSuccessPct === null ? "—" : `${t.ciSuccessPct}%`],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-line bg-surface px-3 py-3">
            <div className="truncate text-[11.5px] text-muted">{l}</div>
            <div className="num mt-1 text-[20px] font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-center text-[13px] font-semibold">
            Activity per week
            <span className="ml-auto inline-flex items-center gap-3 text-[11px] font-normal text-faint">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-accent" /> commits
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-success" /> PRs merged
              </span>
            </span>
          </div>
          <div className="flex h-[140px] items-end gap-1" role="img" aria-label="Commits and merged pull requests per week">
            {data.weeks.map((w) => (
              <div key={w.week} className="flex h-full flex-1 items-end gap-[2px]" title={`Week of ${w.week}: ${w.commits} commits, ${w.opened} PRs opened, ${w.merged} merged`}>
                <div className="flex-1 rounded-t-[2px] bg-accent" style={{ height: `${(w.commits / max) * 100}%` }} />
                <div className="flex-1 rounded-t-[2px] bg-success" style={{ height: `${(w.merged / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-faint">
            <span>{data.weeks[0]?.week.slice(5)}</span>
            <span>this week</span>
          </div>
        </section>
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 text-[13px] font-semibold">Who's shipping</div>
          <ul className="space-y-1.5">
            {data.people.map((p) => (
              <li key={p.login} className="flex items-center gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">{p.login}</span>
                <span className="num text-muted">{p.commits} commits</span>
                <span className="num text-faint">{p.prs} PRs</span>
              </li>
            ))}
            {data.people.length === 0 && <li className="text-[12.5px] text-faint">No activity in the last 12 weeks.</li>}
          </ul>
          {data.lastRun && (
            <a href={data.lastRun.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 border-t border-line pt-2 text-[12px] text-muted hover:text-fg">
              {data.lastRun.conclusion === "success" ? <Check size={13} className="text-success" /> : <CircleAlert size={13} className="text-warning" />}
              Last CI: {data.lastRun.name} · {data.lastRun.conclusion} · {ago(data.lastRun.at)}
            </a>
          )}
        </section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 text-[13px] font-semibold">Pull requests waiting longest</div>
          <ul className="space-y-1.5">
            {data.openPrs.slice(0, 8).map((p) => (
              <li key={`${p.repo}#${p.number}`}>
                <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[12.5px] hover:text-fg">
                  <GitPullRequest size={13} className={p.draft ? "text-faint" : "text-success"} />
                  <span className="min-w-0 flex-1 truncate text-muted">{p.title}</span>
                  <span className={`num shrink-0 text-[11.5px] ${p.ageDays > 7 ? "text-warning" : "text-faint"}`}>{p.ageDays}d</span>
                </a>
              </li>
            ))}
            {data.openPrs.length === 0 && <li className="text-[12.5px] text-faint">No open pull requests.</li>}
          </ul>
        </section>
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 text-[13px] font-semibold">Milestones</div>
          <ul className="space-y-2.5">
            {data.milestones.map((m) => {
              const total = m.open + m.closed;
              const pct = total ? Math.round((m.closed / total) * 100) : 0;
              return (
                <li key={`${m.repo}:${m.title}`}>
                  <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                    <span className="truncate">{m.title}</span>
                    <span className="num text-muted">
                      {pct}% · {m.closed}/{total}
                      {m.due ? ` · due ${fmtDate(m.due)}` : ""}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
            {data.milestones.length === 0 && <li className="text-[12.5px] text-faint">No open milestones on GitHub.</li>}
          </ul>
        </section>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
        From GitHub · {data.repos.join(", ")} · updated {ago(data.at)}
        <button onClick={() => setFresh(Date.now())} className="inline-flex items-center gap-1 text-muted hover:text-fg">
          <RefreshCw size={11} /> Refresh
        </button>
        {data.errors.length > 0 && <span className="text-warning">· {data.errors[0]}</span>}
      </div>
    </div>
  );
}

// ── Pull request-ovi ──
interface Pull {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  author: string;
  branch: string;
  base: string;
  createdAt: string;
  checks: { total: number; ok: number; failed: number; pending: number } | null;
  approved: boolean;
  changesRequested: boolean;
  issueKey: string | null;
}
function PullsView({ projectId, repo }: { projectId: string; repo: string }) {
  const user = useSessionUser();
  const { data, error, reload } = useLoad<{ pulls: Pull[] }>(`/delivery/projects/${projectId}/pulls?repo=${encodeURIComponent(repo)}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (n: number, action: "approve" | "merge" | "review", body: object = {}) => {
    if (action === "merge" && !window.confirm(`Merge PR #${n} (squash)?`)) return;
    setBusy(`${n}:${action}`);
    setMsg(null);
    try {
      const r = await teamFetch<{ message: string }>(`/delivery/projects/${projectId}/pulls/${n}/${action}?repo=${encodeURIComponent(repo)}`, { method: "POST", body: JSON.stringify(body) });
      setMsg({ ok: true, text: r.message });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <div className="h-32 animate-pulse rounded-xl bg-surface-2" />;
  return (
    <div className="space-y-2">
      {msg && <div className={`rounded-lg border px-3 py-2 text-[12.5px] ${msg.ok ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>{msg.text}</div>}
      {data.pulls.map((p) => (
        <div key={p.number} className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-start gap-2.5">
            <GitPullRequest size={15} className={`mt-0.5 shrink-0 ${p.draft ? "text-faint" : "text-success"}`} />
            <div className="min-w-0 flex-1">
              <a href={p.url} target="_blank" rel="noreferrer" className="block truncate text-[13.5px] font-medium hover:underline">
                {p.title}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                <span className="num">#{p.number}</span>
                {p.issueKey && <span className="num rounded bg-accent-soft px-1.5 text-accent">{p.issueKey}</span>}
                <span>
                  {p.author} · {p.branch} → {p.base} · {ago(p.createdAt)}
                </span>
                {p.draft && <span className="text-faint">draft</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                {p.checks && p.checks.total > 0 ? (
                  <span className={p.checks.failed ? "text-danger" : p.checks.pending ? "text-warning" : "text-success"}>
                    {p.checks.failed ? `✕ ${p.checks.failed} check(s) failed` : p.checks.pending ? `● ${p.checks.pending} check(s) running` : `✓ ${p.checks.ok} checks passed`}
                  </span>
                ) : (
                  <span className="text-faint">no checks</span>
                )}
                {p.approved && (
                  <span className="inline-flex items-center gap-1 text-success">
                    <ShieldCheck size={12} /> approved
                  </span>
                )}
                {p.changesRequested && <span className="text-warning">changes requested</span>}
              </div>
            </div>
          </div>
          {canEdit(user) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
              <button disabled={!!busy} onClick={() => void act(p.number, "review", { agent: "claude" })} className={small} title="Comments @claude on the PR to review it">
                {busy === `${p.number}:review` ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />} AI review
              </button>
              <button disabled={!!busy || p.approved} onClick={() => void act(p.number, "approve")} className={small}>
                {busy === `${p.number}:approve` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
              </button>
              <button disabled={!!busy || p.draft} onClick={() => void act(p.number, "merge")} className="inline-flex h-[28px] items-center gap-1.5 rounded-md bg-fg px-2.5 text-[12px] font-medium text-bg disabled:opacity-40" title={p.draft ? "Draft PRs can't be merged" : "Squash and merge"}>
                {busy === `${p.number}:merge` ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />} Merge
              </button>
            </div>
          )}
        </div>
      ))}
      {data.pulls.length === 0 && <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-[13px] text-faint">No open pull requests in {repo}.</div>}
    </div>
  );
}

// ── Grane ──
function BranchesView({ projectId, repo }: { projectId: string; repo: string }) {
  const user = useSessionUser();
  const { data, error, reload } = useLoad<{ defaultBranch: string; branches: Array<{ name: string; protected: boolean; isDefault: boolean; pr: { number: number; state: string; merged: boolean } | null }> }>(`/delivery/projects/${projectId}/branches?repo=${encodeURIComponent(repo)}`);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <div className="h-32 animate-pulse rounded-xl bg-surface-2" />;
  const stale = data.branches.filter((b) => !b.isDefault && b.pr && b.pr.state === "closed");
  return (
    <div className="space-y-3">
      {canEdit(user) && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMsg(null);
            try {
              const r = await teamFetch<{ name: string }>(`/delivery/projects/${projectId}/branches?repo=${encodeURIComponent(repo)}`, { method: "POST", body: JSON.stringify({ name }) });
              setMsg(`Branch ${r.name} created from ${data.defaultBranch}.`);
              setName("");
              reload();
            } catch (err) {
              setMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className={`${inp} num h-[32px] w-full max-w-[320px]`} value={name} onChange={(e) => setName(e.target.value)} placeholder={`new branch from ${data.defaultBranch}, e.g. feature/login`} />
          <button disabled={busy || !name.trim()} className={small}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create branch
          </button>
          <span className="self-center text-[12px] text-faint">Tip: open an issue → “Create branch” names it after the task.</span>
        </form>
      )}
      {msg && <div className="text-[12.5px] text-muted">{msg}</div>}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {data.branches.map((b) => (
          <div key={b.name} className="flex items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] last:border-0">
            <GitBranch size={13} className={b.isDefault ? "text-accent" : "text-faint"} />
            <a href={`https://github.com/${repo}/tree/${encodeURIComponent(b.name)}`} target="_blank" rel="noreferrer" className="num min-w-0 flex-1 truncate hover:underline">
              {b.name}
            </a>
            {b.isDefault && <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] text-accent">default</span>}
            {b.protected && <span className="text-[11px] text-faint">protected</span>}
            {b.pr && <span className={`text-[11.5px] ${b.pr.merged ? "text-accent" : b.pr.state === "open" ? "text-success" : "text-faint"}`}>PR #{b.pr.number} {b.pr.merged ? "merged" : b.pr.state}</span>}
            {canEdit(user) && !b.isDefault && b.pr && b.pr.state === "closed" && (
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete branch ${b.name}? Its pull request is ${b.pr!.merged ? "merged" : "closed"}.`)) return;
                  try {
                    await teamFetch(`/delivery/projects/${projectId}/branches?repo=${encodeURIComponent(repo)}&name=${encodeURIComponent(b.name)}`, { method: "DELETE" });
                    reload();
                  } catch (e) {
                    setMsg((e as Error).message);
                  }
                }}
                className="text-faint hover:text-danger"
                aria-label={`Delete ${b.name}`}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {stale.length > 0 && <p className="text-[12px] text-faint">{stale.length} branch(es) have a merged or closed PR — safe to delete.</p>}
    </div>
  );
}

// ── Actions ──
function ActionsView({ projectId, repo }: { projectId: string; repo: string }) {
  const user = useSessionUser();
  const { data, error, reload } = useLoad<{ workflows: Array<{ id: number; name: string; path: string; active: boolean; canRun: boolean }>; runs: Array<{ id: number; name: string; status: string; conclusion: string | null; branch: string; at: string; url: string; event: string }> }>(`/delivery/projects/${projectId}/actions?repo=${encodeURIComponent(repo)}`);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <div className="h-32 animate-pulse rounded-xl bg-surface-2" />;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-2 text-[13px] font-semibold">Workflows</div>
        <ul className="space-y-1.5">
          {data.workflows.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {canEdit(user) && w.canRun ? (
                <button
                  disabled={busy === w.id}
                  onClick={async () => {
                    setBusy(w.id);
                    setMsg(null);
                    try {
                      const r = await teamFetch<{ message: string }>(`/delivery/projects/${projectId}/actions/${w.id}/run?repo=${encodeURIComponent(repo)}`, { method: "POST", body: "{}" });
                      setMsg(r.message);
                      setTimeout(reload, 4000);
                    } catch (e) {
                      setMsg((e as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className={small}
                >
                  {busy === w.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run
                </button>
              ) : (
                <span className="text-[11px] text-faint" title="Add `workflow_dispatch:` to the workflow's `on:` to run it from here">{w.active ? "auto only" : "disabled"}</span>
              )}
            </li>
          ))}
          {data.workflows.length === 0 && <li className="text-[12.5px] text-faint">No GitHub Actions workflows in this repo.</li>}
        </ul>
        {msg && <p className="mt-2 text-[12px] text-muted">{msg}</p>}
      </section>
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-2 flex items-center text-[13px] font-semibold">
          Recent runs
          <button onClick={reload} className="ml-auto text-faint hover:text-fg" aria-label="Refresh runs">
            <RefreshCw size={12} />
          </button>
        </div>
        <ul className="space-y-1.5">
          {data.runs.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[12.5px] hover:text-fg">
                {r.status !== "completed" ? <Loader2 size={13} className="animate-spin text-warning" /> : r.conclusion === "success" ? <Check size={13} className="text-success" /> : <X size={13} className="text-danger" />}
                <span className="min-w-0 flex-1 truncate text-muted">
                  {r.name} <span className="text-faint">· {r.branch}</span>
                </span>
                <span className="shrink-0 text-[11px] text-faint">{ago(r.at)}</span>
              </a>
            </li>
          ))}
          {data.runs.length === 0 && <li className="text-[12.5px] text-faint">No runs yet.</li>}
        </ul>
      </section>
    </div>
  );
}

// ── Deploy ──
function DeployView({ projectId }: { projectId: string }) {
  const user = useSessionUser();
  const { data, error, reload } = useLoad<{ hooks: Array<{ id: string; name: string; hint: string; withToken: boolean }>; history: Array<{ id: string; hookName: string; actor: string; ok: boolean; message: string | null; createdAt: string }> }>(`/delivery/projects/${projectId}/deploys`);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState({ name: "", url: "", token: "" });
  const owner = user?.role === "owner" || !user;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <div className="h-32 animate-pulse rounded-xl bg-surface-2" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {data.hooks.map((h) => (
          <div key={h.id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
            <button
              disabled={!canEdit(user) || !!busy}
              onClick={async () => {
                if (!window.confirm(`Deploy “${h.name}” now?`)) return;
                setBusy(h.id);
                setMsg(null);
                try {
                  const r = await teamFetch<{ ok: boolean; message: string }>(`/delivery/projects/${projectId}/deploy/${h.id}`, { method: "POST", body: "{}" });
                  setMsg({ ok: r.ok, text: r.message });
                } catch (e) {
                  setMsg({ ok: false, text: (e as Error).message });
                } finally {
                  setBusy(null);
                  reload();
                }
              }}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-md bg-fg px-3 text-[12.5px] font-medium text-bg disabled:opacity-50"
            >
              {busy === h.id ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />} Deploy {h.name}
            </button>
            {owner && (
              <button
                onClick={async () => {
                  if (!window.confirm(`Remove deploy hook “${h.name}”?`)) return;
                  await teamFetch(`/delivery/projects/${projectId}/deploy-hooks/${h.id}`, { method: "DELETE" });
                  reload();
                }}
                className="grid size-7 place-items-center text-faint hover:text-danger"
                aria-label={`Remove ${h.name}`}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {data.hooks.length === 0 && <p className="text-[13px] text-muted">No deploy buttons yet{owner ? " — add one below." : " — ask the owner to add one."}</p>}
      </div>
      {msg && <div className={`rounded-lg border px-3 py-2 text-[12.5px] ${msg.ok ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>{msg.text}</div>}
      {owner && (
        <form
          className="grid gap-2 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_2fr]"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await teamFetch(`/delivery/projects/${projectId}/deploy-hooks`, { method: "POST", body: JSON.stringify(f) });
              setF({ name: "", url: "", token: "" });
              reload();
            } catch (err) {
              setMsg({ ok: false, text: (err as Error).message });
            }
          }}
        >
          <div className="text-[13px] font-semibold sm:col-span-2">Add a deploy button</div>
          <input className={`${field} h-[34px]`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name, e.g. production" />
          <input className={`${field} num h-[34px]`} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="Coolify deploy webhook or Netlify build hook URL" />
          <input className={`${field} num h-[34px] sm:col-span-2`} type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} placeholder="Coolify API token (only for Coolify; leave empty for Netlify)" />
          <p className="text-[12px] text-faint sm:col-span-2">Coolify: resource → Webhooks → Deploy webhook + Keys & Tokens → API token. Netlify: Site → Build & deploy → Build hooks. Stored encrypted.</p>
          <div className="sm:col-span-2">
            <button disabled={!f.name.trim() || !f.url.trim()} className={small}>
              <Plus size={12} /> Add
            </button>
          </div>
        </form>
      )}
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-2 text-[13px] font-semibold">Deploy history</div>
        <ul className="space-y-1.5">
          {data.history.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-[12.5px]">
              {d.ok ? <Check size={13} className="text-success" /> : <X size={13} className="text-danger" />}
              <span className="min-w-0 flex-1 truncate text-muted">
                {d.hookName} · {d.actor} <span className="text-faint">· {d.message}</span>
              </span>
              <span className="shrink-0 text-[11px] text-faint">{ago(d.createdAt)}</span>
            </li>
          ))}
          {data.history.length === 0 && <li className="text-[12.5px] text-faint">No deploys yet.</li>}
        </ul>
      </section>
    </div>
  );
}

/** Tab „Code“ na projektu. */
export function CodeTab({ projectId }: { projectId: string }) {
  const user = useSessionUser();
  const repos = useLoad<{ repos: Repo[] }>(`/delivery/projects/${projectId}/repos`);
  const [section, setSection] = useState<Section>("insights");
  const [repo, setRepo] = useState<string>("");
  const [adding, setAdding] = useState({ repo: "", label: "" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (repos.data?.repos.length && !repos.data.repos.find((r) => r.full === repo)) setRepo(repos.data.repos[0]!.full);
  }, [repos.data, repo]);
  const list = repos.data?.repos ?? [];
  const seg = (on: boolean) => `h-[28px] whitespace-nowrap rounded-md px-2.5 text-[12.5px] ${on ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((r) => (
          <button key={r.full} onClick={() => setRepo(r.full)} className={`inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] ${repo === r.full ? "border-accent/50 bg-accent-soft text-fg" : "border-line bg-surface text-muted hover:text-fg"}`}>
            <GitBranch size={12} /> {r.full}
            {r.label && <span className="text-faint">· {r.label}</span>}
            <a href={`https://github.com/${r.full}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-faint hover:text-fg" aria-label={`Open ${r.full} on GitHub`}>
              <ExternalLink size={11} />
            </a>
            {!r.primary && canEdit(user) && (
              <span
                role="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!window.confirm(`Unlink ${r.full} from this project?`)) return;
                  await teamFetch(`/delivery/projects/${projectId}/repos/${r.id}`, { method: "DELETE" });
                  repos.reload();
                }}
                className="text-faint hover:text-danger"
                aria-label={`Unlink ${r.full}`}
              >
                <X size={11} />
              </span>
            )}
          </button>
        ))}
        {canEdit(user) && (
          <form
            className="inline-flex flex-wrap gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              try {
                await teamFetch(`/delivery/projects/${projectId}/repos`, { method: "POST", body: JSON.stringify(adding) });
                setAdding({ repo: "", label: "" });
                repos.reload();
              } catch (er) {
                setErr((er as Error).message);
              }
            }}
          >
            <input className={`${inp} num h-[30px] w-44`} value={adding.repo} onChange={(e) => setAdding({ ...adding, repo: e.target.value })} placeholder="owner/repo" />
            <input className={`${inp} h-[30px] w-28`} value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder="frontend…" />
            <button disabled={!adding.repo.trim()} className={small}>
              <Plus size={12} /> {list.length ? "Add repo" : "Link repo"}
            </button>
          </form>
        )}
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center text-[13px] text-muted">Link a GitHub repo to see activity, pull requests, branches, Actions and deploys here.</div>
      ) : (
        <>
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {(
                [
                  ["insights", "Activity"],
                  ["pulls", "Pull requests"],
                  ["branches", "Branches"],
                  ["actions", "Actions"],
                  ["deploy", "Deploy"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setSection(k)} className={seg(section === k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {section === "insights" && <InsightsView projectId={projectId} />}
          {section === "pulls" && repo && <PullsView key={repo} projectId={projectId} repo={repo} />}
          {section === "branches" && repo && <BranchesView key={repo} projectId={projectId} repo={repo} />}
          {section === "actions" && repo && <ActionsView key={repo} projectId={projectId} repo={repo} />}
          {section === "deploy" && <DeployView projectId={projectId} />}
        </>
      )}
    </div>
  );
}

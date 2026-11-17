import { useCallback, useEffect, useState } from "react";
import { Bot, Bug, CheckCircle2, CircleDot, ExternalLink, GitBranch, Loader2, MessageSquare, Plus, Sparkles, X } from "lucide-react";
import { canEdit, useSessionUser } from "../lib/session";
import { teamFetch } from "../lib/team";

interface Task {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  labels: Array<{ name: string; color: string }>;
  assignee: string | null;
  comments: number;
  claude: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

function NewTask({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"task" | "bug">("task");
  const [claude, setClaude] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const field = "w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={() => !busy && onClose()}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await teamFetch("/dev/tasks", { method: "POST", body: JSON.stringify({ title, body, type, claude }) });
            setTitle("");
            setBody("");
            onCreated();
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className="w-full max-w-[540px] rounded-[14px] border border-line bg-surface p-5 shadow-float"
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-center">
          <h2 className="text-base font-semibold tracking-tight">New task</h2>
          <button type="button" onClick={onClose} className="ml-auto text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2.5">
          <div className="inline-flex rounded-lg border border-line bg-bg p-0.5 text-[13px]">
            {(["task", "bug"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} className={`inline-flex h-[28px] items-center gap-1.5 rounded-md px-3 ${type === t ? "bg-surface text-fg ring-1 ring-line" : "text-muted"}`}>
                {t === "bug" ? <Bug size={13} /> : <CircleDot size={13} />} {t === "bug" ? "Bug" : "Task"}
              </button>
            ))}
          </div>
          <input className={`${field} h-[36px]`} autoFocus placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={`${field} h-28 resize-none py-2 leading-relaxed`} placeholder="Details, acceptance criteria… (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-bg p-3">
            <input type="checkbox" checked={claude} onChange={(e) => setClaude(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
            <span className="text-[13px]">
              <span className="inline-flex items-center gap-1 font-medium">
                <Sparkles size={13} className="text-accent" /> Let Claude do it
              </span>
              <span className="block text-[12px] text-muted">Claude Code picks it up on GitHub, makes the change, runs the checks and opens a pull request. Uses your Claude subscription.</span>
            </span>
          </label>
        </div>
        {error && <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-[34px] rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
            Cancel
          </button>
          <button disabled={busy || !title.trim()} className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-fg px-3.5 text-[13px] font-medium text-bg disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
          </button>
        </div>
      </form>
    </div>
  );
}

export function TasksPage() {
  const user = useSessionUser();
  const [state, setState] = useState<"open" | "closed">("open");
  const [data, setData] = useState<{ configured: boolean; repo: string | null; tasks: Task[]; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await teamFetch(`/dev/tasks?state=${state}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [state]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">
            Bugs and ideas for Scoutline itself, synced with GitHub Issues{data?.repo ? ` (${data.repo})` : ""}. Hand any task to Claude Code — it opens a pull request for you to review.
          </p>
        </div>
        {canEdit(user) && data?.configured && (
          <button onClick={() => setNewOpen(true)} className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-fg px-3 text-[13px] font-medium text-bg hover:opacity-90 sm:ml-auto">
            <Plus size={14} /> New task
          </button>
        )}
      </div>

      {(error || data?.error) && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error ?? data?.error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-success/40 bg-success-soft px-3 py-2 text-[12.5px] text-success">{notice}</div>}

      {data && !data.configured ? (
        <div className="rounded-xl border border-line bg-surface p-6">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-medium">
            <GitBranch size={16} /> Connect GitHub
          </div>
          <ol className="ml-4 list-decimal space-y-1 text-[13px] text-muted">
            <li>GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.</li>
            <li>Repository access: only <b className="text-fg">scoutline</b>. Permissions: <b className="text-fg">Issues — Read and write</b>.</li>
            <li>
              In Coolify add <code className="num text-fg">GITHUB_TOKEN</code> and <code className="num text-fg">GITHUB_REPO=AleksaT205/scoutline</code>, then Redeploy.
            </li>
          </ol>
          <p className="mt-3 text-[12.5px] text-faint">Full guide: docs/WORKFLOW.md</p>
        </div>
      ) : (
        <>
          <div className="mb-3 inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12.5px]">
            {(["open", "closed"] as const).map((s) => (
              <button key={s} onClick={() => setState(s)} className={`h-[28px] rounded-md px-3 capitalize ${state === s ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <ul className="divide-y divide-line">
              {(data?.tasks ?? []).map((t) => (
                <li key={t.number} className="flex items-center gap-3 px-4 py-3">
                  {t.state === "closed" ? <CheckCircle2 size={16} className="shrink-0 text-accent" /> : <CircleDot size={16} className="shrink-0 text-success" />}
                  <div className="min-w-0 flex-1">
                    <a href={t.url} target="_blank" rel="noreferrer" className="block truncate text-[13.5px] font-medium hover:underline">
                      {t.title}
                    </a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                      <span className="num">#{t.number}</span>
                      <span>· updated {ago(t.updatedAt)}</span>
                      {t.labels.map((l) => (
                        <span key={l.name} className="rounded-full px-1.5 py-px text-[11px] ring-1 ring-inset" style={{ color: `#${l.color}`, boxShadow: `inset 0 0 0 1px #${l.color}55` }}>
                          {l.name}
                        </span>
                      ))}
                      {t.claude && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-px text-[11px] text-accent">
                          <Bot size={11} /> Claude
                        </span>
                      )}
                      {t.comments > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <MessageSquare size={11} /> {t.comments}
                        </span>
                      )}
                    </div>
                  </div>
                  {t.state === "open" && canEdit(user) && (
                    <button
                      disabled={asking === t.number}
                      onClick={async () => {
                        setAsking(t.number);
                        setNotice(null);
                        try {
                          await teamFetch(`/dev/tasks/${t.number}/claude`, { method: "POST", body: "{}" });
                          setNotice(`Claude was asked to work on #${t.number}. Watch the issue on GitHub for progress and the pull request.`);
                          void load();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setAsking(null);
                        }
                      }}
                      className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] font-medium text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
                    >
                      {asking === t.number ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} className="text-accent" />} Ask Claude
                    </button>
                  )}
                  <a href={t.url} target="_blank" rel="noreferrer" className="text-faint hover:text-fg" aria-label={`Open #${t.number} on GitHub`}>
                    <ExternalLink size={14} />
                  </a>
                </li>
              ))}
              {data?.tasks.length === 0 && <li className="px-4 py-10 text-center text-[13px] text-faint">No {state} tasks.</li>}
              {!data &&
                [0, 1, 2].map((i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="h-4 animate-pulse rounded bg-surface-2" />
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}
      <NewTask open={newOpen} onClose={() => setNewOpen(false)} onCreated={load} />
    </>
  );
}

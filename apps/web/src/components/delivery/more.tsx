import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Inbox, Link2, Loader2, Plus, RefreshCcw, Trash2, X } from "lucide-react";
import type { IssueStatus } from "@radar/shared";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";
import { cycleLabel, fmtDate, inboxChanged, patchIssue, useCycles, useIssues, type Issue } from "../../lib/delivery";
import { Dialog, ErrorNote, ProgressRing, StatusIcon, btnPrimary, btnSecondary, field } from "./parts";
import { IssueDetail, IssueList } from "./issues";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

// ── Inbox (triage): novi zahtevi od klijenata i sa GitHub-a čekaju odluku ──
export function InboxPage() {
  const user = useSessionUser();
  const editable = canEdit(user);
  const issues = useIssues("status=triage");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setIssues = (f: (prev: Issue[]) => Issue[]) => issues.setData((d) => f(d ?? []));
  const items = issues.data ?? [];
  const sel = items.find((i) => i.id === selected) ?? null;

  const decide = async (i: Issue, status: IssueStatus, current = false) => {
    setBusy(i.id);
    setError(null);
    try {
      await patchIssue(i.id, { status, ...(current ? { cycleId: "current" } : {}) });
      if (status === "canceled") await teamFetch(`/delivery/issues/${i.id}/comments`, { method: "POST", body: JSON.stringify({ text: "Declined in triage." }) });
      setIssues((prev) => prev.filter((x) => x.id !== i.id));
      inboxChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-0.5 text-[13.5px] text-muted">New requests from client portals and GitHub wait here. Accept them into the plan or decline.</p>
      </div>
      {(error || issues.error) && (
        <div className="mb-3">
          <ErrorNote>{error ?? issues.error}</ErrorNote>
        </div>
      )}
      {!issues.data ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
      ) : items.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <Inbox size={24} className="mb-2 text-faint" />
          <div className="text-[13.5px] font-medium">Inbox zero</div>
          <p className="mt-1 max-w-md text-[12.5px] text-muted">Requests arrive here from the client portal (project → Client portal) and from GitHub issues when import is on for a project.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <StatusIcon status="triage" />
              <button onClick={() => setSelected(i.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13.5px] font-medium hover:underline">{i.title}</div>
                <div className="mt-0.5 truncate text-[12px] text-muted">
                  <span className="num">{i.key}</span> · {i.projectName} · {i.createdBy === "Client: Client" ? "Client portal" : (i.createdBy ?? "team")} · {ago(i.createdAt)}
                </div>
              </button>
              {editable && (
                <div className="flex gap-1.5">
                  <button disabled={busy === i.id} onClick={() => void decide(i, "todo", true)} className="inline-flex h-[30px] items-center gap-1.5 rounded-md bg-fg px-2.5 text-[12px] font-medium text-bg disabled:opacity-50" title="Accept into Todo in the current cycle">
                    {busy === i.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Accept
                  </button>
                  <button disabled={busy === i.id} onClick={() => void decide(i, "backlog")} className="h-[30px] rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50" title="Accept for later">
                    Backlog
                  </button>
                  <button disabled={busy === i.id} onClick={() => void decide(i, "canceled")} className="grid size-[30px] place-items-center rounded-md border border-line text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50" aria-label="Decline" title="Decline">
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {sel && (
        <IssueDetail
          issue={sel}
          onClose={() => setSelected(null)}
          onChanged={(i) => (i.status === "triage" ? setIssues((prev) => prev.map((x) => (x.id === i.id ? i : x))) : (setIssues((prev) => prev.filter((x) => x.id !== i.id)), inboxChanged()))}
          onDeleted={(rid) => (setIssues((prev) => prev.filter((x) => x.id !== rid)), setSelected(null), inboxChanged())}
        />
      )}
    </>
  );
}

// ── Sprintovi ──
function BurnUp({ burn, scope }: { burn: Array<{ day: string; done: number }>; scope: number }) {
  const w = 560;
  const h = 140;
  const pad = 24;
  const max = Math.max(scope, 1);
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(burn.length - 1, 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const pts = burn.filter((b) => b.done >= 0).map((b, i) => `${x(i)},${y(b.done)}`);
  const today = burn.findIndex((b) => b.done < 0) - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[140px] w-full" role="img" aria-label="Cycle burn-up chart">
      <line x1={pad} y1={y(max)} x2={w - pad} y2={y(max)} stroke="var(--border-2)" strokeDasharray="4 4" />
      <text x={w - pad} y={y(max) - 6} textAnchor="end" fontSize="10" fill="var(--faint)">
        scope {scope}
      </text>
      <line x1={x(0)} y1={y(0)} x2={x(burn.length - 1)} y2={y(max)} stroke="var(--border-2)" />
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--border)" />
      {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" />}
      {pts.length > 0 && <circle cx={x(pts.length - 1)} cy={y(burn.filter((b) => b.done >= 0).at(-1)?.done ?? 0)} r="3.5" fill="var(--accent)" />}
      {today >= 0 && <line x1={x(today)} y1={pad} x2={x(today)} y2={h - pad} stroke="var(--accent)" strokeOpacity=".25" />}
      {burn.map((b, i) => (i === 0 || i === burn.length - 1 ? <text key={b.day} x={x(i)} y={h - 6} textAnchor={i === 0 ? "start" : "end"} fontSize="10" fill="var(--faint)">{fmtDate(b.day)}</text> : null))}
    </svg>
  );
}

function CycleLength({ onChanged }: { onChanged: () => void }) {
  const user = useSessionUser();
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    teamFetch<{ days: number }>("/delivery/cycles/settings")
      .then((d) => setDays(d.days))
      .catch(() => setDays(14));
  }, []);
  if (days === null) return null;
  const owner = user?.role === "owner" || !user;
  return (
    <label className="inline-flex items-center gap-2 text-[12.5px] text-muted" title="Applies to cycles that haven't started yet">
      Cycle length
      <select
        disabled={!owner || busy}
        value={days}
        onChange={async (e) => {
          const d = Number(e.target.value);
          setBusy(true);
          try {
            await teamFetch("/delivery/cycles/settings", { method: "PUT", body: JSON.stringify({ days: d }) });
            setDays(d);
            onChanged();
          } finally {
            setBusy(false);
          }
        }}
        className="h-[30px] rounded-lg border border-line bg-surface px-2 text-[12.5px] text-fg outline-none disabled:opacity-60"
      >
        {[7, 14, 21, 28].map((d) => (
          <option key={d} value={d}>
            {d / 7} week{d > 7 ? "s" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CyclesPage() {
  const cycles = useCycles();
  const issues = useIssues("cycle=current");
  const [selected, setSelected] = useState<string | null>(null);
  const setIssues = (f: (prev: Issue[]) => Issue[]) => issues.setData((d) => f(d ?? []));
  const list = cycles.data?.cycles ?? [];
  const current = list.find((c) => c.state === "current");
  const daysLeft = current ? Math.max(0, Math.ceil((Date.parse(current.endsAt) - Date.now()) / 86_400_000)) : 0;
  const live = useMemo(() => {
    const all = (issues.data ?? []).filter((i) => i.status !== "canceled");
    return { scope: all.length, done: all.filter((i) => i.status === "done").length, started: all.filter((i) => i.status === "in_progress" || i.status === "in_review").length };
  }, [issues.data]);
  const sel = issues.data?.find((i) => i.id === selected) ?? null;
  const pct = live.scope ? Math.round((live.done / live.scope) * 100) : 0;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cycles</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">Sprints for the whole team. Unfinished tasks move to the next cycle automatically.</p>
        </div>
        <div className="sm:ml-auto">
          <CycleLength onChanged={cycles.reload} />
        </div>
      </div>
      {cycles.error && <ErrorNote>{cycles.error}</ErrorNote>}
      {current && (
        <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <RefreshCcw size={15} className="text-accent" />
              <h2 className="text-[15px] font-semibold">{cycleLabel(current)}</h2>
              <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] text-accent">Current</span>
              <span className="text-[12.5px] text-muted">
                {fmtDate(current.startsAt)} – {fmtDate(new Date(Date.parse(current.endsAt) - 1).toISOString())} · {daysLeft} days left
              </span>
            </div>
            <div className="mt-3">
              <BurnUp burn={cycles.data?.burn ?? []} scope={live.scope} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Scope", live.scope],
              ["Done", live.done],
              ["In progress", live.started],
              ["Completed", `${pct}%`],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-xl border border-line bg-surface px-4 py-4">
                <div className="text-[12.5px] text-muted">{l}</div>
                <div className="num mt-1.5 text-[24px] font-semibold leading-tight tracking-tight">{v}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">Tasks in this cycle</div>
      {!issues.data ? <div className="h-32 animate-pulse rounded-xl bg-surface-2" /> : <IssueList issues={issues.data} onOpen={(i) => setSelected(i.id)} showProject empty="No issues in this cycle yet. Open an issue and set Cycle, or tick “Current cycle” when creating one." />}

      <div className="mt-6 mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">All cycles</div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {[...list]
              .sort((a, b) => b.number - a.number)
              .map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">
                    {cycleLabel(c)}
                    {c.state === "current" && <span className="ml-2 rounded-full bg-accent-soft px-2 py-px text-[11px] text-accent">Current</span>}
                    {c.state === "upcoming" && <span className="ml-2 text-[11.5px] text-faint">Upcoming</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {fmtDate(c.startsAt)} – {fmtDate(new Date(Date.parse(c.endsAt) - 1).toISOString())}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2 text-muted">
                      <ProgressRing value={c.scope ? Math.round((c.done / c.scope) * 100) : 0} size={16} />
                      <span className="num">
                        {c.done}/{c.scope}
                      </span>
                    </span>
                  </td>
                  <td className="num hidden px-4 py-2.5 text-muted sm:table-cell">{c.points ? `${c.pointsDone}/${c.points} pt` : ""}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {sel && <IssueDetail issue={sel} onClose={() => setSelected(null)} onChanged={(i) => setIssues((prev) => (i.cycleId === sel.cycleId ? prev.map((x) => (x.id === i.id ? i : x)) : prev.filter((x) => x.id !== i.id)))} onDeleted={(rid) => (setIssues((prev) => prev.filter((x) => x.id !== rid)), setSelected(null))} />}
    </>
  );
}

// ── Portal za klijenta (link samo za pregled napretka + slanje zahteva) ──
interface Portal {
  id: string;
  label: string;
  allowRequests: boolean;
  lastViewedAt: string | null;
  createdAt: string;
}
export function PortalDialog({ open, onClose, projectId, projectName }: { open: boolean; onClose: () => void; projectId: string; projectName: string }) {
  const [portals, setPortals] = useState<Portal[] | null>(null);
  const [label, setLabel] = useState("");
  const [allowRequests, setAllowRequests] = useState(true);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    teamFetch<{ portals: Portal[] }>(`/delivery/projects/${projectId}/portals`)
      .then((d) => setPortals(d.portals))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    if (open) {
      setCreated(null);
      setError(null);
      setLabel(`${projectName} — progress`);
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);
  const linkFor = (token: string) => `${window.location.origin}${window.location.pathname}#/portal/${token}`;
  return (
    <Dialog open={open} onClose={onClose} title="Client portal" width={580}>
      <div className="space-y-3 px-4 py-4">
        <p className="text-[13px] text-muted">
          A private read-only page for your client: progress, what was done this week, what’s in progress and up next. Tasks labeled <code className="num text-fg">internal</code> are hidden. Clients can also send
          requests — they land in your Inbox.
        </p>
        {created ? (
          <div className="rounded-xl border border-success/40 bg-success-soft p-3">
            <div className="mb-1.5 text-[12.5px] font-medium text-success">Link created — copy it now, it’s shown only once.</div>
            <div className="flex gap-2">
              <input readOnly value={linkFor(created)} className={`${field} h-[34px] num text-[12px]`} onFocus={(e) => e.target.select()} />
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(linkFor(created));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className={btnSecondary}
              >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                const r = await teamFetch<{ token: string }>(`/delivery/projects/${projectId}/portals`, { method: "POST", body: JSON.stringify({ label, allowRequests }) });
                setCreated(r.token);
                void load();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-[12px] text-muted">Name (only you see it)</span>
              <input className={`${field} h-[34px]`} value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label className="inline-flex h-[34px] items-center gap-1.5 text-[12.5px] text-muted">
              <input type="checkbox" checked={allowRequests} onChange={(e) => setAllowRequests(e.target.checked)} className="accent-[var(--accent)]" /> Allow requests
            </label>
            <button disabled={busy || !label.trim()} className={btnPrimary}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create link
            </button>
          </form>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="rounded-xl border border-line">
          {(portals ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12.5px] last:border-0">
              <Link2 size={13} className="text-faint" />
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              <span className="text-faint">{p.allowRequests ? "requests on" : "view only"}</span>
              <span className="text-faint">· {p.lastViewedAt ? `viewed ${ago(p.lastViewedAt)}` : "not opened yet"}</span>
              <button
                onClick={async () => {
                  if (!window.confirm(`Revoke “${p.label}”? The link stops working immediately.`)) return;
                  await teamFetch(`/delivery/portals/${p.id}`, { method: "DELETE" }).catch((e) => setError((e as Error).message));
                  void load();
                }}
                className="grid size-7 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-danger"
                aria-label={`Revoke ${p.label}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {portals?.length === 0 && <div className="px-3 py-3 text-[12.5px] text-faint">No active links yet.</div>}
        </div>
      </div>
    </Dialog>
  );
}

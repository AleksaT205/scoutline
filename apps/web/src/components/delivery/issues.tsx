import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CalendarDays, ExternalLink, GitMerge, GitPullRequest, Loader2, Plus, RefreshCcw, Send, Tag, Trash2, X } from "lucide-react";
import { ISSUE_STATUSES, type IssueStatus } from "@radar/shared";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";
import { cycleLabel, fmtDate, patchIssue, toDateInput, useCycles, useMembers, type Issue, type IssueEvent, type IssueLink, type Project } from "../../lib/delivery";
import { TimeBox } from "./time";
import { Avatar, BOARD_STATUSES, Dialog, ErrorNote, ISSUE_STATUS_META, Menu, PRIORITY_META, PriorityIcon, StatusIcon, btnPrimary, btnSecondary } from "./parts";

const ESTIMATES = [null, 1, 2, 3, 5, 8];
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return fmtDate(iso);
};

// ── Izbornici (status, prioritet, osoba) — isti u kartici, detalju i novom tasku ──
export function StatusMenu({ value, onChange, disabled, showLabel = true }: { value: IssueStatus; onChange: (s: IssueStatus) => void; disabled?: boolean; showLabel?: boolean }) {
  return (
    <Menu label="Status" value={value} disabled={disabled} onChange={onChange} options={ISSUE_STATUSES.map((s) => ({ value: s, label: ISSUE_STATUS_META[s].label, icon: <StatusIcon status={s} /> }))} className="h-[28px] px-1.5">
      <StatusIcon status={value} />
      {showLabel && <span className="text-fg">{ISSUE_STATUS_META[value].label}</span>}
    </Menu>
  );
}
export function PriorityMenu({ value, onChange, disabled, showLabel = true }: { value: number; onChange: (p: number) => void; disabled?: boolean; showLabel?: boolean }) {
  return (
    <Menu label="Priority" value={value} disabled={disabled} onChange={onChange} options={PRIORITY_META.map((p) => ({ value: p.value, label: p.label, icon: <PriorityIcon priority={p.value} /> }))} className="h-[28px] px-1.5">
      <PriorityIcon priority={value} />
      {showLabel && <span className={value ? "text-fg" : "text-muted"}>{PRIORITY_META[value]?.label}</span>}
    </Menu>
  );
}
export function AssigneeMenu({ value, name, onChange, disabled, showLabel = true }: { value: string | null; name: string | null; onChange: (id: string | null) => void; disabled?: boolean; showLabel?: boolean }) {
  const members = useMembers();
  const options = [{ value: null as string | null, label: "Unassigned", icon: <Avatar name={null} size={18} /> }, ...members.map((m) => ({ value: m.id as string | null, label: m.name, icon: <Avatar name={m.name} size={18} />, hint: m.email.split("@")[0] }))];
  const current = members.find((m) => m.id === value)?.name ?? name;
  return (
    <Menu label="Assignee" value={value} disabled={disabled} onChange={onChange} options={options} className="h-[28px] px-1.5">
      <Avatar name={value ? current : null} size={18} />
      {showLabel && <span className={value ? "text-fg" : "text-muted"}>{value ? current : "Unassigned"}</span>}
    </Menu>
  );
}

// ── Novi task ──
export function NewIssueDialog({
  open,
  onClose,
  projects,
  projectId,
  status = "todo",
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  projectId?: string;
  status?: IssueStatus;
  onCreated: (i: Issue) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pid, setPid] = useState(projectId ?? "");
  const [st, setSt] = useState<IssueStatus>(status);
  const [priority, setPriority] = useState(0);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [inCycle, setInCycle] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPid(projectId ?? projects.find((p) => p.status === "active")?.id ?? projects[0]?.id ?? "");
      setSt(status);
      setError(null);
    }
  }, [open, projectId, status, projects]);
  const project = projects.find((p) => p.id === pid);
  const submitRef = useRef<() => void>(() => undefined);
  // ⌘/Ctrl + Enter pravi task i kad fokus nije u polju (npr. posle izbora u meniju)
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), submitRef.current());
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open]);

  const submit = async () => {
    if (!title.trim() || !pid) return;
    setBusy(true);
    setError(null);
    try {
      const { issue } = await teamFetch<{ issue: Issue }>("/delivery/issues", { method: "POST", body: JSON.stringify({ projectId: pid, title, description, status: st, priority, assigneeId: assignee, cycleId: inCycle ? "current" : null }) });
      onCreated(issue);
      setTitle("");
      setDescription("");
      setPriority(0);
      setAssignee(null);
      if (!more) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  submitRef.current = () => void (!busy && submit());

  return (
    <Dialog open={open} onClose={onClose} title="New issue" width={620}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-2 px-4 pt-3">
          {!projectId && (
            <Menu label="Project" value={pid} onChange={setPid} options={projects.map((p) => ({ value: p.id, label: p.name, hint: p.key }))} className="h-[26px] border border-line px-2">
              <span className="num text-[11px] text-faint">{project?.key ?? "—"}</span>
              <span className="max-w-[260px] truncate text-fg">{project?.name ?? "Pick a project"}</span>
            </Menu>
          )}
          <input autoFocus className="w-full bg-transparent py-1 text-[17px] font-medium outline-none placeholder:text-faint" placeholder="Issue title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="h-28 w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-muted outline-none placeholder:text-faint" placeholder="Add description… (what needs to be done, how we know it's done)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex flex-wrap items-center gap-1.5 pb-3">
            <div className="rounded-md border border-line">
              <StatusMenu value={st} onChange={setSt} />
            </div>
            <div className="rounded-md border border-line">
              <PriorityMenu value={priority} onChange={setPriority} />
            </div>
            <div className="rounded-md border border-line">
              <AssigneeMenu value={assignee} name={null} onChange={setAssignee} />
            </div>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
            <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} className="accent-[var(--accent)]" /> Create more
          </label>
          <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
            <input type="checkbox" checked={inCycle} onChange={(e) => setInCycle(e.target.checked)} className="accent-[var(--accent)]" /> Current cycle
          </label>
          <span className="ml-auto hidden text-[11.5px] text-faint sm:inline">⌘ Enter to create</span>
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={busy || !title.trim() || !pid} className={btnPrimary}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create issue
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Kartica i tabla (kanban) ──
function Card({ issue, onOpen, onDragStart, dragging, editable, onChange }: { issue: Issue; onOpen: () => void; onDragStart: () => void; dragging: boolean; editable: boolean; onChange: (b: Partial<Issue>) => void }) {
  const overdue = issue.dueDate && issue.status !== "done" && Date.parse(issue.dueDate) < Date.now();
  return (
    <div
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onClick={onOpen}
      className={`group cursor-pointer rounded-lg border border-line bg-surface p-2.5 shadow-sm transition-all hover:border-line-2 hover:shadow-float ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
        <span className="num">{issue.key}</span>
        <span className="ml-auto">
          <AssigneeMenu value={issue.assigneeId} name={issue.assigneeName} onChange={(assigneeId) => onChange({ assigneeId })} disabled={!editable} showLabel={false} />
        </span>
      </div>
      <div className="mt-0.5 flex items-start gap-1.5">
        <span className="mt-[3px]">
          <StatusIcon status={issue.status} size={13} />
        </span>
        <div className="line-clamp-3 text-[13px] font-medium leading-snug">{issue.title}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
        <span className="rounded border border-line">
          <PriorityMenu value={issue.priority} onChange={(priority) => onChange({ priority })} disabled={!editable} showLabel={false} />
        </span>
        {issue.labels.map((l) => (
          <span key={l} className="inline-flex h-[22px] items-center gap-1 rounded-full border border-line px-1.5 text-[11px]">
            <span className="size-1.5 rounded-full bg-accent" /> {l}
          </span>
        ))}
        {issue.estimate ? <span className="num inline-flex h-[22px] items-center rounded border border-line px-1.5 text-[11px]">{issue.estimate} pt</span> : null}
        {issue.dueDate && (
          <span className={`inline-flex h-[22px] items-center gap-1 rounded border border-line px-1.5 text-[11px] ${overdue ? "text-danger" : ""}`}>
            <CalendarDays size={11} /> {fmtDate(issue.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Kanban tabla: prevlačenje menja status i redosled (sačuva se odmah). */
export function IssueBoard({ issues, setIssues, onOpen, onNew, showProject }: { issues: Issue[]; setIssues: (f: (prev: Issue[]) => Issue[]) => void; onOpen: (i: Issue) => void; onNew?: (s: IssueStatus) => void; showProject?: boolean }) {
  const user = useSessionUser();
  const editable = canEdit(user);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: IssueStatus; before: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCanceled, setShowCanceled] = useState(false);
  const columns = showCanceled ? [...BOARD_STATUSES, "canceled" as IssueStatus] : BOARD_STATUSES;
  const by = useMemo(() => {
    const m = new Map<IssueStatus, Issue[]>(ISSUE_STATUSES.map((s) => [s, []]));
    for (const i of issues) m.get(i.status)!.push(i);
    for (const arr of m.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return m;
  }, [issues]);

  const update = async (id: string, body: Partial<Issue>) => {
    const before = issues;
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, ...body } : i)));
    try {
      const fresh = await patchIssue(id, body);
      setIssues((prev) => prev.map((i) => (i.id === id ? fresh : i)));
    } catch (e) {
      setIssues(() => before);
      setError((e as Error).message);
    }
  };

  const drop = (status: IssueStatus, beforeId: string | null) => {
    const id = dragId;
    setDragId(null);
    setOver(null);
    if (!id || id === beforeId) return;
    const col = (by.get(status) ?? []).filter((i) => i.id !== id);
    const at = beforeId ? col.findIndex((i) => i.id === beforeId) : col.length;
    const prev = col[at - 1]?.sortOrder;
    const next = col[at]?.sortOrder;
    const sortOrder = prev === undefined && next === undefined ? 0 : prev === undefined ? next! - 1 : next === undefined ? prev + 1 : (prev + next) / 2;
    const cur = issues.find((i) => i.id === id);
    if (cur && cur.status === status && cur.sortOrder === sortOrder) return;
    void update(id, { status, sortOrder });
  };

  return (
    <>
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))` }}>
          {columns.map((status) => {
            const items = by.get(status) ?? [];
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  if (over?.status !== status || over.before !== null) setOver({ status, before: null });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(status, over?.status === status ? over.before : null);
                }}
                className={`flex min-h-[460px] flex-col rounded-xl border p-2 transition-colors ${over?.status === status ? "border-accent/50 bg-accent-soft" : "border-line bg-bg"}`}
              >
                <div className="mb-2 flex items-center gap-2 px-1 text-[12.5px]">
                  <StatusIcon status={status} />
                  <span className="font-medium">{ISSUE_STATUS_META[status].label}</span>
                  <span className="num text-faint">{items.length}</span>
                  {onNew && editable && (
                    <button onClick={() => onNew(status)} className="ml-auto grid size-6 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-fg" aria-label={`New issue in ${ISSUE_STATUS_META[status].label}`}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {items.map((i) => (
                    <div
                      key={i.id}
                      onDragOver={(e) => {
                        if (!dragId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (over?.before !== i.id) setOver({ status, before: i.id });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        drop(status, i.id);
                      }}
                    >
                      {over?.before === i.id && dragId !== i.id && <div className="mb-2 h-0.5 rounded bg-accent" />}
                      {showProject && <div className="mb-0.5 truncate px-1 text-[11px] text-faint">{i.projectName}</div>}
                      <Card issue={i} onOpen={() => onOpen(i)} onDragStart={() => setDragId(i.id)} dragging={dragId === i.id} editable={editable} onChange={(b) => void update(i.id, b)} />
                    </div>
                  ))}
                  {items.length === 0 && <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-line text-[12px] text-faint">{editable ? "Drop issues here" : "No issues"}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <button onClick={() => setShowCanceled((v) => !v)} className="mt-2 text-[12px] text-faint hover:text-fg">
        {showCanceled ? "Hide canceled" : `Show canceled (${by.get("canceled")?.length ?? 0})`}
      </button>
    </>
  );
}

// ── Lista grupisana po statusu (Linear „list view“) ──
export function IssueList({ issues, onOpen, showProject, empty = "No issues yet." }: { issues: Issue[]; onOpen: (i: Issue) => void; showProject?: boolean; empty?: string }) {
  const groups = ISSUE_STATUSES.map((s) => ({ status: s, items: issues.filter((i) => i.status === s).sort((a, b) => a.priority - b.priority || a.sortOrder - b.sortOrder) })).filter((g) => g.items.length);
  if (!issues.length) return <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-14 text-[13px] text-faint">{empty}</div>;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {groups.map((g) => (
        <div key={g.status}>
          <div className="flex items-center gap-2 border-b border-line bg-bg px-4 py-2 text-[12.5px]">
            <StatusIcon status={g.status} />
            <span className="font-medium">{ISSUE_STATUS_META[g.status].label}</span>
            <span className="num text-faint">{g.items.length}</span>
          </div>
          {g.items.map((i) => (
            <button key={i.id} onClick={() => onOpen(i)} className="flex w-full items-center gap-3 border-b border-line px-4 py-2 text-left text-[13px] last:border-b-0 hover:bg-surface-2">
              <PriorityIcon priority={i.priority} />
              <span className="num w-[72px] shrink-0 text-[12px] text-faint">{i.key}</span>
              <StatusIcon status={i.status} />
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              {i.labels.slice(0, 2).map((l) => (
                <span key={l} className="hidden h-[20px] items-center rounded-full border border-line px-1.5 text-[11px] text-muted md:inline-flex">
                  {l}
                </span>
              ))}
              {showProject && <span className="hidden max-w-[160px] truncate text-[12px] text-muted lg:inline">{i.projectName}</span>}
              {i.dueDate && <span className={`num hidden text-[12px] sm:inline ${i.status !== "done" && Date.parse(i.dueDate) < Date.now() ? "text-danger" : "text-muted"}`}>{fmtDate(i.dueDate)}</span>}
              <Avatar name={i.assigneeName} size={20} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Detalj taska (bočni panel) ──
function eventText(e: IssueEvent, names: Record<string, string>) {
  const d = (e.data ?? {}) as { from?: unknown; to?: unknown; via?: string };
  switch (e.type) {
    case "created":
      return "created the issue";
    case "status":
      return (
        <>
          moved from <b className="font-medium text-fg">{ISSUE_STATUS_META[d.from as IssueStatus]?.label ?? String(d.from)}</b> to <b className="font-medium text-fg">{ISSUE_STATUS_META[d.to as IssueStatus]?.label ?? String(d.to)}</b>
          {d.via && <span className="text-faint"> ({d.via})</span>}
        </>
      );
    case "priority":
      return (
        <>
          set priority to <b className="font-medium text-fg">{PRIORITY_META[Number(d.to)]?.label}</b>
        </>
      );
    case "assignee":
      return d.to ? (
        <>
          assigned to <b className="font-medium text-fg">{names[String(d.to)] ?? "a teammate"}</b>
        </>
      ) : (
        "removed the assignee"
      );
    case "cycle":
      return d.to ? (typeof d.to === "number" ? `moved to Cycle ${d.to} (unfinished work rolled over)` : `added to ${names[`cycle:${String(d.to)}`] ?? "a cycle"}`) : "removed from the cycle";
    case "agent": {
      const x = e.data as { agent?: string; url?: string } | null;
      return (
        <>
          handed it to <b className="font-medium text-fg">{x?.agent === "codex" ? "Codex" : "Claude"}</b>
          {x?.url && (
            <a href={x.url} target="_blank" rel="noreferrer" className="ml-1 text-accent hover:underline">
              GitHub issue
            </a>
          )}
        </>
      );
    }
    case "github": {
      const x = e.data as { pr?: number; url?: string; state?: string } | null;
      return (
        <>
          PR{" "}
          <a href={x?.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            #{x?.pr}
          </a>{" "}
          is {x?.state}
        </>
      );
    }
    case "estimate":
      return d.to ? `set estimate to ${d.to} pt` : "removed the estimate";
    case "title":
      return "renamed the issue";
    default:
      return e.type;
  }
}

export function IssueDetail({ issue, onClose, onChanged, onDeleted }: { issue: Issue; onClose: () => void; onChanged: (i: Issue) => void; onDeleted: (id: string) => void }) {
  const user = useSessionUser();
  const editable = canEdit(user);
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? "");
  const [labelText, setLabelText] = useState("");
  const [events, setEvents] = useState<IssueEvent[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cycles = useCycles();
  const [links, setLinks] = useState<IssueLink[]>([]);
  const [agentBusy, setAgentBusy] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    teamFetch<{ links: IssueLink[] }>(`/delivery/issues/${issue.id}/links`)
      .then((d) => setLinks(d.links))
      .catch(() => setLinks([]));
  }, [issue.id, issue.updatedAt]);
  useEffect(() => {
    teamFetch<{ project: Project }>(`/delivery/projects/${issue.projectId}`)
      .then((d) => setRepoUrl(d.project.repoUrl))
      .catch(() => setRepoUrl(null));
  }, [issue.projectId]);
  const cycleNames = Object.fromEntries((cycles.data?.cycles ?? []).map((c) => [`cycle:${c.id}`, cycleLabel(c)]));
  const cycleOptions = [
    { value: null as string | null, label: "No cycle" },
    ...(cycles.data?.cycles ?? [])
      .filter((c) => c.state !== "past" || c.id === issue.cycleId)
      .sort((a, b) => a.number - b.number)
      .map((c) => ({ value: c.id as string | null, label: cycleLabel(c), hint: c.state === "current" ? "current" : `${fmtDate(c.startsAt)}` })),
  ];
  const currentCycleName = cycles.data?.cycles.find((c) => c.id === issue.cycleId);
  const handToAgent = async (agent: "claude" | "codex") => {
    setAgentBusy(agent);
    setError(null);
    try {
      await teamFetch(`/delivery/issues/${issue.id}/agent`, { method: "POST", body: JSON.stringify({ agent }) });
      onChanged({ ...issue, agent, status: issue.status === "done" || issue.status === "canceled" ? issue.status : "in_progress", updatedAt: new Date().toISOString() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAgentBusy(null);
    }
  };

  useEffect(() => {
    setTitle(issue.title);
    setDescription(issue.description ?? "");
  }, [issue.id, issue.title, issue.description]);
  const loadEvents = () =>
    teamFetch<{ events: IssueEvent[]; names: Record<string, string> }>(`/delivery/issues/${issue.id}/events`)
      .then((d) => (setEvents(d.events), setNames(d.names)))
      .catch(() => setEvents([]));
  useEffect(() => {
    setEvents(null);
    void loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.id, issue.updatedAt]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest("[role=listbox]") && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const save = async (body: Partial<Issue>) => {
    setError(null);
    onChanged({ ...issue, ...body });
    try {
      onChanged(await patchIssue(issue.id, body));
    } catch (e) {
      onChanged(issue);
      setError((e as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()} className="flex h-full w-full max-w-[640px] flex-col border-l border-line bg-surface shadow-float" aria-label={`Issue ${issue.key}`}>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-[12.5px] text-muted">
          <a href={`#/delivery/projects/${issue.projectId}`} onClick={onClose} className="truncate hover:text-fg">
            {issue.projectName}
          </a>
          <span className="text-faint">›</span>
          <span className="num text-fg">{issue.key}</span>
          <div className="ml-auto flex items-center gap-1">
            {editable && (
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete ${issue.key}? This can't be undone.`)) return;
                  try {
                    await teamFetch(`/delivery/issues/${issue.id}`, { method: "DELETE" });
                    onDeleted(issue.id);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
                className="grid size-7 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-danger"
                aria-label="Delete issue"
                title="Delete issue"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button onClick={onClose} className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <textarea
            value={title}
            readOnly={!editable}
            rows={1}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
            onBlur={() => title.trim() && title !== issue.title && void save({ title: title.trim() })}
            className="field-sizing-content w-full resize-none bg-transparent text-[20px] font-semibold leading-snug tracking-tight outline-none"
            aria-label="Title"
          />
          <textarea
            value={description}
            readOnly={!editable}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== (issue.description ?? "") && void save({ description })}
            placeholder={editable ? "Add description…" : "No description"}
            className="mt-2 min-h-[120px] w-full resize-y bg-transparent text-[13.5px] leading-relaxed text-muted outline-none placeholder:text-faint"
            aria-label="Description"
          />

          {/* Svojstva */}
          <div className="mt-3 grid grid-cols-[96px_1fr] items-center gap-x-3 gap-y-1.5 rounded-xl border border-line bg-bg p-3 text-[12.5px]">
            <span className="text-faint">Status</span>
            <div>
              <StatusMenu value={issue.status} onChange={(status) => void save({ status })} disabled={!editable} />
            </div>
            <span className="text-faint">Priority</span>
            <div>
              <PriorityMenu value={issue.priority} onChange={(priority) => void save({ priority })} disabled={!editable} />
            </div>
            <span className="text-faint">Assignee</span>
            <div>
              <AssigneeMenu value={issue.assigneeId} name={issue.assigneeName} onChange={(assigneeId) => void save({ assigneeId })} disabled={!editable} />
            </div>
            <span className="text-faint">Estimate</span>
            <div>
              <Menu label="Estimate" value={issue.estimate} disabled={!editable} onChange={(estimate) => void save({ estimate })} options={ESTIMATES.map((v) => ({ value: v, label: v ? `${v} point${v > 1 ? "s" : ""}` : "No estimate" }))} className="h-[28px] px-1.5">
                <span className={issue.estimate ? "text-fg" : "text-muted"}>{issue.estimate ? `${issue.estimate} pt` : "No estimate"}</span>
              </Menu>
            </div>
            <span className="text-faint">Due date</span>
            <input
              type="date"
              disabled={!editable}
              value={toDateInput(issue.dueDate)}
              onChange={(e) => void save({ dueDate: e.target.value ? new Date(`${e.target.value}T12:00:00Z`).toISOString() : null })}
              className="h-[28px] w-fit rounded-md bg-transparent px-1.5 text-fg outline-none hover:bg-surface-2"
            />
            <span className="text-faint">Cycle</span>
            <div>
              <Menu label="Cycle" value={issue.cycleId} disabled={!editable} onChange={(cycleId) => void save({ cycleId })} options={cycleOptions} className="h-[28px] px-1.5">
                <RefreshCcw size={13} className={issue.cycleId ? "text-accent" : "text-faint"} />
                <span className={issue.cycleId ? "text-fg" : "text-muted"}>{currentCycleName ? cycleLabel(currentCycleName) : issue.cycleId ? "Cycle" : "No cycle"}</span>
              </Menu>
            </div>
            <span className="text-faint">Labels</span>
            <div className="flex flex-wrap items-center gap-1">
              {issue.labels.map((l) => (
                <span key={l} className="inline-flex h-[24px] items-center gap-1 rounded-full border border-line px-2 text-[11.5px]">
                  <span className="size-1.5 rounded-full bg-accent" /> {l}
                  {editable && (
                    <button onClick={() => void save({ labels: issue.labels.filter((x) => x !== l) })} className="text-faint hover:text-fg" aria-label={`Remove label ${l}`}>
                      <X size={11} />
                    </button>
                  )}
                </span>
              ))}
              {editable && (
                <label className="inline-flex h-[24px] items-center gap-1 rounded-full px-1.5 text-faint focus-within:text-fg">
                  <Tag size={11} />
                  <input
                    value={labelText}
                    onChange={(e) => setLabelText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && labelText.trim()) {
                        e.preventDefault();
                        void save({ labels: [...issue.labels, labelText.trim().toLowerCase()] });
                        setLabelText("");
                      }
                    }}
                    placeholder="Add label"
                    className="w-24 bg-transparent text-[12px] outline-none placeholder:text-faint"
                  />
                </label>
              )}
            </div>
          </div>
          {/* AI agent i GitHub */}
          <div className="mt-3 rounded-xl border border-line bg-bg p-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <Bot size={14} className="text-accent" />
              <span className="font-medium">AI agent</span>
              {issue.agent && <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] text-accent">Working: {issue.agent === "codex" ? "Codex" : "Claude"}</span>}
              {editable && (
                <div className="ml-auto flex gap-1.5">
                  {(["claude", "codex"] as const).map((a) => (
                    <button
                      key={a}
                      disabled={!!agentBusy || !repoUrl}
                      title={repoUrl ? `Opens a GitHub issue in the project repo with a short brief and @${a}` : "Add the project's GitHub repo first (Edit project)"}
                      onClick={() => void handToAgent(a)}
                      className="inline-flex h-[28px] items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-40"
                    >
                      {agentBusy === a ? <Loader2 size={12} className="animate-spin" /> : null}
                      {issue.agent === a ? "Ask again" : `Assign to ${a === "claude" ? "Claude" : "Codex"}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {repoUrl === null && <p className="mt-1.5 text-[12px] text-faint">Connect a GitHub repo to the project to hand tasks to Claude or Codex and to link pull requests automatically.</p>}
            {links.length > 0 && (
              <ul className="mt-2 space-y-1">
                {links.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-[12.5px]">
                    {l.kind === "pr" ? (
                      l.state === "merged" ? (
                        <GitMerge size={13} className="text-accent" />
                      ) : (
                        <GitPullRequest size={13} className={l.state === "closed" ? "text-danger" : l.state === "draft" ? "text-faint" : "text-success"} />
                      )
                    ) : (
                      <ExternalLink size={13} className="text-faint" />
                    )}
                    <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                      <span className="num text-faint">
                        {l.repo}#{l.number}
                      </span>{" "}
                      {l.title}
                    </a>
                    <span className="text-[11px] text-faint">{l.kind === "pr" ? l.state : "issue"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <TimeBox issueId={issue.id} />
          {error && (
            <div className="mt-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          {/* Aktivnost */}
          <div className="mt-6 text-[12px] font-medium uppercase tracking-wider text-faint">Activity</div>
          <ol className="mt-2 space-y-3">
            {(events ?? []).map((e) =>
              e.type === "comment" ? (
                <li key={e.id} className="rounded-xl border border-line bg-bg p-3">
                  <div className="mb-1 flex items-center gap-2 text-[12px]">
                    <Avatar name={e.actor} size={18} />
                    <span className="font-medium">{e.actor}</span>
                    <span className="text-faint">{ago(e.createdAt)}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{String((e.data as { text?: string } | null)?.text ?? "")}</div>
                </li>
              ) : (
                <li key={e.id} className="flex items-center gap-2 px-1 text-[12px] text-muted">
                  <span className="size-1.5 shrink-0 rounded-full bg-line-2" />
                  <span>
                    <span className="text-fg">{e.actor}</span> {eventText(e, { ...names, ...cycleNames })}
                  </span>
                  <span className="ml-auto shrink-0 text-faint">{ago(e.createdAt)}</span>
                </li>
              ),
            )}
            {events === null && <li className="h-10 animate-pulse rounded-lg bg-surface-2" />}
          </ol>
          {editable && (
            <form
              className="mt-3 rounded-xl border border-line bg-bg p-2 focus-within:border-accent/50"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                setBusy(true);
                try {
                  await teamFetch(`/delivery/issues/${issue.id}/comments`, { method: "POST", body: JSON.stringify({ text: comment }) });
                  setComment("");
                  await loadEvents();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.currentTarget.form?.requestSubmit(), e.preventDefault())}
                placeholder="Leave a comment…"
                className="h-16 w-full resize-none bg-transparent px-1 text-[13px] outline-none placeholder:text-faint"
              />
              <div className="flex justify-end">
                <button disabled={busy || !comment.trim()} className="inline-flex h-[28px] items-center gap-1.5 rounded-md bg-fg px-2.5 text-[12px] font-medium text-bg disabled:opacity-40">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Comment
                </button>
              </div>
            </form>
          )}
          <div className="mt-4 text-[11.5px] text-faint">
            Created by {issue.createdBy ?? "team"} · {fmtDate(issue.createdAt)}
            {issue.completedAt && ` · completed ${fmtDate(issue.completedAt)}`}
          </div>
        </div>
      </aside>
    </div>
  );
}


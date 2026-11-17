import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Globe, CalendarDays, ExternalLink, FolderKanban, GitBranch, LayoutList, Loader2, Pencil, Plus, Search, SquareKanban, Users } from "lucide-react";
import { PROJECT_STATUSES, type IssueStatus, type ProjectStatus } from "@radar/shared";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";
import { fmtDate, fmtEur, toDateInput, typing, useCustomers, useIssues, useMembers, useProject, useProjects, type Customer, type Issue, type Project } from "../../lib/delivery";
import { flag } from "../ui";
import { Avatar, Dialog, ErrorNote, Menu, PROJECT_STATUS_META, ProgressRing, btnPrimary, btnSecondary, field } from "./parts";
import { IssueBoard, IssueDetail, IssueList, NewIssueDialog } from "./issues";
import { PortalDialog } from "./more";

function PageHead({ title, sub, children }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[13.5px] text-muted">{sub}</p>}
      </div>
      {children && <div className="flex gap-2 sm:ml-auto">{children}</div>}
    </div>
  );
}

function ProjectStatusPill({ status }: { status: ProjectStatus }) {
  const m = PROJECT_STATUS_META[status];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m.cls}`}>{m.label}</span>;
}

/** Prečica „C“ = novi task (kao u Linear-u). */
function useNewIssueShortcut(open: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e) && !document.querySelector("[role=dialog]")) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, enabled]);
}

// ── Novi / izmena projekta ──
function ProjectDialog({ open, onClose, project, onSaved }: { open: boolean; onClose: () => void; project?: Project; onSaved: (p: Project) => void }) {
  const customers = useCustomers();
  const members = useMembers();
  const [f, setF] = useState({ name: "", customerId: "", customerName: "", status: "planned" as ProjectStatus, budgetEur: "", dueDate: "", ownerId: "", repoUrl: "", description: "", githubImport: false, billing: "fixed" as "fixed" | "hourly", hourlyRateEur: "", aiClientId: "" });
  const [aiClients, setAiClients] = useState<Array<{ id: string; name: string; projectId: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF({
      name: project?.name ?? "",
      customerId: project?.customerId ?? "",
      customerName: "",
      status: project?.status ?? "planned",
      budgetEur: project?.budgetEur ? String(project.budgetEur) : "",
      dueDate: toDateInput(project?.dueDate),
      ownerId: project?.ownerId ?? "",
      repoUrl: project?.repoUrl ?? "",
      description: project?.description ?? "",
      githubImport: project?.githubImport ?? false,
      billing: project?.billing ?? "fixed",
      hourlyRateEur: project?.hourlyRateEur ? String(project.hourlyRateEur) : "",
      aiClientId: "",
    });
    // Ključevi AI Router-a (AI trošak klijenta ide na projekat u izveštajima)
    teamFetch<{ clients: Array<{ id: string; name: string; projectId: string | null }> }>("/delivery/ai-clients")
      .then((d) => {
        setAiClients(d.clients);
        const linked = project ? d.clients.find((c) => c.projectId === project.id) : undefined;
        setF((cur) => ({ ...cur, aiClientId: linked?.id ?? "" }));
      })
      .catch(() => setAiClients([]));
  }, [open, project]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const label = "mb-1 block text-[12px] text-muted";
  return (
    <Dialog open={open} onClose={onClose} title={project ? "Edit project" : "New project"} width={600}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const body = {
              name: f.name,
              customerId: f.customerId === "__new" ? null : f.customerId || null,
              customerName: f.customerId === "__new" ? f.customerName : undefined,
              status: f.status,
              budgetEur: f.budgetEur ? Number(f.budgetEur) : null,
              dueDate: f.dueDate ? new Date(`${f.dueDate}T12:00:00Z`).toISOString() : null,
              ownerId: f.ownerId || null,
              repoUrl: f.repoUrl,
              githubImport: f.githubImport,
              billing: f.billing,
              hourlyRateEur: f.hourlyRateEur ? Number(f.hourlyRateEur) : null,
              description: f.description,
            };
            const { project: saved } = await teamFetch<{ project: Project }>(project ? `/delivery/projects/${project.id}` : "/delivery/projects", { method: project ? "PATCH" : "POST", body: JSON.stringify(body) });
            const linked = project ? aiClients.find((c) => c.projectId === project.id)?.id ?? "" : "";
            if (f.aiClientId !== linked) await teamFetch(`/delivery/projects/${saved.id}/ai-client`, { method: "PUT", body: JSON.stringify({ clientId: f.aiClientId || null }) });
            onSaved(saved);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Project name</span>
            <input autoFocus className={`${field} h-[36px]`} value={f.name} onChange={set("name")} placeholder="e.g. Customer portal MVP" />
          </label>
          <label>
            <span className={label}>Client</span>
            <select className={`${field} h-[36px]`} value={f.customerId} onChange={set("customerId")}>
              <option value="">No client</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new">+ New client…</option>
            </select>
          </label>
          {f.customerId === "__new" ? (
            <label>
              <span className={label}>New client name</span>
              <input className={`${field} h-[36px]`} value={f.customerName} onChange={set("customerName")} placeholder="Acme GmbH" />
            </label>
          ) : (
            <label>
              <span className={label}>Status</span>
              <select className={`${field} h-[36px]`} value={f.status} onChange={set("status")}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span className={label}>Billing</span>
            <select className={`${field} h-[36px]`} value={f.billing} onChange={set("billing")}>
              <option value="fixed">Fixed price (budget)</option>
              <option value="hourly">Hourly (time × rate)</option>
            </select>
          </label>
          {f.billing === "hourly" ? (
            <label>
              <span className={label}>Client hourly rate (€)</span>
              <input className={`${field} h-[36px]`} inputMode="numeric" value={f.hourlyRateEur} onChange={set("hourlyRateEur")} placeholder="45" />
            </label>
          ) : (
            <label>
              <span className={label}>Budget (€)</span>
              <input className={`${field} h-[36px]`} inputMode="numeric" value={f.budgetEur} onChange={set("budgetEur")} placeholder="15000" />
            </label>
          )}
          <label>
            <span className={label}>Target date</span>
            <input type="date" className={`${field} h-[36px]`} value={f.dueDate} onChange={set("dueDate")} />
          </label>
          <label>
            <span className={label}>Project lead</span>
            <select className={`${field} h-[36px]`} value={f.ownerId} onChange={set("ownerId")}>
              <option value="">Nobody yet</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>GitHub repo (optional)</span>
            <input className={`${field} h-[36px]`} value={f.repoUrl} onChange={set("repoUrl")} placeholder="https://github.com/…" />
          </label>
          {aiClients.length > 0 && (
            <label className="sm:col-span-2">
              <span className={label}>AI Router key (its AI cost and savings count toward this project)</span>
              <select className={`${field} h-[36px]`} value={f.aiClientId} onChange={set("aiClientId")}>
                <option value="">None</option>
                {aiClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.projectId && c.projectId !== project?.id ? " (linked to another project)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {f.repoUrl.trim() && (
            <label className="inline-flex items-center gap-2 text-[12.5px] text-muted sm:col-span-2">
              <input type="checkbox" checked={f.githubImport} onChange={(e) => setF({ ...f, githubImport: e.target.checked })} className="accent-[var(--accent)]" />
              Import new GitHub issues from this repo into the Inbox (pull requests are always linked by issue key)
            </label>
          )}
          <label className="sm:col-span-2">
            <span className={label}>Description</span>
            <textarea className={`${field} h-24 resize-none py-2 leading-relaxed`} value={f.description} onChange={set("description")} placeholder="Goal, scope, what “done” means…" />
          </label>
          {error && (
            <div className="sm:col-span-2">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={busy || !f.name.trim()} className={btnPrimary}>
            {busy && <Loader2 size={14} className="animate-spin" />} {project ? "Save" : "Create project"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Lista projekata ──
export function ProjectsPage() {
  const user = useSessionUser();
  const { data, setData, error } = useProjects();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const shown = (data ?? []).filter((p) => filter === "all" || (p.status !== "done" && p.status !== "canceled"));
  const active = (data ?? []).filter((p) => p.status === "active");
  return (
    <>
      <PageHead title="Projects" sub="Everything the team is delivering. Won leads become projects with one click.">
        {canEdit(user) && (
          <button onClick={() => setOpen(true)} className={btnPrimary}>
            <Plus size={14} /> New project
          </button>
        )}
      </PageHead>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ["Active projects", String(active.length)],
          ["Open issues", String(active.reduce((a, p) => a + p.issues.total - p.issues.done, 0))],
          ["Active value", fmtEur(active.reduce((a, p) => a + (p.budgetEur ?? 0), 0))],
          ["Due in 14 days", String((data ?? []).filter((p) => p.dueDate && p.status !== "done" && Date.parse(p.dueDate) - Date.now() < 14 * 86_400_000).length)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-line bg-surface px-4 py-4">
            <div className="text-[12.5px] text-muted">{l}</div>
            <div className="num mt-1.5 text-[26px] font-semibold leading-tight tracking-tight">{data ? v : "—"}</div>
          </div>
        ))}
      </section>
      <div className="mb-3 inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12.5px]">
        {(["open", "all"] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`h-[28px] rounded-md px-3 ${filter === s ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
            {s === "open" ? "In progress" : "All"}
          </button>
        ))}
      </div>
      <ul className="space-y-2 md:hidden">
        {shown.map((p) => (
          <li key={p.id}>
            <a href={`#/delivery/projects/${p.id}`} className="block rounded-xl border border-line bg-surface p-3 active:bg-surface-2">
              <div className="flex items-start gap-3">
                <ProgressRing value={p.progress} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="num rounded bg-surface-2 px-1.5 py-px text-[10.5px] text-muted ring-1 ring-line">{p.key}</span>
                    <ProjectStatusPill status={p.status} />
                  </div>
                  <div className="mt-1 line-clamp-2 text-[14px] font-medium leading-snug">{p.name}</div>
                  <div className="truncate text-[12px] text-muted">{p.customerName ?? "No client"}</div>
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-3 border-t border-line pt-2 text-[12px] text-muted">
                <span className="num">
                  {p.issues.done}/{p.issues.total} done
                </span>
                <span className="num">{fmtEur(p.budgetEur)}</span>
                <span className="num">{fmtDate(p.dueDate)}</span>
                <span className="ml-auto">
                  <Avatar name={p.ownerName} size={20} />
                </span>
              </div>
            </a>
          </li>
        ))}
        {data && shown.length === 0 && <li className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-[13px] text-faint">No projects yet.</li>}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-faint">
                <th className="px-3 py-2.5 font-medium">Project</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Progress</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Budget</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Target</th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Lead</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => (window.location.hash = `#/delivery/projects/${p.id}`)}>
                  <td className="max-w-[340px] px-3 py-2.5">
                    <a href={`#/delivery/projects/${p.id}`} className="flex items-center gap-2 font-medium" onClick={(e) => e.stopPropagation()}>
                      <span className="num rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted ring-1 ring-line">{p.key}</span>
                      <span className="truncate">{p.name}</span>
                    </a>
                    <div className="mt-0.5 truncate pl-0.5 text-xs text-muted">{p.customerName ?? "No client"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <ProjectStatusPill status={p.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <ProgressRing value={p.progress} />
                      <span className="num text-[12px] text-muted">
                        {p.issues.done}/{p.issues.total}
                      </span>
                    </div>
                  </td>
                  <td className="num hidden px-3 py-2.5 md:table-cell">{fmtEur(p.budgetEur)}</td>
                  <td className={`num hidden px-3 py-2.5 md:table-cell ${p.dueDate && p.status !== "done" && Date.parse(p.dueDate) < Date.now() ? "text-danger" : "text-muted"}`}>{fmtDate(p.dueDate)}</td>
                  <td className="hidden px-3 py-2.5 sm:table-cell">
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <Avatar name={p.ownerName} size={20} /> <span className="hidden lg:inline">{p.ownerName ?? "—"}</span>
                    </span>
                  </td>
                </tr>
              ))}
              {data && shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-14 text-center">
                    <FolderKanban size={22} className="mx-auto mb-2 text-faint" />
                    <div className="text-[13.5px] font-medium">No projects yet</div>
                    <p className="mt-1 text-[12.5px] text-muted">Create one, or open a won lead and click “Create project”.</p>
                  </td>
                </tr>
              )}
              {!data &&
                [0, 1, 2].map((i) => (
                  <tr key={i} className="border-b border-line">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="h-4 animate-pulse rounded bg-surface-2" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <ProjectDialog open={open} onClose={() => setOpen(false)} onSaved={(p) => (setData((d) => [p, ...(d ?? [])]), (window.location.hash = `#/delivery/projects/${p.id}`))} />
    </>
  );
}

// ── Jedan projekat: tabla, lista, pregled ──
export function ProjectPage({ id }: { id: string }) {
  const user = useSessionUser();
  const editable = canEdit(user);
  const project = useProject(id);
  const issues = useIssues(`projectId=${id}`);
  const [view, setView] = useState<"board" | "list" | "overview">(() => {
    try {
      return (localStorage.getItem("delivery-view") as "board" | "list" | null) ?? "board";
    } catch {
      return "board";
    }
  });
  const [newOpen, setNewOpen] = useState<IssueStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [q, setQ] = useState("");
  useNewIssueShortcut(() => setNewOpen("todo"), editable && !!project.data);
  const setIssues = (f: (prev: Issue[]) => Issue[]) => issues.setData((d) => f(d ?? []));
  const p = project.data;
  const list = useMemo(() => (issues.data ?? []).filter((i) => !q || `${i.key} ${i.title} ${i.labels.join(" ")}`.toLowerCase().includes(q.toLowerCase())), [issues.data, q]);
  const sel = issues.data?.find((i) => i.id === selected) ?? null;
  const pickView = (v: typeof view) => {
    setView(v);
    try {
      if (v !== "overview") localStorage.setItem("delivery-view", v);
    } catch {
      /* bez pamćenja */
    }
  };
  // Napredak se računa iz učitanih taskova (odmah posle prevlačenja)
  const live = issues.data ? { total: issues.data.filter((i) => i.status !== "canceled" && i.status !== "triage").length, done: issues.data.filter((i) => i.status === "done").length } : null;
  const progress = live && live.total ? Math.round((live.done / live.total) * 100) : (p?.progress ?? 0);

  if (project.error) return <ErrorNote>{project.error}</ErrorNote>;
  return (
    <>
      <a href="#/delivery" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft size={13} /> Projects
      </a>
      <div className="mb-4 flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {p && <span className="num rounded bg-surface-2 px-1.5 py-px text-[12px] text-muted ring-1 ring-line">{p.key}</span>}
            <h1 className="truncate text-2xl font-semibold tracking-tight">{p?.name ?? "…"}</h1>
          </div>
          {p && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
              {editable ? (
                <Menu
                  label="Project status"
                  value={p.status}
                  onChange={async (status) => {
                    project.setData({ ...p, status });
                    const r = await teamFetch<{ project: Project }>(`/delivery/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ status }) }).catch(() => null);
                    if (r) project.setData(r.project);
                  }}
                  options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_META[s].label }))}
                  className="px-0.5"
                >
                  <ProjectStatusPill status={p.status} />
                </Menu>
              ) : (
                <ProjectStatusPill status={p.status} />
              )}
              <span className="inline-flex items-center gap-1.5">
                <ProgressRing value={progress} size={16} /> {progress}% · {live?.done ?? p.issues.done}/{live?.total ?? p.issues.total} issues
              </span>
              <span className="inline-flex items-center gap-1">
                <Building2 size={12} /> {p.customerName ?? "No client"}
              </span>
              <span className="num">{fmtEur(p.budgetEur)}</span>
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={12} /> {fmtDate(p.dueDate)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Avatar name={p.ownerName} size={16} /> {p.ownerName ?? "No lead"}
              </span>
              {p.repoUrl && (
                <a href={p.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
                  <GitBranch size={12} /> Repo
                </a>
              )}
              {p.leadId && (
                <span className="inline-flex items-center gap-1 text-faint" title="Created from a won lead">
                  from lead
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 sm:ml-auto">
          {editable && p && (
            <button onClick={() => setPortalOpen(true)} className={btnSecondary} title="Read-only page for the client">
              <Globe size={13} /> Client portal
            </button>
          )}
          {editable && p && (
            <button onClick={() => setEditOpen(true)} className={btnSecondary}>
              <Pencil size={13} /> Edit
            </button>
          )}
          {editable && p && (
            <button onClick={() => setNewOpen("todo")} className={btnPrimary} title="Shortcut: C">
              <Plus size={14} /> New issue <kbd className="ml-1 rounded border border-bg/30 px-1 text-[10px] opacity-70">C</kbd>
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12.5px]">
          {(
            [
              ["board", "Board", SquareKanban],
              ["list", "List", LayoutList],
              ["overview", "Overview", FolderKanban],
            ] as const
          ).map(([v, l, Icon]) => (
            <button key={v} onClick={() => pickView(v)} className={`inline-flex h-[28px] items-center gap-1.5 rounded-md px-2.5 ${view === v ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
              <Icon size={13} /> {l}
            </button>
          ))}
        </div>
        {view !== "overview" && (
          <label className="ml-auto flex h-[32px] w-64 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-faint focus-within:border-accent/55">
            <Search size={13} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter issues…" className="w-full bg-transparent text-fg outline-none placeholder:text-faint" />
          </label>
        )}
      </div>

      {issues.error && <ErrorNote>{issues.error}</ErrorNote>}
      {!issues.data ? (
        <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
      ) : view === "board" ? (
        <IssueBoard issues={list} setIssues={setIssues} onOpen={(i) => setSelected(i.id)} onNew={(s) => setNewOpen(s)} />
      ) : view === "list" ? (
        <IssueList issues={list} onOpen={(i) => setSelected(i.id)} />
      ) : (
        p && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="rounded-xl border border-line bg-surface p-5">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">Description</div>
              <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">{p.description || "No description yet. Click Edit to add the goal and scope."}</div>
            </div>
            <div className="space-y-2 rounded-xl border border-line bg-surface p-4 text-[13px]">
              {[
                ["Backlog / Todo", live ? (issues.data ?? []).filter((i) => i.status === "backlog" || i.status === "todo").length : 0],
                ["In progress / review", (issues.data ?? []).filter((i) => i.status === "in_progress" || i.status === "in_review").length],
                ["Done", live?.done ?? 0],
                ["Story points done", (issues.data ?? []).filter((i) => i.status === "done").reduce((a, i) => a + (i.estimate ?? 0), 0)],
              ].map(([l, v]) => (
                <div key={String(l)} className="flex justify-between">
                  <span className="text-muted">{l}</span>
                  <span className="num font-medium">{v}</span>
                </div>
              ))}
              <div className="border-t border-line pt-2 text-[12px] text-faint">Started {fmtDate(p.startDate ?? p.createdAt)}</div>
            </div>
          </div>
        )
      )}

      <NewIssueDialog open={newOpen !== null} onClose={() => setNewOpen(null)} projects={p ? [p] : []} projectId={id} status={newOpen ?? "todo"} onCreated={(i) => setIssues((prev) => [i, ...prev])} />
      {sel && <IssueDetail issue={sel} onClose={() => setSelected(null)} onChanged={(i) => setIssues((prev) => prev.map((x) => (x.id === i.id ? i : x)))} onDeleted={(rid) => (setIssues((prev) => prev.filter((x) => x.id !== rid)), setSelected(null))} />}
      {p && <ProjectDialog open={editOpen} onClose={() => setEditOpen(false)} project={p} onSaved={(np) => project.setData(np)} />}
      {p && <PortalDialog open={portalOpen} onClose={() => setPortalOpen(false)} projectId={p.id} projectName={p.name} />}
    </>
  );
}

// ── Moji taskovi ──
export function MyIssuesPage() {
  const user = useSessionUser();
  const editable = canEdit(user);
  const [scope, setScope] = useState<"me" | "all">(user?.id ? "me" : "all");
  const issues = useIssues(scope === "me" ? "assignee=me&scope=open" : "scope=open");
  const projects = useProjects();
  const [view, setView] = useState<"list" | "board">("list");
  const [selected, setSelected] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  useNewIssueShortcut(() => setNewOpen(true), editable && !!projects.data?.length);
  const setIssues = (f: (prev: Issue[]) => Issue[]) => issues.setData((d) => f(d ?? []));
  const sel = issues.data?.find((i) => i.id === selected) ?? null;
  return (
    <>
      <PageHead title="My issues" sub={scope === "me" ? "Open issues assigned to you, across all projects." : "All open issues across projects."}>
        {editable && (
          <button onClick={() => setNewOpen(true)} disabled={!projects.data?.length} className={btnPrimary} title={projects.data?.length ? "Shortcut: C" : "Create a project first"}>
            <Plus size={14} /> New issue
          </button>
        )}
      </PageHead>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12.5px]">
          {(["me", "all"] as const).map((s) => (
            <button
              key={s}
              disabled={s === "me" && !user?.id}
              title={s === "me" && !user?.id ? "Sign in with your own account to see your issues" : undefined}
              onClick={() => setScope(s)}
              className={`h-[28px] rounded-md px-3 disabled:opacity-40 ${scope === s ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}
            >
              {s === "me" ? "Assigned to me" : "All open"}
            </button>
          ))}
        </div>
        <div className="ml-auto inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12.5px]">
          {(["list", "board"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`h-[28px] rounded-md px-3 capitalize ${view === v ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>
      {issues.error && <ErrorNote>{issues.error}</ErrorNote>}
      {!issues.data ? (
        <div className="h-48 animate-pulse rounded-xl bg-surface-2" />
      ) : view === "list" ? (
        <IssueList issues={issues.data} onOpen={(i) => setSelected(i.id)} showProject empty={scope === "me" ? "Nothing assigned to you right now. 🎉" : "No open issues."} />
      ) : (
        <IssueBoard issues={issues.data} setIssues={setIssues} onOpen={(i) => setSelected(i.id)} showProject />
      )}
      <NewIssueDialog open={newOpen} onClose={() => setNewOpen(false)} projects={(projects.data ?? []).filter((p) => p.status !== "done" && p.status !== "canceled")} onCreated={(i) => setIssues((prev) => [i, ...prev])} />
      {sel && <IssueDetail issue={sel} onClose={() => setSelected(null)} onChanged={(i) => setIssues((prev) => prev.map((x) => (x.id === i.id ? i : x)))} onDeleted={(rid) => (setIssues((prev) => prev.filter((x) => x.id !== rid)), setSelected(null))} />}
    </>
  );
}

// ── Klijenti ──
function ClientDialog({ open, onClose, client, onSaved }: { open: boolean; onClose: () => void; client?: Customer; onSaved: (c: Customer) => void }) {
  const [f, setF] = useState({ name: "", website: "", country: "", contactName: "", contactEmail: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setError(null);
      setF({ name: client?.name ?? "", website: client?.website ?? "", country: client?.country ?? "", contactName: client?.contactName ?? "", contactEmail: client?.contactEmail ?? "", notes: client?.notes ?? "" });
    }
  }, [open, client]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const label = "mb-1 block text-[12px] text-muted";
  return (
    <Dialog open={open} onClose={onClose} title={client ? "Edit client" : "New client"}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const { customer } = await teamFetch<{ customer: Customer }>(client ? `/delivery/customers/${client.id}` : "/delivery/customers", { method: client ? "PATCH" : "POST", body: JSON.stringify(f) });
            onSaved({ ...(client ?? { projects: 0, activeProjects: 0, valueEur: 0 }), ...customer } as Customer);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Company name</span>
            <input autoFocus className={`${field} h-[36px]`} value={f.name} onChange={set("name")} placeholder="Acme GmbH" />
          </label>
          <label>
            <span className={label}>Contact person</span>
            <input className={`${field} h-[36px]`} value={f.contactName} onChange={set("contactName")} />
          </label>
          <label>
            <span className={label}>Contact email</span>
            <input className={`${field} h-[36px]`} type="email" value={f.contactEmail} onChange={set("contactEmail")} />
          </label>
          <label>
            <span className={label}>Website</span>
            <input className={`${field} h-[36px]`} value={f.website} onChange={set("website")} placeholder="https://" />
          </label>
          <label>
            <span className={label}>Country (2 letters)</span>
            <input className={`${field} h-[36px] uppercase`} maxLength={2} value={f.country} onChange={set("country")} placeholder="DE" />
          </label>
          <label className="sm:col-span-2">
            <span className={label}>Notes</span>
            <textarea className={`${field} h-20 resize-none py-2`} value={f.notes} onChange={set("notes")} />
          </label>
          {error && (
            <div className="sm:col-span-2">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={busy || !f.name.trim()} className={btnPrimary}>
            {busy && <Loader2 size={14} className="animate-spin" />} {client ? "Save" : "Add client"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ClientsPage() {
  const user = useSessionUser();
  const { data, setData, error } = useCustomers();
  const [edit, setEdit] = useState<Customer | null | undefined>(undefined); // undefined = zatvoreno, null = novi
  return (
    <>
      <PageHead title="Clients" sub="Companies you work for, with their projects and total value.">
        {canEdit(user) && (
          <button onClick={() => setEdit(null)} className={btnPrimary}>
            <Plus size={14} /> New client
          </button>
        )}
      </PageHead>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <ul className="space-y-2 md:hidden">
        {(data ?? []).map((c) => (
          <li key={c.id} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-lg bg-surface-2 text-[12px] text-muted ring-1 ring-line">{c.name.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">
                  {c.name} {c.country && flag(c.country)}
                </div>
                <div className="truncate text-[12px] text-muted">{c.contactName ?? c.contactEmail ?? "No contact yet"}</div>
              </div>
              {canEdit(user) && (
                <button onClick={() => setEdit(c)} className="grid size-8 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-fg" aria-label={`Edit ${c.name}`}>
                  <Pencil size={14} />
                </button>
              )}
            </div>
            <div className="mt-2.5 flex gap-4 border-t border-line pt-2 text-[12px] text-muted">
              <span className="num">
                {c.activeProjects} active · {c.projects} total
              </span>
              <span className="num ml-auto font-medium text-fg">{fmtEur(c.valueEur || null)}</span>
            </div>
          </li>
        ))}
        {data && data.length === 0 && <li className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-[13px] text-faint">No clients yet.</li>}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-faint">
                <th className="px-3 py-2.5 font-medium">Client</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Contact</th>
                <th className="px-3 py-2.5 font-medium">Projects</th>
                <th className="px-3 py-2.5 font-medium">Value</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="grid size-7 place-items-center rounded-md bg-surface-2 text-[11px] text-muted ring-1 ring-line">{c.name.slice(0, 2).toUpperCase()}</span>
                      <span className="truncate">{c.name}</span>
                      {c.country && <span>{flag(c.country)}</span>}
                      {c.website && (
                        <a href={c.website} target="_blank" rel="noreferrer" className="text-faint hover:text-fg" aria-label={`Open ${c.name} website`}>
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                    {c.leadId && <div className="mt-0.5 pl-9 text-[11.5px] text-faint">Won from a lead</div>}
                  </td>
                  <td className="hidden px-3 py-2.5 text-muted md:table-cell">
                    {c.contactName ?? "—"}
                    {c.contactEmail && (
                      <a href={`mailto:${c.contactEmail}`} className="block text-[12px] text-faint hover:text-fg">
                        {c.contactEmail}
                      </a>
                    )}
                  </td>
                  <td className="num px-3 py-2.5">
                    {c.activeProjects}
                    <span className="text-faint"> active · {c.projects} total</span>
                  </td>
                  <td className="num px-3 py-2.5">{fmtEur(c.valueEur || null)}</td>
                  <td className="px-3 py-2.5">
                    {canEdit(user) && (
                      <button onClick={() => setEdit(c)} className="grid size-7 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-fg" aria-label={`Edit ${c.name}`}>
                        <Pencil size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-14 text-center">
                    <Users size={22} className="mx-auto mb-2 text-faint" />
                    <div className="text-[13.5px] font-medium">No clients yet</div>
                    <p className="mt-1 text-[12.5px] text-muted">They’re added automatically when you create a project from a won lead.</p>
                  </td>
                </tr>
              )}
              {!data &&
                [0, 1].map((i) => (
                  <tr key={i} className="border-b border-line">
                    <td colSpan={5} className="px-3 py-3">
                      <div className="h-4 animate-pulse rounded bg-surface-2" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <ClientDialog
        open={edit !== undefined}
        client={edit ?? undefined}
        onClose={() => setEdit(undefined)}
        onSaved={(c) => setData((d) => (d?.some((x) => x.id === c.id) ? d.map((x) => (x.id === c.id ? c : x)) : [...(d ?? []), c].sort((a, b) => a.name.localeCompare(b.name))))}
      />
    </>
  );
}

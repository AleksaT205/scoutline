import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BarChart3, Building2, CircleDot, FolderKanban, Inbox, Kanban, LayoutGrid, Moon, Plus, Route, Rss, Search, Settings, Sparkles, SquareCheck, Users } from "lucide-react";
import { teamFetch } from "../lib/team";
import { onlySpace, useSessionUser } from "../lib/session";

/**
 * ⌘K / Ctrl+K paleta: traži taskove (i po ključu PZS-12), projekte, klijente i leadove, i brze radnje.
 * Strelice ↑↓ biraju, Enter otvara, Esc zatvara. Na telefonu je otvara dugme 🔍 gore.
 */
interface Results {
  tasks: Array<{ id: string; number: number; title: string; status: string; projectId: string; key: string; project: string }>;
  projects: Array<{ id: string; key: string; name: string; status: string }>;
  clients: Array<{ id: string; name: string }>;
  leads: Array<{ id: string; title: string; score: number | null; status: string; company: string | null }>;
}
interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}
const go = (hash: string) => {
  window.location.hash = hash;
};

export function CommandPalette({ open, onClose, onToggleTheme }: { open: boolean; onClose: () => void; onToggleTheme: () => void }) {
  const user = useSessionUser();
  const space = onlySpace(user);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setRes(null);
    setActive(0);
    setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  // Pretraga na serveru (kratko čekanje dok se kuca)
  useEffect(() => {
    if (!open || q.trim().length < 2) return setRes(null);
    const t = setTimeout(() => {
      teamFetch<Results>(`/search?q=${encodeURIComponent(q.trim())}`)
        .then(setRes)
        .catch(() => setRes(null));
    }, 160);
    return () => clearTimeout(t);
  }, [q, open]);

  const actions: Item[] = useMemo(() => {
    const a: Item[] = [];
    const nav = (id: string, label: string, hash: string, icon: React.ReactNode) => a.push({ id, group: "Go to", label, icon, run: () => go(hash) });
    if (space !== "sales") {
      nav("projects", "Projects", "#/delivery", <FolderKanban size={15} />);
      nav("mytasks", "My tasks", "#/delivery/issues", <SquareCheck size={15} />);
      nav("inbox", "Inbox", "#/delivery/inbox", <Inbox size={15} />);
      nav("clients", "Clients", "#/delivery/clients", <Building2 size={15} />);
      nav("cycles", "Cycles", "#/delivery/cycles", <CircleDot size={15} />);
      nav("reports", "Reports", "#/delivery/reports", <BarChart3 size={15} />);
      nav("assistant", "Assistant", "#/delivery/assistant", <Sparkles size={15} />);
    }
    if (space !== "delivery") {
      nav("leads", "Leads", "#/", <LayoutGrid size={15} />);
      nav("pipeline", "Pipeline", "#/pipeline", <Kanban size={15} />);
      nav("sources", "Sources", "#/sources", <Rss size={15} />);
      nav("router", "AI Router", "#/router", <Route size={15} />);
      a.push({ id: "addlead", group: "Actions", label: "Add a lead", icon: <Plus size={15} />, run: () => window.dispatchEvent(new Event("open-add-lead")) });
    }
    nav("team", "Team", "#/team", <Users size={15} />);
    nav("settings", "Settings", "#/settings", <Settings size={15} />);
    a.push({ id: "theme", group: "Actions", label: "Toggle dark / light mode", icon: <Moon size={15} />, run: onToggleTheme });
    // Grupe moraju biti u komadu (naslov grupe se ispisuje pri svakoj promeni)
    return [...a.filter((x) => x.group === "Go to"), ...a.filter((x) => x.group !== "Go to")];
  }, [space, onToggleTheme]);

  const items: Item[] = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out: Item[] = [];
    if (res) {
      for (const x of res.tasks) out.push({ id: `t:${x.id}`, group: "Tasks", label: x.title, hint: `${x.key}-${x.number} · ${x.project}`, icon: <SquareCheck size={15} />, run: () => go(`#/delivery/projects/${x.projectId}?view=list&task=${x.id}`) });
      for (const x of res.projects) out.push({ id: `p:${x.id}`, group: "Projects", label: x.name, hint: x.key, icon: <FolderKanban size={15} />, run: () => go(`#/delivery/projects/${x.id}`) });
      for (const x of res.clients) out.push({ id: `c:${x.id}`, group: "Clients", label: x.name, icon: <Building2 size={15} />, run: () => go("#/delivery/clients") });
      for (const x of res.leads)
        out.push({
          id: `l:${x.id}`,
          group: "Leads",
          label: x.title,
          hint: `${x.score ?? "—"} · ${x.company ?? x.status}`,
          icon: <LayoutGrid size={15} />,
          run: () => {
            go("#/");
            setTimeout(() => window.dispatchEvent(new CustomEvent("select-lead", { detail: x.id })), 50);
          },
        });
    }
    const acts = t ? actions.filter((a) => a.label.toLowerCase().includes(t)) : actions;
    return [...out, ...acts];
  }, [res, actions, q]);

  useEffect(() => setActive(0), [items.length]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const choose = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    it.run();
  };
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search and commands" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-surface shadow-float">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((i) => Math.min(items.length - 1, i + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
              else if (e.key === "Enter") (e.preventDefault(), choose(items[active]));
              else if (e.key === "Escape") (e.preventDefault(), onClose());
            }}
            placeholder="Search tasks, projects, leads… or type a command"
            className="h-[52px] w-full bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-faint sm:inline">Esc</kbd>
        </div>
        <div ref={list} className="max-h-[56vh] overflow-y-auto overflow-x-hidden p-1.5">
          {items.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-faint">{q.trim().length < 2 ? "Type to search" : "Nothing found"}</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? ((lastGroup = it.group), it.group) : null;
            return (
              <div key={it.id}>
                {head && <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">{head}</div>}
                <button
                  data-i={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(it)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${i === active ? "bg-surface-2 text-fg" : "text-muted"}`}
                >
                  <span className="shrink-0 text-faint">{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{it.label}</span>
                  {it.hint && <span className="num max-w-[40%] truncate text-[12px] text-faint">{it.hint}</span>}
                  {i === active && <ArrowRight size={13} className="shrink-0 text-faint" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-faint sm:flex">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span className="ml-auto">⌘K anywhere</span>
        </div>
      </div>
    </div>
  );
}

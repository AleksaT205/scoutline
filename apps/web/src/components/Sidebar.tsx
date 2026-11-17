import { BarChart3, Building2, CircleDot, FolderKanban, Inbox, MessagesSquare, ListTodo, Kanban, LayoutGrid, RefreshCcw, Rss, Search, Settings, Users, X } from "lucide-react";
import { useInboxCount } from "../lib/delivery";
import { onlySpace, useSessionUser } from "../lib/session";
import type { ApiStatus } from "../lib/api";

const prospecting = (leadCount: number) => [
  { label: "Overview", icon: LayoutGrid, href: "#/overview" },
  { label: "Leads", icon: Search, count: leadCount, href: "#/" },
  { label: "Pipeline", icon: Kanban, href: "#/pipeline" },
  { label: "Sources", icon: Rss, href: "#/sources" },
];
const delivery = [
  { label: "Inbox", icon: Inbox, href: "#/delivery/inbox", page: "inbox" },
  { label: "My issues", icon: CircleDot, href: "#/delivery/issues", page: "issues" },
  { label: "Projects", icon: FolderKanban, href: "#/delivery", page: "projects" },
  { label: "Cycles", icon: RefreshCcw, href: "#/delivery/cycles", page: "cycles" },
  { label: "Clients", icon: Building2, href: "#/delivery/clients", page: "clients" },
  { label: "Reports", icon: BarChart3, href: "#/delivery/reports", page: "reports" },
  { label: "Assistant", icon: MessagesSquare, href: "#/delivery/assistant", page: "assistant" },
];
export const DELIVERY_PAGES = ["inbox", "issues", "projects", "project", "cycles", "clients", "reports", "assistant"];
const formatCost = (v?: number) => (v === undefined ? "—" : v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

const workspace = [
  { label: "Tasks", icon: ListTodo, href: "#/tasks" },
  { label: "Team", icon: Users, href: "#/team" },
  { label: "Settings", icon: Settings, href: "#/settings" },
];

function NavItem({ label, icon: Icon, count, active, href, soon }: { label: string; icon: typeof Search; count?: number; active?: boolean; href?: string; soon?: boolean }) {
  if (soon) {
    return (
      <span className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-[7px] text-[13.5px] text-faint" title="Coming soon">
        <Icon size={16} strokeWidth={1.8} />
        {label}
        <span className="ml-auto text-[10px] uppercase tracking-wider">soon</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      className={`flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[13.5px] transition-colors ${
        active ? "bg-surface-2 text-fg ring-1 ring-line ring-inset" : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      <Icon size={16} strokeWidth={1.8} />
      {label}
      {count !== undefined && <span className={`num ml-auto text-[11px] ${active ? "text-accent" : "text-muted"}`}>{count}</span>}
    </a>
  );
}

function StatusCard({ status, aiCostUsd }: { status: ApiStatus; aiCostUsd?: number }) {
  const online = status.state === "online";
  const dot = online ? "bg-success" : status.state === "offline" ? "bg-danger" : "bg-faint";
  const title = online ? "All systems normal" : status.state === "offline" ? "Service unavailable" : "Checking status…";
  const detail = online
    ? `Response ${status.latencyMs} ms · checked just now`
    : status.state === "offline"
      ? "Reconnecting automatically"
      : "Connecting…";
  return (
    <div className="rounded-[10px] border border-line bg-surface p-3 text-xs text-muted">
      <div className="mb-1 flex items-center gap-2 font-medium text-fg">
        <span className={`size-[7px] rounded-full ${dot} ${online ? "shadow-[0_0_0_3px_var(--success-soft)]" : ""}`} />
        {title}
      </div>
      <div>{detail}</div>
    </div>
  );
}

export function Sidebar({ status, open, onClose, leadCount, aiCostUsd, page }: { status: ApiStatus; open: boolean; onClose: () => void; leadCount: number; aiCostUsd?: number; page: string }) {
  const inbox = useInboxCount(DELIVERY_PAGES.includes(page));
  const only = onlySpace(useSessionUser()); // korisnik sa pristupom samo jednom delu nema prekidač
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col gap-5 border-r border-line bg-bg px-3 py-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-2 font-semibold tracking-tight">
          <div className="grid size-[26px] place-items-center rounded-[7px] bg-gradient-to-br from-accent to-[#b4a9ff] shadow-[0_6px_18px_-6px_var(--accent)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </div>
          Scoutline
          <span className="ml-auto rounded border border-line px-1.5 text-[11px] font-normal text-faint">Beta</span>
          <button className="text-muted lg:hidden" onClick={onClose} aria-label="Close menu">
            <X size={16} />
          </button>
        </div>
        {/* Prostor: prodaja (leadovi) ili isporuka (projekti) — kao timovi u Linear-u */}
        {!only && (
        <div className="grid grid-cols-2 rounded-lg border border-line bg-surface p-0.5 text-[12.5px]" role="tablist" aria-label="Workspace area">
          {(
            [
              ["Sales", "#/", !DELIVERY_PAGES.includes(page)],
              ["Delivery", "#/delivery", DELIVERY_PAGES.includes(page)],
            ] as const
          ).map(([label, href, on]) => (
            <a key={label} href={href} role="tab" aria-selected={on} className={`rounded-md py-1 text-center transition-colors ${on ? "bg-surface-2 font-medium text-fg ring-1 ring-line ring-inset" : "text-muted hover:text-fg"}`}>
              {label}
            </a>
          ))}
        </div>
        )}
        {DELIVERY_PAGES.includes(page) ? (
          <nav className="flex flex-col gap-0.5">
            <div className="px-2 pb-1.5 text-[11px] uppercase tracking-wider text-faint">Delivery</div>
            {delivery.map((i) => (
              <NavItem key={i.label} label={i.label} icon={i.icon} href={i.href} count={i.page === "inbox" && inbox ? inbox : undefined} active={page === i.page || (i.page === "projects" && page === "project")} />
            ))}
          </nav>
        ) : (
          <nav className="flex flex-col gap-0.5">
            <div className="px-2 pb-1.5 text-[11px] uppercase tracking-wider text-faint">Prospecting</div>
            {prospecting(leadCount).map((i) => (
              <NavItem key={i.label} {...i} active={(i.label === "Leads" && page === "leads") || (i.label === "Sources" && page === "sources") || (i.label === "Pipeline" && page === "pipeline") || (i.label === "Overview" && page === "overview")} />
            ))}
          </nav>
        )}
        <nav className="flex flex-col gap-0.5">
          <div className="px-2 pb-1.5 text-[11px] uppercase tracking-wider text-faint">Workspace</div>
          {workspace.map((i) => (
            <NavItem key={i.label} {...i} active={page === i.label.toLowerCase()} />
          ))}
        </nav>
        <div className="mt-auto">
          <StatusCard status={status} aiCostUsd={aiCostUsd} />
        </div>
      </aside>
    </>
  );
}

import { BarChart3, Kanban, LayoutGrid, Rss, Search, Settings, Users, X } from "lucide-react";
import type { ApiStatus } from "../lib/api";

const prospecting = (leadCount: number) => [
  { label: "Overview", icon: LayoutGrid },
  { label: "Leads", icon: Search, count: leadCount },
  { label: "Pipeline", icon: Kanban },
  { label: "Sources", icon: Rss, count: 7 },
  { label: "Analytics", icon: BarChart3 },
];
const workspace = [
  { label: "Team", icon: Users },
  { label: "Settings", icon: Settings },
];

function NavItem({ label, icon: Icon, count, active }: { label: string; icon: typeof Search; count?: number; active?: boolean }) {
  return (
    <a
      href="#"
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

function StatusCard({ status }: { status: ApiStatus }) {
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
      <div className="mt-0.5">
        AI cost this month: <b className="num font-medium text-fg">€0.00</b>
      </div>
    </div>
  );
}

export function Sidebar({ status, open, onClose, leadCount }: { status: ApiStatus; open: boolean; onClose: () => void; leadCount: number }) {
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
        <nav className="flex flex-col gap-0.5">
          <div className="px-2 pb-1.5 text-[11px] uppercase tracking-wider text-faint">Prospecting</div>
          {prospecting(leadCount).map((i) => (
            <NavItem key={i.label} {...i} active={i.label === "Leads"} />
          ))}
        </nav>
        <nav className="flex flex-col gap-0.5">
          <div className="px-2 pb-1.5 text-[11px] uppercase tracking-wider text-faint">Workspace</div>
          {workspace.map((i) => (
            <NavItem key={i.label} {...i} />
          ))}
        </nav>
        <div className="mt-auto">
          <StatusCard status={status} />
        </div>
      </aside>
    </>
  );
}

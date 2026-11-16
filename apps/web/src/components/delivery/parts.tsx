import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { IssueStatus, ProjectStatus } from "@radar/shared";
import { initials } from "../../lib/delivery";

/** Zajednički delovi za Delivery: ikonice statusa i prioriteta (kao Linear), avatar, meni za izbor, prozor. */
export const ISSUE_STATUS_META: Record<IssueStatus, { label: string; color: string }> = {
  triage: { label: "Triage", color: "var(--accent)" },
  backlog: { label: "Backlog", color: "var(--faint)" },
  todo: { label: "Todo", color: "var(--muted)" },
  in_progress: { label: "In Progress", color: "var(--warning)" },
  in_review: { label: "In Review", color: "var(--success)" },
  done: { label: "Done", color: "var(--accent)" },
  canceled: { label: "Canceled", color: "var(--faint)" },
};
export const BOARD_STATUSES: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];

export const PRIORITY_META = [
  { value: 0, label: "No priority" },
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
];

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  planned: { label: "Planned", cls: "bg-surface-2 text-muted ring-line" },
  active: { label: "Active", cls: "bg-accent-soft text-accent ring-accent/30" },
  paused: { label: "Paused", cls: "bg-warning/10 text-warning ring-warning/30" },
  done: { label: "Done", cls: "bg-success-soft text-success ring-success/30" },
  canceled: { label: "Canceled", cls: "bg-surface-2 text-faint ring-line" },
};

export function StatusIcon({ status, size = 14 }: { status: IssueStatus; size?: number }) {
  const c = ISSUE_STATUS_META[status].color;
  const r = 6;
  const circ = 2 * Math.PI * 3;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label={ISSUE_STATUS_META[status].label} className="shrink-0">
      {status === "triage" && (
        <>
          <circle cx="8" cy="8" r="7" fill="none" stroke={c} strokeWidth="1.6" />
          <path d="M5 8h4.5M7.8 5.8L10 8l-2.2 2.2" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === "backlog" && <circle cx="8" cy="8" r={r} fill="none" stroke={c} strokeWidth="1.6" strokeDasharray="2 2.2" />}
      {status === "todo" && <circle cx="8" cy="8" r={r} fill="none" stroke={c} strokeWidth="1.6" />}
      {(status === "in_progress" || status === "in_review") && (
        <>
          <circle cx="8" cy="8" r={r} fill="none" stroke={c} strokeWidth="1.6" />
          <circle cx="8" cy="8" r="3" fill="none" stroke={c} strokeWidth="6" strokeDasharray={`${circ * (status === "in_progress" ? 0.5 : 0.75)} ${circ}`} transform="rotate(-90 8 8)" />
        </>
      )}
      {status === "done" && (
        <>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === "canceled" && (
        <>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function PriorityIcon({ priority, size = 14 }: { priority: number; size?: number }) {
  const label = PRIORITY_META[priority]?.label ?? "No priority";
  if (priority === 1)
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label={label} className="shrink-0">
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="var(--warning)" />
        <path d="M8 4.5v4.5M8 11.2v.3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  if (priority === 0)
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label={label} className="shrink-0">
        {[3, 7, 11].map((x) => (
          <rect key={x} x={x} y="7.2" width="2.2" height="1.6" rx=".6" fill="var(--faint)" />
        ))}
      </svg>
    );
  const filled = priority === 2 ? 3 : priority === 3 ? 2 : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label={label} className="shrink-0">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2 + i * 4.3} y={11 - i * 3.5} width="2.8" height={3 + i * 3.5} rx=".8" fill={i < filled ? "var(--muted)" : "var(--border-2)"} />
      ))}
    </svg>
  );
}

export function Avatar({ name, size = 20 }: { name: string | null | undefined; size?: number }) {
  if (!name)
    return (
      <span className="grid shrink-0 place-items-center rounded-full border border-dashed border-line-2 text-faint" style={{ width: size, height: size }} aria-label="Unassigned">
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="8" cy="5.5" r="2.8" />
          <path d="M2.8 14c.8-2.8 2.8-4.2 5.2-4.2s4.4 1.4 5.2 4.2" />
        </svg>
      </span>
    );
  // Stabilna boja po imenu
  const hue = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-medium text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${hue} 55% 52%), hsl(${(hue + 40) % 360} 55% 40%))` }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export interface MenuOption<V> {
  value: V;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
}

/** Mali padajući meni (kao Linear): dugme sa trenutnom vrednošću, lista sa pretragom i strelicama. */
export function Menu<V extends string | number | null>({
  value,
  options,
  onChange,
  children,
  label,
  className = "",
  disabled,
  align = "left",
}: {
  value: V;
  options: Array<MenuOption<V>>;
  onChange: (v: V) => void;
  children: React.ReactNode;
  label: string;
  className?: string;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (open) {
      setQ("");
      setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const pick = (v: V) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md text-[12.5px] transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent ${className}`}
      >
        {children}
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 w-56 rounded-lg border border-line bg-surface p-1 shadow-float ${align === "right" ? "right-0" : "left-0"}`} role="listbox">
          {options.length > 6 && (
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              placeholder={`${label}…`}
              className="mb-1 h-[30px] w-full rounded-md border border-line bg-bg px-2 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(shown.length - 1, h + 1)));
                if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
                if (e.key === "Enter" && shown[hi]) (e.preventDefault(), pick(shown[hi]!.value));
                if (e.key === "Escape") setOpen(false);
              }}
            />
          )}
          <div className="max-h-64 overflow-y-auto">
            {shown.map((o, i) => (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onMouseMove={() => hi !== i && setHi(i)}
                onClick={() => pick(o.value)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${i === hi ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-[11px] text-faint">{o.hint}</span>}
                {o.value === value && <Check size={13} className="text-accent" />}
              </button>
            ))}
            {shown.length === 0 && <div className="px-2 py-2 text-[12px] text-faint">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Prozor (modal) sa zatamnjenom pozadinom; Esc zatvara. */
export function Dialog({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-items-center overflow-y-auto bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full rounded-[14px] border border-line bg-surface shadow-float" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="ml-auto text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ProgressRing({ value, size = 18 }: { value: number; size?: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" className="shrink-0" aria-label={`${value}% done`}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border-2)" strokeWidth="2" />
      <circle cx="9" cy="9" r={r} fill="none" stroke={value >= 100 ? "var(--success)" : "var(--accent)"} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 9 9)" />
    </svg>
  );
}

export const field = "w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60";
export const btnPrimary = "inline-flex h-[34px] items-center justify-center gap-1.5 rounded-[7px] bg-fg px-3.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40";
export const btnSecondary = "inline-flex h-[34px] items-center justify-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50";

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{children}</div>;
}

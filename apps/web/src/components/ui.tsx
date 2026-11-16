import type { LeadStatus, LeadType, ServiceCategory, Tier } from "@radar/shared";

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  fullstack_app: "Full-stack app",
  web_frontend: "Web frontend",
  backend_api: "Backend / API",
  mobile: "Mobile",
  ai_integration: "AI integration",
  automation: "Automation",
  devops_deploy: "DevOps / deploy",
  bugfix_maintenance: "Bug fix / maintenance",
  other_dev: "Other dev",
  not_relevant: "Not relevant",
};

export const STATUS_META: Record<LeadStatus, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-surface-2 text-muted ring-line" },
  contacted: { label: "Contacted", cls: "bg-accent-soft text-accent ring-accent/30" },
  replied: { label: "Replied", cls: "bg-warning/10 text-warning ring-warning/30" },
  meeting: { label: "Meeting", cls: "bg-[#0ea5e9]/10 text-[#0ea5e9] ring-[#0ea5e9]/30" },
  won: { label: "Won", cls: "bg-success-soft text-success ring-success/30" },
  lost: { label: "Lost", cls: "bg-danger/10 text-danger ring-danger/30" },
  hidden: { label: "Hidden", cls: "bg-surface-2 text-faint ring-line" },
};

export function StatusPill({ status }: { status: LeadStatus }) {
  const m = STATUS_META[status];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m.cls}`}>{m.label}</span>;
}

export function industryLabel(industry: string) {
  const s = industry.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function flag(country: string | null | undefined) {
  if (!country) return "🌍";
  return country
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function scoreColor(score: number) {
  return score >= 75 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--faint)";
}

export function ScoreRing({ score, size = 34, stroke = 3 }: { score: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2 - 0.5;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`Score ${score}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <b
        className="absolute inset-0 grid place-items-center font-mono font-medium"
        style={{ fontSize: size >= 56 ? 18 : 11 }}
      >
        {score}
      </b>
    </div>
  );
}

export function TierBadge({ tier }: { tier: Tier | null }) {
  const label = tier === "DOMESTIC" ? "SR" : (tier ?? "—");
  const strong = tier === "T1";
  return (
    <span
      className={`rounded px-1.5 py-px font-mono text-[10.5px] font-medium ring-1 ring-inset ${
        strong ? "bg-accent-soft text-accent ring-accent/40" : "text-muted ring-line-2"
      }`}
    >
      {label}
    </span>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11.5px] text-muted">
      {children}
    </span>
  );
}

export function timeAgo(minutes: number | null) {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.round(minutes / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export const TYPE_META: Record<LeadType, { label: string; short: string; hint: string; cls: string }> = {
  tender: { label: "Tenders", short: "Tender", hint: "Javne nabavke (EU TED, UK, Kanada…) — postoji budžet i rok", cls: "bg-success-soft text-success ring-success/30" },
  project: { label: "Projects", short: "Project", hint: "Konkretan projekat za spoljnu ekipu (contract, freelance, agencija)", cls: "bg-accent-soft text-accent ring-accent/30" },
  intent: { label: "Intent", short: "Intent", hint: "Firma je dobila investiciju ili raste — proaktivan kontakt", cls: "bg-[#0ea5e9]/10 text-[#0ea5e9] ring-[#0ea5e9]/30" },
  hiring_signal: { label: "Hiring signals", short: "Hiring", hint: "Oglas za posao — slab signal (firma zapošljava, možda joj treba i agencija)", cls: "bg-surface-2 text-muted ring-line" },
};

export function TypeBadge({ type }: { type: LeadType | undefined }) {
  if (!type) return null;
  const m = TYPE_META[type];
  return (
    <span title={m.hint} className={`whitespace-nowrap rounded-full px-1.5 py-px text-[10.5px] font-medium ring-1 ring-inset ${m.cls}`}>
      {m.short}
    </span>
  );
}

/** Dana do roka (zaokruženo nagore); null ako nema roka. */
export function daysLeft(deadline: string | null | undefined) {
  if (!deadline) return null;
  return Math.ceil((Date.parse(deadline) - Date.now()) / 86_400_000);
}

export function DeadlineChip({ deadline }: { deadline: string | null | undefined }) {
  const d = daysLeft(deadline);
  if (d === null) return null;
  const cls = d <= 5 ? "text-danger" : d <= 14 ? "text-warning" : "text-muted";
  return <span className={`num whitespace-nowrap text-[11.5px] ${cls}`}>{d < 0 ? "Closed" : d === 0 ? "Due today" : `${d}d left`}</span>;
}

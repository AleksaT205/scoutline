import type { UiLead } from "../data/demo";

function Card({ label, value, trend, children, glow }: { label: string; value: string; trend: React.ReactNode; children: React.ReactNode; glow?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface px-4 pt-4 pb-3">
      {glow && (
        <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_65%)]" />
      )}
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="flex items-end justify-between gap-2.5">
        <div>
          <div className="num mt-1.5 text-[30px] font-semibold leading-tight tracking-tight">{value}</div>
          <div className="mt-1.5 text-xs text-success">{trend}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Kpis({ leads, newToday }: { leads: UiLead[]; newToday?: number }) {
  const highFit = leads.filter((l) => l.score >= 70).length;
  const t1Share = Math.round((leads.filter((l) => l.tier === "T1").length / Math.max(leads.length, 1)) * 100);
  const pipeline = leads.filter((l) => l.score >= 70).reduce((s, l) => s + l.budgetEur, 0);
  const dash = (t1Share / 100) * 106.8;

  return (
    <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card label="New today" value={String(newToday ?? leads.length)} trend={<>↑ 18% <span className="text-faint">vs yesterday</span></>} glow>
        <svg width="92" height="36" viewBox="0 0 92 36" aria-hidden>
          <defs>
            <linearGradient id="kpi-g1" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity=".35" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 28 L12 24 L24 26 L36 18 L48 20 L60 12 L72 14 L84 6 L92 8 L92 36 L0 36Z" fill="url(#kpi-g1)" />
          <path d="M0 28 L12 24 L24 26 L36 18 L48 20 L60 12 L72 14 L84 6 L92 8" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
        </svg>
      </Card>
      <Card label="High fit (score ≥ 70)" value={String(highFit)} trend={<>↑ 4 <span className="text-faint">vs yesterday</span></>}>
        <svg width="92" height="36" viewBox="0 0 92 36" aria-hidden>
          <path d="M0 26 L12 27 L24 22 L36 23 L48 17 L60 19 L72 13 L84 11 L92 9" fill="none" stroke="var(--success)" strokeWidth="1.6" />
        </svg>
      </Card>
      <Card label="From Tier 1 markets" value={`${t1Share}%`} trend={<>↑ 6 pts <span className="text-faint">this week</span></>}>
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
          <circle cx="22" cy="22" r="17" fill="none" stroke="var(--border)" strokeWidth="5" />
          <circle cx="22" cy="22" r="17" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${dash} 106.8`} transform="rotate(-90 22 22)" />
        </svg>
      </Card>
      <Card label="High-fit value" value={`€${(pipeline / 1000).toFixed(1)}k`} trend={<>↑ €9.4k <span className="text-faint">this month</span></>}>
        <svg width="92" height="36" viewBox="0 0 92 36" aria-hidden>
          <g fill="var(--accent)">
            {[22, 18, 20, 13, 15, 9, 4].map((y, i) => (
              <rect key={i} x={2 + i * 13} y={y} width="9" height={36 - y} rx="2" opacity={0.35 + i * 0.11} />
            ))}
          </g>
        </svg>
      </Card>
    </section>
  );
}

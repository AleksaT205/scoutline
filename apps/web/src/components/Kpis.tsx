import type { UiLead } from "../data/demo";

const DAY = 86_400_000;

function Card({ label, value, trend, children, glow }: { label: string; value: string; trend: React.ReactNode; children: React.ReactNode; glow?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface px-3 pt-3 pb-2.5 sm:px-4 sm:pt-4 sm:pb-3">
      {glow && (
        <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_65%)]" />
      )}
      <div className="truncate text-[12px] text-muted sm:text-[12.5px]">{label}</div>
      <div className="flex items-end justify-between gap-2.5">
        <div>
          <div className="num mt-1 text-[22px] font-semibold leading-tight tracking-tight sm:mt-1.5 sm:text-[30px]">{value}</div>
          <div className="mt-1 truncate text-[11px] sm:mt-1.5 sm:text-xs">{trend}</div>
        </div>
        <div className="hidden sm:block">{children}</div>
      </div>
    </div>
  );
}

function Trend({ delta, unit = "", suffix }: { delta: number | null; unit?: string; suffix: string }) {
  if (delta === null) return <span className="text-faint">{suffix}</span>;
  const up = delta > 0;
  const flat = delta === 0;
  return (
    <span className={flat ? "text-faint" : up ? "text-success" : "text-danger"}>
      {flat ? "→" : up ? "↑" : "↓"} {Math.abs(delta)}
      {unit} <span className="text-faint">{suffix}</span>
    </span>
  );
}

/** Mala linija iz niza brojeva (npr. leadovi po danu). */
function Spark({ values, color, area, id }: { values: number[]; color: string; area?: boolean; id: string }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * 92, 32 - (v / max) * 26] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg width="92" height="36" viewBox="0 0 92 36" aria-hidden>
      {area && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".35" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L92 36 L0 36Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

const ts = (l: UiLead) => (l.createdAt ? Date.parse(l.createdAt) : NaN);
const inRange = (l: UiLead, from: number, to: number) => {
  const t = ts(l);
  return t >= from && t < to;
};
const pctChange = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : null) : Math.round(((now - before) / before) * 100));

export function Kpis({ leads }: { leads: UiLead[] }) {
  const live = leads.some((l) => l.createdAt);
  const now = Date.now();

  // Dnevni nizovi za poslednjih 8 dana (najstariji → danas)
  const days = Array.from({ length: 8 }, (_, i) => now - (7 - i) * DAY);
  const perDay = (pred: (l: UiLead) => boolean) => days.map((d) => leads.filter((l) => pred(l) && inRange(l, d - DAY, d + 1)).length);

  const today = leads.filter((l) => inRange(l, now - DAY, now + 1));
  const yesterday = leads.filter((l) => inRange(l, now - 2 * DAY, now - DAY));
  const highToday = today.filter((l) => l.score >= 70).length;
  const highYesterday = yesterday.filter((l) => l.score >= 70).length;

  const week = leads.filter((l) => inRange(l, now - 7 * DAY, now + 1));
  const prevWeek = leads.filter((l) => inRange(l, now - 14 * DAY, now - 7 * DAY));
  const share = (arr: UiLead[]) => (arr.length ? Math.round((arr.filter((l) => l.tier === "T1").length / arr.length) * 100) : 0);

  // Medijan navedenog budžeta (često godišnja plata) za leadove sa ocenom ≥ 70 — zbir bi bio nerealno velik
  const median = (arr: UiLead[]) => {
    const v = arr.filter((l) => l.score >= 70 && l.budgetEur > 0).map((l) => l.budgetEur).sort((a, b) => a - b);
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
  };
  const valueWeek = median(week);
  const valuePrev = median(prevWeek);
  const withBudget = week.filter((l) => l.score >= 70 && l.budgetEur > 0).length;

  // Bez pravih datuma (primeri) — prikaz kao u dizajnu
  const t1 = live ? share(week) : share(leads);
  const dash = (t1 / 100) * 106.8;

  return (
    <section className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
      <Card
        label="New today"
        value={String(live ? today.length : leads.length)}
        trend={
          live ? (
            <Trend delta={pctChange(today.length, yesterday.length)} unit="%" suffix={yesterday.length ? "vs yesterday" : "first day of data"} />
          ) : (
            <Trend delta={18} unit="%" suffix="vs yesterday" />
          )
        }
        glow
      >
        <Spark id="kpi-new" values={live ? perDay(() => true) : [2, 4, 3, 6, 5, 8, 7, 10]} color="var(--accent)" area />
      </Card>
      <Card
        label="High fit (score ≥ 70)"
        value={String(live ? highToday : leads.filter((l) => l.score >= 70).length)}
        trend={live ? <Trend delta={yesterday.length ? highToday - highYesterday : null} suffix={yesterday.length ? "vs yesterday" : "added today"} /> : <Trend delta={4} suffix="vs yesterday" />}
      >
        <Spark id="kpi-high" values={live ? perDay((l) => l.score >= 70) : [2, 1, 3, 2, 4, 3, 5, 6]} color="var(--success)" />
      </Card>
      <Card
        label={live ? "Tier 1 share · 7 days" : "From Tier 1 markets"}
        value={`${t1}%`}
        trend={
          live ? (
            <Trend delta={prevWeek.length ? t1 - share(prevWeek) : null} unit=" pts" suffix={prevWeek.length ? "vs last week" : "first week of data"} />
          ) : (
            <Trend delta={6} unit=" pts" suffix="this week" />
          )
        }
      >
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
          <circle cx="22" cy="22" r="17" fill="none" stroke="var(--border)" strokeWidth="5" />
          <circle cx="22" cy="22" r="17" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${dash} 106.8`} transform="rotate(-90 22 22)" />
        </svg>
      </Card>
      <Card
        label={live ? "Median budget · high fit" : "Median budget · high fit"}
        value={`€${Math.round((live ? valueWeek : median(leads)) / 1000)}k`}
        trend={
          live ? (
            <Trend delta={valuePrev ? Math.round((valueWeek - valuePrev) / 1000) : null} unit="k" suffix={valuePrev ? "vs last week" : `${withBudget} posts state a budget`} />
          ) : (
            <Trend delta={2} unit="k" suffix="vs last week" />
          )
        }
      >
        <svg width="92" height="36" viewBox="0 0 92 36" aria-hidden>
          <g fill="var(--accent)">
            {(live ? perDay((l) => l.score >= 70).slice(1) : [14, 18, 16, 23, 21, 27, 32]).map((v, i, arr) => {
              const max = Math.max(...arr, 1);
              const h = Math.max(2, (v / max) * 32);
              return <rect key={i} x={2 + i * 13} y={36 - h} width="9" height={h} rx="2" opacity={0.35 + i * 0.11} />;
            })}
          </g>
        </svg>
      </Card>
    </section>
  );
}

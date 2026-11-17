import { useEffect, useMemo, useRef, useState } from "react";
import { prefetch, useCached } from "../lib/cache";
import type { LeadStatus, LeadType, ServiceCategory } from "@radar/shared";
import { CATEGORY_LABEL, STATUS_META, TYPE_META } from "./ui";

interface Analytics {
  days: number;
  daily: Array<{ day: string; leads: number; good: number }>;
  bySource: Array<{ name: string; leads: number; good: number; avg: number }>;
  byTier: Array<{ key: string; leads: number }>;
  byCategory: Array<{ key: string; leads: number }>;
  byType?: Array<{ key: string; leads: number; good: number }>;
  funnel: Array<{ key: string; leads: number }>;
  scoring: Array<{ key: string; leads: number }>;
  aiDaily: Array<{ day: string; requests: number; spend: number }>;
}

const TIER_LABEL: Record<string, string> = { T1: "Tier 1", T2: "Tier 2", T3: "Other", UNKNOWN: "Worldwide / unknown", DOMESTIC: "Serbia & region" };

function Panel({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 ${className}`}>
      <div className="mb-3">
        <div className="text-[13.5px] font-medium">{title}</div>
        {sub && <div className="text-[12px] text-faint">{sub}</div>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-4">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="num mt-1.5 text-[28px] font-semibold leading-tight tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
}

/**
 * Stubičasti grafikon po danima (ljubičasto): ceo stub = novi leadovi, tamniji deo pri dnu = score ≥ 70.
 * Prazni dani pre prvih podataka se ne prikazuju; danas je uvek desno.
 * Vrednost piše gore i menja se dok se prelazi mišem / prstom (zadrži ~0,4 s) / strelicama.
 */
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function LeadsChart({ data, days }: { data: Analytics["daily"] | null; days: number }) {
  const series = useMemo(() => {
    const map = new Map((data ?? []).map((d) => [d.day, d]));
    const all = Array.from({ length: days }, (_, i) => {
      const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
      return { day, leads: map.get(day)?.leads ?? 0, good: map.get(day)?.good ?? 0 };
    });
    const first = all.findIndex((d) => d.leads > 0);
    return first < 0 ? all : all.slice(Math.min(first, all.length - 2)); // bar juče + danas
  }, [data, days]);

  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [idx, setIdx] = useState<number | null>(null);
  const H = w < 520 ? 210 : 270;
  const pad = { top: 10, right: 4, bottom: 24, left: 34 };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!data]); // grafikon se pojavi tek kad stignu podaci

  const rawMax = Math.max(...series.map((s) => s.leads), 1);
  const step = 10 ** Math.floor(Math.log10(rawMax));
  const max = Math.ceil(rawMax / step / 2) * step * 2 || 1;
  const innerW = w - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const n = series.length;
  // Širina mesta po danu: najviše 56 px, pa je malo dana i dalje uredno (stubovi uz desnu ivicu, danas desno)
  const slot = Math.min(innerW / n, 56);
  const startX = pad.left + innerW - slot * n;
  const barW = Math.max(3, Math.min(slot - (slot > 12 ? 6 : 2), 40));
  const cx = (i: number) => startX + slot * i + slot / 2;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const indexAt = (clientX: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    const i = Math.floor((clientX - r.left - startX) / slot);
    return Math.min(n - 1, Math.max(0, i));
  };

  // Dodir: dugo držanje uključuje očitavanje, pa prevlačenje ne pomera stranicu
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hide: ReturnType<typeof setTimeout> | undefined;
    let active = false;
    let start = { x: 0, y: 0 };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]!;
      start = { x: t.clientX, y: t.clientY };
      clearTimeout(hide);
      timer = setTimeout(() => {
        active = true;
        setIdx(indexAt(start.x));
        navigator.vibrate?.(8);
      }, 380);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]!;
      if (active) {
        e.preventDefault();
        setIdx(indexAt(t.clientX));
      } else if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) clearTimeout(timer); // korisnik skroluje
    };
    const onEnd = () => {
      clearTimeout(timer);
      if (active) hide = setTimeout(() => setIdx(null), 1800); // vrednost ostane još malo da se pročita
      active = false;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      clearTimeout(timer);
      clearTimeout(hide);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, innerW, !!data]);

  const cur = series[idx ?? n - 1];
  const ticks = [0, max / 2, max];
  // Datumi ispod: prvi, sredina i danas (bez ponavljanja kad je dana malo)
  const labels = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  // Zaobljen vrh stuba (4 px), ravno dno na osi
  const bar = (x0: number, top: number, bottom: number, wd: number) => {
    const h = bottom - top;
    if (h <= 0) return "";
    const r = Math.min(4, wd / 2, h);
    return `M${x0},${bottom}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + wd - r}Q${x0 + wd},${top} ${x0 + wd},${top + r}V${bottom}Z`;
  };

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-4 xl:col-span-2">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium">Leads per day</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="num text-[26px] font-semibold leading-none tracking-tight">{data && cur ? cur.leads.toLocaleString() : "—"}</span>
            <span className="text-[12.5px] text-muted">
              new leads · <span className="num font-medium text-accent">{(cur?.good ?? 0).toLocaleString()}</span> score ≥ 70
            </span>
          </div>
          <div className="mt-1 text-[12px] text-faint">{cur ? (idx === null ? `Today · ${fmtDay(cur.day)}` : fmtDay(cur.day)) : " "}</div>
        </div>
        <div className="flex items-center gap-3 pt-0.5 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-accent/40" /> all leads</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-accent" /> score ≥ 70</span>
        </div>
      </div>

      {!data ? (
        <div className="h-[210px] animate-pulse rounded-lg bg-surface-2 sm:h-[270px]" />
      ) : (
        <div
          ref={boxRef}
          tabIndex={0}
          role="img"
          aria-label={`Leads per day. Use left and right arrow keys to read each day.`}
          className="relative w-full min-w-0 select-none rounded-md outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-accent/40"
          style={{ height: H }}
          onPointerMove={(e) => e.pointerType === "mouse" && setIdx(indexAt(e.clientX))}
          onPointerLeave={(e) => e.pointerType === "mouse" && setIdx(null)}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setIdx((i) => Math.min(n - 1, Math.max(0, (i ?? n) + (e.key === "ArrowLeft" ? -1 : 1))));
            } else if (e.key === "Escape") setIdx(null);
          }}
          onBlur={() => setIdx(null)}
        >
          <svg width={w} height={H} className="absolute inset-0 block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray={t ? "2 5" : undefined} />
                <text x={pad.left - 8} y={y(t) + 3.5} textAnchor="end" className="num fill-faint text-[10.5px]">
                  {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : Math.round(t)}
                </text>
              </g>
            ))}
            {series.map((s, i) => {
              const x0 = cx(i) - barW / 2;
              const dim = idx !== null && idx !== i;
              return (
                <g key={s.day} opacity={dim ? 0.45 : 1} style={{ transition: "opacity 120ms" }}>
                  {/* ceo stub (svi leadovi) svetlije, a deo sa score ≥ 70 puna boja; 2 px razmaka između */}
                  <path d={bar(x0, y(s.leads), Math.min(y(0), y(s.good) - (s.good ? 2 : 0)), barW)} fill="var(--color-accent)" fillOpacity="0.4" />
                  <path d={bar(x0, y(s.good), y(0), barW)} fill="var(--color-accent)" />
                </g>
              );
            })}
            {labels.map((i) => (
              <text key={i} x={cx(i)} y={H - 6} textAnchor={n > 6 ? (i === 0 ? "start" : i === n - 1 ? "end" : "middle") : "middle"} className="fill-faint text-[10.5px]">
                {i === n - 1 ? "Today" : shortDay(series[i]!.day)}
              </text>
            ))}
          </svg>
        </div>
      )}
      <div className="mt-2 text-right text-[11px] text-faint">
        <span className="hidden sm:inline">Hover a bar to see that day</span>
        <span className="sm:hidden">Press and hold to see each day</span>
      </div>
    </section>
  );
}

function HBars({ rows, color = "bg-accent" }: { rows: Array<{ label: string; value: number; extra?: string }>; color?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <div className="py-6 text-center text-[12.5px] text-faint">No data yet</div>;
  const hasExtra = rows.some((r) => r.extra);
  // Kolone poravnate kao tabela: naziv · traka · broj · dodatak (npr. „25% good“)
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className={`grid items-center gap-x-3 text-[12.5px] ${hasExtra ? "grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3rem_4.5rem]" : "grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3rem]"}`}>
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          <span className="num text-right text-fg">{r.value.toLocaleString()}</span>
          {hasExtra && <span className="num text-right text-faint">{r.extra ?? ""}</span>}
        </li>
      ))}
    </ul>
  );
}

export function OverviewPage() {
  const [days, setDays] = useState(30);
  const res = useCached<Analytics>(`/analytics?days=${days}`, { staleMs: 60_000, refreshMs: 120_000 });
  const data = res.data ?? null;
  const error = res.error ? "Can't load analytics — the backend may be offline." : null;
  // Ostali periodi se učitaju unapred, pa je promena perioda odmah
  useEffect(() => {
    const t = setTimeout(() => [7, 30, 90].forEach((d) => d !== days && prefetch(`/analytics?days=${d}`, 60_000)), 800);
    return () => clearTimeout(t);
  }, [days]);

  const total = data?.daily.reduce((a, d) => a + d.leads, 0) ?? 0;
  const good = data?.daily.reduce((a, d) => a + d.good, 0) ?? 0;
  const funnel = new Map(data?.funnel.map((f) => [f.key, f.leads]) ?? []);
  const contacted = ["contacted", "replied", "meeting", "won", "lost"].reduce((a, s) => a + (funnel.get(s) ?? 0), 0);
  const replied = ["replied", "meeting", "won"].reduce((a, s) => a + (funnel.get(s) ?? 0), 0);
  const won = funnel.get("won") ?? 0;
  const scoring = new Map(data?.scoring.map((s) => [s.key, s.leads]) ?? []);
  const aiShare = (scoring.get("ai") ?? 0) + (scoring.get("rules") ?? 0) ? Math.round(((scoring.get("ai") ?? 0) / ((scoring.get("ai") ?? 0) + (scoring.get("rules") ?? 0))) * 100) : 0;
  const aiRequests = data?.aiDaily.reduce((a, d) => a + d.requests, 0) ?? 0;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">How your lead flow and outreach are performing.</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12.5px] sm:ml-auto">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`h-[28px] rounded-md px-3 ${days === d ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      <section className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label={`Leads · ${days} days`} value={data ? total.toLocaleString() : "—"} hint={data ? `${(total / days).toFixed(1)} per day` : undefined} />
        <Kpi label="High fit (≥ 70)" value={data ? good.toLocaleString() : "—"} hint={data ? `${pct(good, total)} of all leads` : undefined} />
        <Kpi label="Reply rate" value={data ? pct(replied, contacted) : "—"} hint={data ? `${replied} replies from ${contacted} contacted` : undefined} />
        <Kpi label="Scored by AI" value={data ? `${aiShare}%` : "—"} hint={data ? `${aiRequests.toLocaleString()} AI requests · free tiers` : undefined} />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <LeadsChart data={data?.daily ?? null} days={days} />

        <Panel title="Outreach funnel" sub="All time">
          {data ? (
            <ul className="space-y-2.5">
              {[
                ["Leads (not hidden)", ["new", "contacted", "replied", "meeting", "won", "lost"].reduce((a, s) => a + (funnel.get(s) ?? 0), 0)],
                ["Contacted", contacted],
                ["Replied", replied],
                ["Meeting", (funnel.get("meeting") ?? 0) + won],
                ["Won", won],
              ].map(([label, value], i, arr) => {
                const top = (arr[0]![1] as number) || 1;
                return (
                  <li key={label as string}>
                    <div className="mb-1 flex justify-between text-[12.5px]">
                      <span>{label}</span>
                      <span className="num text-muted">{(value as number).toLocaleString()}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(i ? 2 : 0, ((value as number) / top) * 100)}%`, opacity: 1 - i * 0.12 }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
          )}
        </Panel>

        <Panel title="Sources" sub="Leads · share scoring 70+" className="xl:col-span-2">
          <HBars rows={(data?.bySource ?? []).map((s) => ({ label: s.name, value: s.leads, extra: `${pct(s.good, s.leads)} good` }))} />
        </Panel>

        <Panel title="Lead types" sub="Leads · share scoring 70+">
          <HBars rows={(data?.byType ?? []).map((t) => ({ label: TYPE_META[t.key as LeadType]?.label ?? t.key, value: t.leads, extra: `${pct(t.good, t.leads)} good` }))} color="bg-accent" />
        </Panel>

        <div className="grid gap-4 md:grid-cols-2 xl:col-span-3">
        <Panel title="Markets" sub="Where leads come from">
          <HBars rows={(data?.byTier ?? []).map((t) => ({ label: TIER_LABEL[t.key] ?? t.key, value: t.leads }))} color="bg-success" />
        </Panel>

        <Panel title="Services" sub="What clients need">
          <HBars rows={(data?.byCategory ?? []).map((c) => ({ label: CATEGORY_LABEL[c.key as ServiceCategory] ?? c.key, value: c.leads }))} color="bg-warning" />
        </Panel>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[12px] text-faint">
        {(data?.funnel ?? []).map((f) => (
          <span key={f.key}>
            {STATUS_META[f.key as LeadStatus]?.label ?? f.key}: <span className="num text-muted">{f.leads}</span>
          </span>
        ))}
      </div>
    </>
  );
}

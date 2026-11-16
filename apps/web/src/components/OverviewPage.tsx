import { useEffect, useMemo, useState } from "react";
import type { LeadStatus, ServiceCategory } from "@radar/shared";
import { API_URL } from "../lib/api";
import { CATEGORY_LABEL, STATUS_META } from "./ui";

interface Analytics {
  days: number;
  daily: Array<{ day: string; leads: number; good: number }>;
  bySource: Array<{ name: string; leads: number; good: number; avg: number }>;
  byTier: Array<{ key: string; leads: number }>;
  byCategory: Array<{ key: string; leads: number }>;
  funnel: Array<{ key: string; leads: number }>;
  scoring: Array<{ key: string; leads: number }>;
  aiDaily: Array<{ day: string; requests: number; spend: number }>;
}

const TIER_LABEL: Record<string, string> = { T1: "Tier 1", T2: "Tier 2", T3: "Other", UNKNOWN: "Worldwide / unknown", DOMESTIC: "Serbia & region" };

function Panel({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
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

/** Stubičasti grafikon po danima: svi leadovi (svetlo) i dobri ≥70 (akcenat). */
function DailyBars({ data, days }: { data: Analytics["daily"]; days: number }) {
  const series = useMemo(() => {
    const map = new Map(data.map((d) => [d.day, d]));
    return Array.from({ length: days }, (_, i) => {
      const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
      return { day, leads: map.get(day)?.leads ?? 0, good: map.get(day)?.good ?? 0 };
    });
  }, [data, days]);
  const max = Math.max(...series.map((s) => s.leads), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px]">
        {series.map((s) => (
          <div key={s.day} className="relative h-full flex-1" title={`${s.day}: ${s.leads} leads · ${s.good} high fit`}>
            <div className="absolute bottom-0 w-full rounded-sm bg-line-2" style={{ height: `${(s.leads / max) * 100}%` }} />
            <div className="absolute bottom-0 w-full rounded-sm bg-accent" style={{ height: `${(s.good / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{series[0]?.day.slice(5)}</span>
        <span className="flex gap-3">
          <span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-line-2" /> all leads</span>
          <span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm bg-accent" /> score ≥ 70</span>
        </span>
        <span>today</span>
      </div>
    </div>
  );
}

function HBars({ rows, color = "bg-accent" }: { rows: Array<{ label: string; value: number; extra?: string }>; color?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <div className="py-6 text-center text-[12.5px] text-faint">No data yet</div>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-[12.5px]">
          <div className="mb-1 flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="num shrink-0 text-muted">
              {r.value.toLocaleString()} {r.extra && <span className="text-faint">· {r.extra}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OverviewPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    const load = () =>
      fetch(`${API_URL}/analytics?days=${days}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: Analytics) => alive && (setData(d), setError(null)))
        .catch(() => alive && setError("Can't load analytics — the backend may be offline."));
    void load();
    const id = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
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
        <Panel title="Leads per day" sub="New leads and how many scored 70+" className="xl:col-span-2">
          {data ? <DailyBars data={data.daily} days={days} /> : <div className="h-40 animate-pulse rounded-lg bg-surface-2" />}
        </Panel>

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

        <Panel title="Sources" sub="Leads · share scoring 70+">
          <HBars rows={(data?.bySource ?? []).map((s) => ({ label: s.name, value: s.leads, extra: `${pct(s.good, s.leads)} good` }))} />
        </Panel>

        <Panel title="Markets" sub="Where leads come from">
          <HBars rows={(data?.byTier ?? []).map((t) => ({ label: TIER_LABEL[t.key] ?? t.key, value: t.leads }))} color="bg-success" />
        </Panel>

        <Panel title="Services" sub="What clients need">
          <HBars rows={(data?.byCategory ?? []).map((c) => ({ label: CATEGORY_LABEL[c.key as ServiceCategory] ?? c.key, value: c.leads }))} color="bg-warning" />
        </Panel>
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

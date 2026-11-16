import { useCallback, useEffect, useState } from "react";
import { Bot, Download, Loader2, Settings2 } from "lucide-react";
import type { ProjectStatus } from "@radar/shared";
import { teamFetch } from "../../lib/team";
import { useSessionUser } from "../../lib/session";
import { fmtEur } from "../../lib/delivery";
import { Dialog, ErrorNote, btnPrimary, btnSecondary, field, PROJECT_STATUS_META } from "./parts";

/** Faza 12: izveštaji — profitabilnost po projektu, vreme, AI trošak i ušteda. */
interface Row {
  id: string;
  key: string;
  name: string;
  customerName: string | null;
  status: ProjectStatus;
  billing: "fixed" | "hourly";
  hourlyRateEur: number | null;
  budgetEur: number | null;
  revenue: number;
  hours: number;
  billableHours: number;
  laborCost: number;
  aiCost: number;
  aiSavings: number;
  aiRequests: number;
  aiClients: string[];
  cost: number;
  margin: number;
  marginPct: number | null;
  budgetUsedPct: number | null;
  effectiveRate: number | null;
  issues: { done: number; total: number; points: number; agentDone: number };
}
interface Report {
  days: number;
  rates: { defaultHourlyCost: number; members: Record<string, number> };
  totals: { revenue: number; cost: number; margin: number; hoursPeriod: number; billablePct: number | null };
  projects: Row[];
  people: Array<{ name: string; hours: number; billableHours: number; cost: number }>;
  weeks: Array<{ week: string; hours: number; billable: number }>;
  ai: { spendEur: number; baselineEur: number; savingsEur: number; requests: number; agentTasks: number; agentPoints: number };
  members: Array<{ id: string; name: string }>;
}

const PERIODS = [
  [30, "30 days"],
  [90, "90 days"],
  [365, "12 months"],
  [0, "All time"],
] as const;
const eur2 = (v: number) => (Math.abs(v) >= 1000 ? fmtEur(Math.round(v)) : `€${Math.round(v)}`);
const marginCls = (pct: number | null) => (pct === null ? "text-muted" : pct < 0 ? "text-danger" : pct < 20 ? "text-warning" : "text-success");

function Kpi({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-4">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className={`num mt-1.5 text-[24px] font-semibold leading-tight tracking-tight ${cls}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-faint">{sub}</div>}
    </div>
  );
}

function WeekChart({ weeks }: { weeks: Report["weeks"] }) {
  const max = Math.max(1, ...weeks.map((w) => w.hours));
  return (
    <div>
      <div className="flex h-[150px] items-end gap-[3px]" role="img" aria-label="Hours logged per week">
        {weeks.map((w) => (
          <div key={w.week} className="group relative flex h-full flex-1 flex-col justify-end" title={`Week of ${w.week}: ${w.hours} h (${w.billable} h billable)`}>
            <div className="w-full rounded-t-[3px] bg-accent/35" style={{ height: `${((w.hours - w.billable) / max) * 100}%` }} />
            <div className={`w-full bg-accent ${w.hours - w.billable > 0 ? "" : "rounded-t-[3px]"}`} style={{ height: `${(w.billable / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span>{weeks[0]?.week.slice(5)}</span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-accent" /> billable
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-accent/35" /> non-billable
          </span>
        </span>
        <span>this week</span>
      </div>
    </div>
  );
}

function RatesDialog({ open, onClose, report, onSaved }: { open: boolean; onClose: () => void; report: Report; onSaved: () => void }) {
  const [def, setDef] = useState("");
  const [members, setMembers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setDef(String(report.rates.defaultHourlyCost));
    setMembers(Object.fromEntries(report.members.map((m) => [m.id, report.rates.members[m.id] !== undefined ? String(report.rates.members[m.id]) : ""])));
    setError(null);
  }, [open, report]);
  return (
    <Dialog open={open} onClose={onClose} title="Internal cost per hour" width={480}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const m: Record<string, number> = {};
            for (const [k, v] of Object.entries(members)) if (v.trim()) m[k] = Number(v);
            await teamFetch("/delivery/rates", { method: "PUT", body: JSON.stringify({ defaultHourlyCost: Number(def), members: m }) });
            onSaved();
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-3 px-4 py-4">
          <p className="text-[12.5px] text-muted">What an hour of work costs the company (salary, taxes, overhead). Used to calculate project cost and margin. Leave a person empty to use the default.</p>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Default (€ / hour)</span>
            <input className={`${field} num h-[34px] w-32`} inputMode="decimal" value={def} onChange={(e) => setDef(e.target.value)} />
          </label>
          <div className="divide-y divide-line rounded-xl border border-line">
            {report.members.map((m) => (
              <label key={m.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="flex-1">{m.name}</span>
                <input className={`${field} num h-[30px] w-24`} inputMode="decimal" placeholder={def} value={members[m.id] ?? ""} onChange={(e) => setMembers({ ...members, [m.id]: e.target.value })} aria-label={`${m.name} cost per hour`} />
              </label>
            ))}
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={busy || !def.trim()} className={btnPrimary}>
            {busy && <Loader2 size={14} className="animate-spin" />} Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function exportCsv(r: Report) {
  const head = ["Key", "Project", "Client", "Status", "Billing", "Revenue EUR", "Hours", "Billable hours", "Labor EUR", "AI EUR", "Cost EUR", "Margin EUR", "Margin %", "Budget used %", "EUR per hour", "Issues done", "Done by AI agents", "AI savings EUR"];
  const rows = r.projects.map((p) => [p.key, p.name, p.customerName ?? "", p.status, p.billing, p.revenue, p.hours, p.billableHours, p.laborCost, p.aiCost, p.cost, p.margin, p.marginPct ?? "", p.budgetUsedPct ?? "", p.effectiveRate ?? "", p.issues.done, p.issues.agentDone, p.aiSavings]);
  const csv = [head, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `scoutline-projects-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportsPage() {
  const user = useSessionUser();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const load = useCallback(() => {
    teamFetch<Report>(`/delivery/reports?days=${days}`)
      .then((d) => (setData(d), setError(null)))
      .catch((e) => setError((e as Error).message));
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);
  const t = data?.totals;
  const projects = (data?.projects ?? []).filter((p) => p.status !== "canceled");
  const maxPerson = Math.max(1, ...(data?.people ?? []).map((p) => p.hours));
  const marginPct = t && t.revenue > 0 ? Math.round((t.margin / t.revenue) * 100) : null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">Profit per project, where the time goes, and what AI saves you.</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12.5px]">
            {PERIODS.map(([d, l]) => (
              <button key={d} onClick={() => setDays(d)} className={`h-[30px] rounded-md px-2.5 ${days === d ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
                {l}
              </button>
            ))}
          </div>
          {user?.role === "owner" || !user ? (
            <button onClick={() => setRatesOpen(true)} disabled={!data} className={btnSecondary} title="Internal cost per hour">
              <Settings2 size={14} /> €{data?.rates.defaultHourlyCost ?? "—"}/h
            </button>
          ) : null}
          <button onClick={() => data && exportCsv(data)} disabled={!data} className={btnSecondary}>
            <Download size={14} /> CSV
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label="Contract value" value={t ? eur2(t.revenue) : "—"} sub="fixed budgets + billable hours" />
        <Kpi label="Cost to date" value={t ? eur2(t.cost) : "—"} sub="time × cost/h + AI" />
        <Kpi label="Margin" value={t ? eur2(t.margin) : "—"} sub={marginPct !== null ? `${marginPct}% · value minus cost so far` : undefined} cls={marginCls(marginPct)} />
        <Kpi label="Hours logged" value={t ? `${t.hoursPeriod} h` : "—"} sub={t?.billablePct != null ? `${t.billablePct}% billable · period` : "period"} />
        <Kpi label="AI savings" value={data ? eur2(data.ai.savingsEur) : "—"} sub={data ? `vs one premium model · ${data.ai.requests.toLocaleString()} requests` : undefined} cls="text-success" />
      </section>

      {/* Profitabilnost po projektu */}
      <div className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">Profit by project (to date)</div>
      <div className="mb-6 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-faint">
                <th className="px-3 py-2.5 font-medium">Project</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th>
                <th className="px-3 py-2.5 text-right font-medium">Hours</th>
                <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">Labor</th>
                <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">AI</th>
                <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Budget used</th>
                <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell" title="Value divided by hours worked">€ / h</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="max-w-[300px] px-3 py-2.5">
                    <a href={`#/delivery/projects/${p.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <span className="num rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted ring-1 ring-line">{p.key}</span>
                      <span className="truncate">{p.name}</span>
                    </a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-0.5 text-xs text-muted">
                      <span className={`rounded-full px-1.5 py-px text-[10.5px] ring-1 ring-inset ${PROJECT_STATUS_META[p.status].cls}`}>{PROJECT_STATUS_META[p.status].label}</span>
                      {p.customerName ?? "No client"} · {p.billing === "hourly" ? `hourly €${p.hourlyRateEur ?? 0}` : "fixed"}
                      {p.issues.agentDone > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-accent" title="Issues completed by AI agents">
                          <Bot size={11} /> {p.issues.agentDone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="num px-3 py-2.5 text-right">{p.revenue ? eur2(p.revenue) : "—"}</td>
                  <td className="num px-3 py-2.5 text-right">{p.hours}</td>
                  <td className="num hidden px-3 py-2.5 text-right text-muted md:table-cell">{eur2(p.laborCost)}</td>
                  <td className="num hidden px-3 py-2.5 text-right text-muted md:table-cell" title={p.aiClients.length ? `AI Router: ${p.aiClients.join(", ")} · saved ${eur2(p.aiSavings)}` : "No AI Router key linked"}>
                    {p.aiClients.length ? eur2(p.aiCost) : "—"}
                  </td>
                  <td className={`num px-3 py-2.5 text-right font-medium ${marginCls(p.marginPct)}`} title={p.cost === 0 ? "No time or AI cost logged yet" : undefined}>
                    {p.revenue && p.cost > 0 ? eur2(p.margin) : <span className="font-normal text-faint">not started</span>}
                    {p.marginPct !== null && <div className="text-[11px] font-normal">{p.marginPct}%</div>}
                  </td>
                  <td className="hidden px-3 py-2.5 lg:table-cell">
                    {p.budgetUsedPct !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                          <div className={`h-full rounded-full ${p.budgetUsedPct > 100 ? "bg-danger" : p.budgetUsedPct > 80 ? "bg-warning" : "bg-accent"}`} style={{ width: `${Math.min(100, p.budgetUsedPct)}%` }} />
                        </div>
                        <span className="num text-[12px] text-muted">{p.budgetUsedPct}%</span>
                      </div>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="num hidden px-3 py-2.5 text-right text-muted sm:table-cell">{p.effectiveRate !== null ? `€${Math.round(p.effectiveRate)}` : "—"}</td>
                </tr>
              ))}
              {data && projects.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-[13px] text-faint">
                    No projects yet. Create one in Projects, then log time on issues.
                  </td>
                </tr>
              )}
              {!data &&
                [0, 1, 2].map((i) => (
                  <tr key={i} className="border-b border-line">
                    <td colSpan={8} className="px-3 py-3">
                      <div className="h-4 animate-pulse rounded bg-surface-2" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[13.5px] font-semibold">Hours per week</h2>
            <span className="text-[12px] text-faint">all projects</span>
          </div>
          {data ? <WeekChart weeks={data.weeks} /> : <div className="h-[150px] animate-pulse rounded bg-surface-2" />}
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[13.5px] font-semibold">Time by person</h2>
            <span className="text-[12px] text-faint">this period</span>
          </div>
          <ul className="space-y-2.5">
            {(data?.people ?? []).map((p) => (
              <li key={p.name}>
                <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                  <span>{p.name}</span>
                  <span className="num text-muted">
                    {p.hours} h · {eur2(p.cost)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(p.hours / maxPerson) * 100}%` }} />
                </div>
              </li>
            ))}
            {data && data.people.length === 0 && <li className="text-[12.5px] text-faint">No time logged in this period. Open an issue and use “Log”.</li>}
          </ul>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <Bot size={15} className="text-accent" />
          <h2 className="text-[13.5px] font-semibold">AI this period</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Spent on AI", data ? eur2(data.ai.spendEur) : "—", "free tiers are billed €0"],
            ["Would cost on a premium model", data ? eur2(data.ai.baselineEur) : "—", "same tokens, one top model"],
            ["Saved by routing", data ? eur2(data.ai.savingsEur) : "—", "AI Router (fast / smart)"],
            ["Issues done by AI agents", data ? String(data.ai.agentTasks) : "—", data ? `${data.ai.agentPoints} points · Claude / Codex` : ""],
          ].map(([l, v, s]) => (
            <div key={l} className="rounded-lg border border-line bg-bg px-3 py-3">
              <div className="text-[12px] text-muted">{l}</div>
              <div className="num mt-1 text-[20px] font-semibold">{v}</div>
              <div className="text-[11.5px] text-faint">{s}</div>
            </div>
          ))}
        </div>
      </section>
      {data && <RatesDialog open={ratesOpen} onClose={() => setRatesOpen(false)} report={data} onSaved={load} />}
    </>
  );
}

import { useEffect, useState } from "react";
import { teamFetch, usd } from "../../lib/team";
import { Card, Segmented, Select, select } from "../../lib/ui";
import { ErrorNote, GroupTag, ms, pctText } from "./shared";

/** AI Router → Analytics: trošak po klijentu/projektu/inženjeru/modelu/vrsti zahteva, ušteda, keš, brzina, greške. */

interface Row {
  key: string;
  label: string;
  requests: number;
  tokens: number;
  spendUsd: number;
  baselineUsd: number;
  savingsUsd: number;
  cacheHits: number;
  cacheHitRate: number | null;
  errors: number;
}
interface Analytics {
  days: number;
  totals: Omit<Row, "key" | "label">;
  byClient: Row[];
  byProject: Row[];
  byMember: Row[];
  byModel: Row[];
  byClass: Row[];
  perf: Array<{ group: string; requests: number; errors: number; fallbacks: number; p50TtfbMs: number | null; p95TtfbMs: number | null; p50TotalMs: number | null; p95TotalMs: number | null }>;
  models: Array<{ model: string; requests: number; p50: number | null; p95: number | null; failures: number }>;
  shadow: Array<{ chosen: string; applied: string; requests: number }>;
  blocked: Array<{ reason: string; requests: number }>;
  repeats: { prompts: number; extraRequests: number };
  pricesAsOf: string;
}
const DIMS = [
  ["byClient", "Client"],
  ["byProject", "Project"],
  ["byMember", "Engineer"],
  ["byModel", "Model"],
  ["byClass", "Request type"],
] as const;
type Dim = (typeof DIMS)[number][0];

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="num mt-1 text-[20px] font-semibold leading-tight tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
    </div>
  );
}

export function AnalyticsPanel({ clients }: { clients: Array<{ id: string; name: string }> }) {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [clientId, setClientId] = useState("");
  const [dim, setDim] = useState<Dim>("byClient");
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    teamFetch<Analytics>(`/router/analytics?days=${days}${clientId ? `&clientId=${clientId}` : ""}`).then(
      (d) => (setData(d), setError(null)),
      (e) => setError((e as Error).message),
    );
  }, [days, clientId]);
  const t = data?.totals;
  const shadowTotal = data?.shadow.reduce((a, s) => a + s.requests, 0) ?? 0;
  const shadowChanged = data?.shadow.filter((s) => s.chosen !== s.applied).reduce((a, s) => a + s.requests, 0) ?? 0;
  const rows = data ? (data[dim] as Row[]) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={days} onChange={setDays} options={[["7", "7 days"], ["30", "30 days"], ["90", "90 days"]] as const} />
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className={select} aria-label="Client">
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <ErrorNote text={error} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Requests" value={t ? t.requests.toLocaleString() : "—"} hint={t ? `${t.tokens.toLocaleString()} tokens` : undefined} />
        <Kpi label="Spent" value={t ? usd(t.spendUsd) : "—"} />
        <Kpi label="Saved" value={t ? usd(t.savingsUsd) : "—"} hint={t && t.baselineUsd > 0 ? `${pctText(t.savingsUsd, t.baselineUsd)} vs without routing` : undefined} />
        <Kpi label="Cache hit rate" value={t?.cacheHitRate !== null && t?.cacheHitRate !== undefined ? `${Math.round(t.cacheHitRate * 100)}%` : "—"} hint={t ? `${t.cacheHits} answered from cache` : undefined} />
        <Kpi label="Errors" value={t ? pctText(t.errors, t.requests) : "—"} hint={t ? `${t.errors} of ${t.requests}` : undefined} />
      </section>

      <Card title="Speed and reliability" sub="First byte = how fast an answer starts; total = until the last token. Fallback = the group failed and LiteLLM used the next one.">
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-line text-left text-[12px] text-faint">
                <th className="px-4 py-2 font-medium sm:pl-5">Group</th>
                <th className="px-2 py-2 text-right font-medium">Requests</th>
                <th className="px-2 py-2 text-right font-medium">First byte p50 / p95</th>
                <th className="px-2 py-2 text-right font-medium">Total p50 / p95</th>
                <th className="px-2 py-2 text-right font-medium">Errors</th>
                <th className="px-4 py-2 text-right font-medium sm:pr-5">Fallbacks</th>
              </tr>
            </thead>
            <tbody className="num">
              {(data?.perf ?? []).map((p) => (
                <tr key={p.group} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 sm:pl-5">
                    <GroupTag g={p.group} />
                  </td>
                  <td className="px-2 py-2 text-right">{p.requests.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right">
                    {ms(p.p50TtfbMs)} <span className="text-faint">/ {ms(p.p95TtfbMs)}</span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    {ms(p.p50TotalMs)} <span className="text-faint">/ {ms(p.p95TotalMs)}</span>
                  </td>
                  <td className={`px-2 py-2 text-right ${p.errors ? "text-danger" : "text-muted"}`}>{pctText(p.errors, p.requests)}</td>
                  <td className="px-4 py-2 text-right text-muted sm:pr-5">{pctText(p.fallbacks, p.requests)}</td>
                </tr>
              ))}
              {data && !data.perf.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted sm:px-5">
                    No requests in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && data.models.length > 0 && (
          <details className="mt-3 text-[12px]">
            <summary className="cursor-pointer text-muted">By actual model (LiteLLM)</summary>
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-bg">
              {data.models.map((m) => (
                <li key={m.model} className="num flex flex-wrap items-center gap-x-3 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{m.model}</span>
                  <span className="text-muted">{m.requests} req</span>
                  <span className="text-muted">
                    {ms(m.p50)} / {ms(m.p95)}
                  </span>
                  {m.failures > 0 && <span className="text-danger">{m.failures} failed</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Cost breakdown" actions={<Segmented value={dim} onChange={setDim} options={DIMS} className="max-w-full overflow-x-auto" />}>
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-line text-left text-[12px] text-faint">
                <th className="px-4 py-2 font-medium sm:pl-5">{DIMS.find(([k]) => k === dim)![1]}</th>
                <th className="px-2 py-2 text-right font-medium">Requests</th>
                <th className="px-2 py-2 text-right font-medium">Tokens</th>
                <th className="px-2 py-2 text-right font-medium">Spent</th>
                <th className="px-2 py-2 text-right font-medium">Saved</th>
                <th className="px-4 py-2 text-right font-medium sm:pr-5">Cache hits</th>
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((r) => (
                <tr key={r.key || r.label} className="border-b border-line last:border-0">
                  <td className="max-w-[260px] truncate px-4 py-2 font-sans sm:pl-5">{r.label}</td>
                  <td className="px-2 py-2 text-right">{r.requests.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right text-muted">{r.tokens.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right">{usd(r.spendUsd)}</td>
                  <td className="px-2 py-2 text-right text-success">{usd(r.savingsUsd)}</td>
                  <td className="px-4 py-2 text-right text-muted sm:pr-5">{r.cacheHits}</td>
                </tr>
              ))}
              {data && !rows.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center font-sans text-muted sm:px-5">
                    Nothing here yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-faint">
          “Saved” compares with what the request would cost without routing: the requested model's list price (Anthropic prices as of {data?.pricesAsOf ?? "—"}), or a premium-model price for “auto”. Free tiers bill nothing.
        </p>
      </Card>

      {data && (shadowTotal > 0 || data.blocked.length > 0 || data.repeats.prompts > 0) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {shadowTotal > 0 && (
            <Card title="Shadow mode" sub="Requests were sent as asked; this is what the router would have done.">
              <div className="num text-[20px] font-semibold">
                {shadowChanged.toLocaleString()} <span className="text-[13px] font-normal text-muted">of {shadowTotal.toLocaleString()} would change</span>
              </div>
              <ul className="mt-2 space-y-1 text-[12px]">
                {data.shadow.map((s) => (
                  <li key={s.chosen + s.applied} className="flex items-center gap-1.5">
                    <GroupTag g={s.applied} /> → <GroupTag g={s.chosen} /> <span className="num ml-auto text-muted">{s.requests}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.blocked.length > 0 && (
            <Card title="Blocked requests">
              <ul className="space-y-1.5 text-[12px]">
                {data.blocked.map((b) => (
                  <li key={b.reason} className="flex gap-2">
                    <span className="min-w-0 flex-1 text-muted">{b.reason}</span>
                    <span className="num">{b.requests}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.repeats.prompts > 0 && (
            <Card title="Repeated requests" sub="Identical requests sent more than once — the cache answers these for free.">
              <div className="num text-[20px] font-semibold">
                {data.repeats.extraRequests.toLocaleString()} <span className="text-[13px] font-normal text-muted">repeats of {data.repeats.prompts} prompts</span>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

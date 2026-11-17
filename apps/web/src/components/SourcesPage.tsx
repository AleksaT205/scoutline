import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Mail, Pause, Play, Plus, Rss } from "lucide-react";
import { API_URL } from "../lib/api";
import { authHeaders, teamFetch } from "../lib/team";
import { canEdit, useSessionUser } from "../lib/session";

interface Source {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  intervalMinutes: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  runRequestedAt?: string | null;
  items: number;
  leads: number;
  leads24h: number;
  good: number;
}

/** Linkovi i uslovi korišćenja za izvore (vidi docs/SOURCES.md). */
const META: Record<string, { site: string; note: string }> = {
  remoteok: { site: "https://remoteok.com", note: "Public API · credit + link to post" },
  wwr: { site: "https://weworkremotely.com", note: "RSS feeds (5 dev categories)" },
  remotive: { site: "https://remotive.com", note: "Public API · a few calls per day" },
  arbeitnow: { site: "https://www.arbeitnow.com", note: "Public API · Germany / EU" },
  hn: { site: "https://news.ycombinator.com", note: "Official HN API · monthly “Who is hiring”" },
  himalayas: { site: "https://himalayas.app", note: "Public API · credit + application link" },
  jobicy: { site: "https://jobicy.com", note: "Public API · credit + link to post" },
  manual: { site: "", note: "Added from the dashboard (“Add lead”)" },
  ted: { site: "https://ted.europa.eu", note: "EU tenders · official API · IT & software CPV codes" },
  "uk-cf": { site: "https://www.contractsfinder.service.gov.uk", note: "UK tenders · OCDS API · Open Government Licence" },
  "uk-fat": { site: "https://www.find-tender.service.gov.uk", note: "UK tenders (larger) · OCDS API" },
  canadabuys: { site: "https://canadabuys.canada.ca", note: "Canada federal tenders · daily open-data CSV" },
  "tc-funding": { site: "https://techcrunch.com/category/venture/", note: "Funding news (RSS) · intent signal" },
  startit: { site: "https://startit.rs", note: "Serbian startup news (RSS) · intent signal" },
  "ted-region": { site: "https://ted.europa.eu", note: "Tenders in Serbia, BiH, Montenegro, N. Macedonia, Croatia, Albania · official API" },
  worldbank: { site: "https://projects.worldbank.org", note: "World Bank tenders in the region · open API" },
  helloworld: { site: "https://www.helloworld.rs", note: "Serbian IT jobs (RSS) · hiring signal, headline + link only" },
  "startit-jobs": { site: "https://startit.rs/poslovi", note: "Startit jobs (RSS) · hiring signal" },
  netokracija: { site: "https://www.netokracija.rs", note: "Regional startup & tech news (RSS) · intent signal" },
  "forbes-rs": { site: "https://forbes.n1info.rs", note: "Forbes Srbija (RSS) · investments & growth" },
  bizlife: { site: "https://bizlife.rs", note: "Bizlife (RSS) · investments & growth" },
  sam: { site: "https://sam.gov", note: "US federal tenders · official API (free key)" },
  freelancer: { site: "https://www.freelancer.com", note: "Freelancer.com projects · official API" },
  ejn: { site: "https://www.ejn.gov.ba", note: "Bosnia & Herzegovina tenders · open data" },
  email: { site: "", note: "Reads alert emails from the connected inbox" },
  "email-upwork": { site: "https://www.upwork.com", note: "Saved-search alerts → Email-in" },
  "email-pph": { site: "https://www.peopleperhour.com", note: "Project alerts → Email-in" },
  "email-malt": { site: "https://www.malt.com", note: "Mission alerts → Email-in" },
  "email-jnportal": { site: "https://jnportal.ujn.gov.rs", note: "Serbian public procurement notifications → Email-in" },
  "email-linkedin": { site: "https://www.linkedin.com", note: "Job alerts → Email-in (hiring signals)" },
  "email-inbox": { site: "", note: "Forwarded emails and direct client inquiries" },
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function every(min: number) {
  if (!min) return "on demand";
  return min < 60 ? `every ${min} min` : `every ${min / 60} h`;
}

const SCHEDULES = [15, 30, 60, 180, 360, 720, 1440];
/** Izvori kojima se upravlja (ne ručni unos i ne pod-izvori Email-in-a — njih pokreće „Email-in“). */
const controllable = (s: { id: string; kind: string }) => s.kind !== "manual" && !s.id.startsWith("email-");

export function SourcesPage() {
  const user = useSessionUser();
  const [items, setItems] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const act = async (id: string, path: string, init: RequestInit, patch: Partial<Source>) => {
    setBusy(id);
    setItems((cur) => cur?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? cur);
    try {
      await teamFetch(path, init);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setTimeout(() => setTick((t) => t + 1), 1500);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API_URL}/sources`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: { items: Source[] }) => alive && (setItems(d.items), setError(null)))
        .catch(() => alive && setError("Can't load sources — the backend may be offline."));
    void load();
    // Dok čeka „Run now“, osvežava se češće
    const id = setInterval(load, items?.some((s) => s.runRequestedAt) ? 10_000 : 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, items?.some((s) => s.runRequestedAt)]);

  const healthy = items?.filter((s) => !s.lastError && s.kind !== "manual").length ?? 0;
  const automatic = items?.filter((s) => s.kind !== "manual").length ?? 0;
  const total = items?.reduce((a, s) => a + s.leads, 0) ?? 0;
  const today = items?.reduce((a, s) => a + s.leads24h, 0) ?? 0;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">Where leads come from. Every source uses an official API, open data, RSS or your own email alerts — and respects its terms.</p>
        </div>
        <a href="#/" className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 sm:ml-auto">
          <Plus size={14} /> Add a lead manually
        </a>
      </div>

      {error && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      <section className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          ["Healthy sources", items ? `${healthy} / ${automatic}` : "—"],
          ["Leads total", items ? total.toLocaleString() : "—"],
          ["New in last 24 h", items ? today.toLocaleString() : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface px-3 py-3 sm:px-4 sm:py-4">
            <div className="truncate text-[11.5px] text-muted sm:text-[12.5px]">{label}</div>
            <div className="num mt-1 text-[20px] font-semibold leading-tight tracking-tight sm:mt-1.5 sm:text-[28px]">{value}</div>
          </div>
        ))}
      </section>

      {/* Telefon: kartice */}
      <ul className="space-y-2 md:hidden">
        {(items ?? []).map((s) => {
          const meta = META[s.id];
          return (
            <li key={s.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-md bg-surface-2 text-muted ring-1 ring-line">{s.kind === "email" ? <Mail size={13} /> : <Rss size={13} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{s.name}</div>
                  <div className="truncate text-[12px] text-muted">{meta?.note ?? s.kind}</div>
                </div>
                {s.kind !== "manual" && (!s.enabled ? <Pause size={14} className="text-warning" /> : s.lastError ? <AlertTriangle size={14} className="text-danger" /> : <CheckCircle2 size={14} className="text-success" />)}
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-line pt-2 text-center">
                {[
                  ["Leads", s.leads.toLocaleString()],
                  ["24 h", s.leads24h ? `+${s.leads24h}` : "0"],
                  ["70+", String(s.good)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="num text-[15px] font-semibold">{v}</div>
                    <div className="text-[11px] text-faint">{l}</div>
                  </div>
                ))}
              </div>
              {controllable(s) && canEdit(user) && (
                <div className="mt-2.5 flex items-center gap-1.5">
                  <select
                    value={s.intervalMinutes}
                    onChange={(e) => void act(s.id, `/sources/${s.id}`, { method: "PATCH", body: JSON.stringify({ intervalMinutes: Number(e.target.value) }) }, { intervalMinutes: Number(e.target.value) })}
                    className="h-[32px] flex-1 rounded-md border border-line bg-bg px-2 text-[12.5px] outline-none"
                    aria-label={`${s.name} schedule`}
                  >
                    {[...new Set([...SCHEDULES, s.intervalMinutes])].sort((a, b) => a - b).map((m) => (
                      <option key={m} value={m}>
                        {every(m)}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => void act(s.id, `/sources/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) }, { enabled: !s.enabled })} className={`grid size-8 place-items-center rounded-md border border-line ${s.enabled ? "text-muted" : "bg-warning/10 text-warning"}`} aria-label={s.enabled ? "Pause" : "Resume"}>
                    {s.enabled ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <button disabled={!!s.runRequestedAt} onClick={() => void act(s.id, `/sources/${s.id}/run`, { method: "POST", body: "{}" }, { runRequestedAt: new Date().toISOString() })} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-[12.5px] font-medium disabled:opacity-60">
                    {s.runRequestedAt ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {s.runRequestedAt ? "Queued" : "Run now"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-faint">
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Schedule</th>
                <th className="px-3 py-2.5 font-medium">Leads</th>
                <th className="px-3 py-2.5 font-medium">Last 24 h</th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Score ≥ 70</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((s) => {
                const meta = META[s.id];
                const ok = !s.lastError;
                return (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="grid size-6 place-items-center rounded-md bg-surface-2 text-muted ring-1 ring-line">
                          {s.kind === "email" ? <Mail size={12} /> : <Rss size={12} />}
                        </span>
                        {s.name}
                        {meta?.site && (
                          <a href={meta.site} target="_blank" rel="noreferrer" className="text-faint hover:text-fg" aria-label={`Open ${s.name}`}>
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                      <div className="mt-0.5 pl-8 text-xs text-muted">{meta?.note ?? s.kind}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {s.kind === "manual" ? (
                        <span className="text-muted">—</span>
                      ) : !s.enabled ? (
                        <span className="inline-flex items-center gap-1.5 text-warning">
                          <Pause size={12} /> Paused <span className="text-faint">· {ago(s.lastSuccessAt)}</span>
                        </span>
                      ) : ok ? (
                        <span className="inline-flex items-center gap-1.5 text-success">
                          <CheckCircle2 size={13} /> OK <span className="text-faint">· {ago(s.lastSuccessAt)}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-danger" title={s.lastError ?? ""}>
                          <AlertTriangle size={13} /> Error <span className="max-w-[220px] truncate text-faint">· {s.lastError}</span>
                        </span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted md:table-cell">
                      {controllable(s) && canEdit(user) ? (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={s.intervalMinutes}
                            onChange={(e) => void act(s.id, `/sources/${s.id}`, { method: "PATCH", body: JSON.stringify({ intervalMinutes: Number(e.target.value) }) }, { intervalMinutes: Number(e.target.value) })}
                            className="h-[28px] cursor-pointer rounded-md border border-line bg-bg px-1.5 text-[12px] text-fg outline-none focus:border-accent/60"
                            aria-label={`${s.name} schedule`}
                          >
                            {[...new Set([...SCHEDULES, s.intervalMinutes])].sort((a, b) => a - b).map((m) => (
                              <option key={m} value={m}>
                                {every(m)}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => void act(s.id, `/sources/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) }, { enabled: !s.enabled })}
                            className={`grid size-7 place-items-center rounded-md border border-line ${s.enabled ? "text-muted hover:text-fg" : "bg-warning/10 text-warning"}`}
                            title={s.enabled ? "Pause this source" : "Resume this source"}
                            aria-label={s.enabled ? `Pause ${s.name}` : `Resume ${s.name}`}
                          >
                            {s.enabled ? <Pause size={12} /> : <Play size={12} />}
                          </button>
                          <button
                            disabled={busy === s.id || !!s.runRequestedAt}
                            onClick={() => void act(s.id, `/sources/${s.id}/run`, { method: "POST", body: "{}" }, { runRequestedAt: new Date().toISOString() })}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-60"
                            title="Fetch new posts now (within a minute)"
                          >
                            {s.runRequestedAt ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} />} {s.runRequestedAt ? "Queued" : "Run now"}
                          </button>
                        </div>
                      ) : (
                        <span>{s.enabled ? every(s.intervalMinutes) : "paused"}</span>
                      )}
                    </td>
                    <td className="num px-3 py-2.5">{s.leads.toLocaleString()}</td>
                    <td className="num px-3 py-2.5">{s.leads24h ? <span className="text-success">+{s.leads24h}</span> : <span className="text-faint">0</span>}</td>
                    <td className="num hidden px-3 py-2.5 sm:table-cell">{s.good}</td>
                  </tr>
                );
              })}
              {!items &&
                [0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-b border-line">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="h-4 animate-pulse rounded bg-surface-2" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-4 text-[12px] text-faint">
        Domestic job boards (Infostud, HelloWorld…) don’t allow automated reading — add those leads with “Add lead” (link or pasted text).
      </p>
    </>
  );
}

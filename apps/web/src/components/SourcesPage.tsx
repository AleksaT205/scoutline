import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Plus, Rss } from "lucide-react";
import { API_URL } from "../lib/api";
import { authHeaders } from "../lib/team";

interface Source {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  intervalMinutes: number;
  lastSuccessAt: string | null;
  lastError: string | null;
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

export function SourcesPage() {
  const [items, setItems] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API_URL}/sources`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: { items: Source[] }) => alive && (setItems(d.items), setError(null)))
        .catch(() => alive && setError("Can't load sources — the backend may be offline."));
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const healthy = items?.filter((s) => !s.lastError && s.kind !== "manual").length ?? 0;
  const automatic = items?.filter((s) => s.kind !== "manual").length ?? 0;
  const total = items?.reduce((a, s) => a + s.leads, 0) ?? 0;
  const today = items?.reduce((a, s) => a + s.leads24h, 0) ?? 0;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">Where leads come from. Every source uses an official API or RSS feed and respects its terms.</p>
        </div>
        <a href="#/" className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 sm:ml-auto">
          <Plus size={14} /> Add a lead manually
        </a>
      </div>

      {error && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["Healthy sources", items ? `${healthy} / ${automatic}` : "—"],
          ["Leads total", items ? total.toLocaleString() : "—"],
          ["New in last 24 h", items ? today.toLocaleString() : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface px-4 py-4">
            <div className="text-[12.5px] text-muted">{label}</div>
            <div className="num mt-1.5 text-[28px] font-semibold leading-tight tracking-tight">{value}</div>
          </div>
        ))}
      </section>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
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
                          <Rss size={12} />
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
                    <td className="hidden px-3 py-2.5 text-muted md:table-cell">{every(s.intervalMinutes)}</td>
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

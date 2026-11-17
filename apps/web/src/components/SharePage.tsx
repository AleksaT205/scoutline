import { useEffect, useMemo, useState } from "react";
import { Eye, ExternalLink } from "lucide-react";
import type { UiLead } from "../data/demo";
import { API_URL } from "../lib/api";
import { LeadsTable } from "./LeadsTable";
import { CATEGORY_LABEL, ScoreRing, flag, timeAgo } from "./ui";

/** Javni prikaz samo za čitanje (link koji tim podeli). */
export function SharePage({ token }: { token: string }) {
  const [data, setData] = useState<{ label: string; items: UiLead[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/share/${token}`)
      .then(async (r) => {
        const d = (await r.json()) as { label: string; items: UiLead[]; error?: string };
        if (!r.ok) throw new Error(d.error ?? "This link is not available.");
        setData(d);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const items = useMemo(() => (data?.items ?? []).filter((l) => !q || `${l.title} ${l.company}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const selected = items.find((l) => l.id === selectedId) ?? items[0];

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
        <div className="grid size-[26px] place-items-center rounded-lg bg-gradient-to-br from-accent to-[#b4a9ff]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </div>
        <span className="font-semibold tracking-tight">Scoutline</span>
        <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11.5px] text-muted">
          <Eye size={12} /> View only
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="ml-auto hidden h-[34px] w-64 rounded-lg border border-line bg-surface px-3 text-[13px] outline-none placeholder:text-faint focus:border-accent/55 sm:block"
        />
      </header>
      <main className="mx-auto max-w-[1480px] px-4 pt-7 pb-10 sm:px-6">
        {error ? (
          <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-6 text-center">
            <div className="text-base font-semibold">Link not available</div>
            <p className="mt-1 text-[13px] text-muted">{error}</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{data?.label ?? "Shared leads"}</h1>
            <p className="mt-0.5 mb-5 text-[13.5px] text-muted">{data ? `${data.items.length} leads, scored and ranked.` : "Loading…"}</p>
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <LeadsTable leads={items} selectedId={selected?.id} onSelect={setSelectedId} />
              {selected && (
                <aside className="rounded-xl border border-line bg-surface p-[18px] shadow-float xl:sticky xl:top-[72px]">
                  <div className="flex items-start gap-3">
                    <ScoreRing score={selected.score} size={56} stroke={5} />
                    <div className="min-w-0">
                      <div className="text-base font-semibold leading-snug tracking-tight">{selected.title}</div>
                      <div className="mt-1 text-[12.5px] text-muted">
                        {selected.company} · {flag(selected.country)} {selected.city}
                      </div>
                      <div className="text-[12px] text-faint">
                        {selected.source} · {timeAgo(selected.postedMinutesAgo)} · {CATEGORY_LABEL[selected.category]}
                      </div>
                    </div>
                  </div>
                  {selected.why.length > 0 && (
                    <ul className="mt-4 ml-4 list-disc space-y-1 text-[13px] leading-relaxed text-muted">
                      {selected.why.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {selected.url && (
                    <a href={selected.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-[34px] w-full items-center justify-center gap-1.5 rounded-lg bg-fg text-[13px] font-medium text-bg hover:opacity-90">
                      <ExternalLink size={14} /> Open original post
                    </a>
                  )}
                </aside>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

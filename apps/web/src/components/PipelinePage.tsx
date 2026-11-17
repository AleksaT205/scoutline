import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X, AlarmClock } from "lucide-react";
import { LEAD_TYPES, type LeadStatus, type LeadType } from "@radar/shared";
import type { UiLead } from "../data/demo";
import { changeStatus } from "./LeadCrm";
import { FilterChip } from "./Filters";
import { LeadDetail } from "./LeadDetail";
import { Segmented } from "../lib/ui";
import { DeadlineChip, ScoreRing, STATUS_META, TYPE_META, TierBadge, TypeBadge, flag } from "./ui";

const COLUMNS: Array<{ status: LeadStatus; hint: string }> = [
  { status: "new", hint: "Best new leads, by score" },
  { status: "contacted", hint: "First message sent" },
  { status: "replied", hint: "They answered" },
  { status: "meeting", hint: "Call booked" },
  { status: "won", hint: "Signed" },
  { status: "lost", hint: "Not this time" },
];
const PAGE = 25;
const eur = (v: number) => (v >= 1000 ? `€${Math.round(v / 1000)}k` : `€${v}`);

function Card({ lead, busy, selected, onDragStart, onOpen }: { lead: UiLead; busy: boolean; selected: boolean; onDragStart: () => void; onOpen: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onClick={onOpen}
      className={`cursor-pointer rounded-lg border bg-surface p-2.5 shadow-sm transition-shadow hover:shadow-float active:cursor-grabbing ${selected ? "border-accent/60 ring-1 ring-accent/30" : "border-line"} ${busy ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-2">
        <ScoreRing score={lead.score} size={28} stroke={2.5} />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-1">
            <TypeBadge type={lead.leadType} />
            {lead.deadline && <DeadlineChip deadline={lead.deadline} />}
            {lead.followUpAt && (
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10.5px] ${Date.parse(lead.followUpAt) <= Date.now() ? "bg-warning/15 text-warning" : "bg-surface-2 text-muted"}`} title="Follow-up reminder">
                <AlarmClock size={10} /> {new Date(lead.followUpAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </span>
            )}
          </div>
          <div className="line-clamp-2 text-[12.5px] font-medium leading-snug">{lead.title}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted">{lead.company}</div>
        </div>
        {busy && <Loader2 size={12} className="animate-spin text-faint" />}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
        {flag(lead.country)} <TierBadge tier={lead.tier} />
        <span className="truncate text-faint">{lead.source}</span>
        {lead.budgetEur > 0 && <span className="num ml-auto shrink-0">{lead.budgetLabel}</span>}
      </div>
    </div>
  );
}

export function PipelinePage({ leads, live, onUpdated }: { leads: UiLead[]; live: boolean; onUpdated: (l: UiLead) => void; onOpenLead?: (id: string) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStatus | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<Set<LeadType>>(new Set(["tender", "project", "intent"]));
  const [minScore, setMinScore] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setLimit(PAGE), [q, types, minScore]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  // Pretraga i filteri važe za sve kolone (u toku posla se vide i oglasi za posao, bez obzira na tip)
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return leads.filter((l) => {
      const status = l.status ?? "new";
      if (status === "hidden") return false;
      if (status === "new" && !types.has(l.leadType ?? "hiring_signal")) return false;
      if (status === "new" && l.score < minScore) return false;
      return !s || `${l.title} ${l.company} ${l.source} ${l.city}`.toLowerCase().includes(s);
    });
  }, [leads, q, types, minScore]);

  const byStatus = useMemo(() => {
    const map = new Map<LeadStatus, UiLead[]>(COLUMNS.map((c) => [c.status, []]));
    for (const l of filtered) {
      const s = l.status ?? "new";
      if (map.has(s)) map.get(s)!.push(l);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.score - a.score);
    return map;
  }, [filtered]);

  const move = async (id: string, to: LeadStatus) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead || (lead.status ?? "new") === to) return;
    if (!live) return setError("This is sample data — drag & drop works on live leads.");
    setBusyId(id);
    setError(null);
    try {
      onUpdated(await changeStatus(lead, to));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const all = (s: LeadStatus) => leads.filter((l) => (l.status ?? "new") === s);
  const active = (["contacted", "replied", "meeting"] as LeadStatus[]).reduce((a, s) => a + all(s).length, 0);
  const won = all("won");
  const lost = all("lost");
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  const opened = leads.find((l) => l.id === openId) ?? null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">Click a lead to open it, drag it between stages as the conversation moves. Every move is saved to the lead’s history.</p>
        </div>
      </div>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {[
          ["In conversation", String(active)],
          ["Won", String(won.length)],
          ["Won value", won.length ? eur(won.reduce((a, l) => a + l.budgetEur, 0)) : "€0"],
          ["Win rate", winRate === null ? "—" : `${winRate}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface px-3 py-3 sm:px-4 sm:py-4">
            <div className="text-[12px] text-muted sm:text-[12.5px]">{label}</div>
            <div className="num mt-1 text-[22px] font-semibold leading-tight tracking-tight sm:text-[26px]">{value}</div>
          </div>
        ))}
      </section>

      {/* Pretraga i filteri — ista traka kao na Leads */}
      <div className="mb-3 rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-1.5 p-2">
          <label className="flex h-[34px] min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-line bg-bg px-3 text-faint focus-within:border-accent/55 sm:max-w-[420px] sm:basis-56">
            <Search size={14} className="shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads, companies, sources…" className="w-full min-w-0 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" aria-label="Search pipeline" />
            {q && (
              <button onClick={() => setQ("")} className="grid size-[22px] shrink-0 place-items-center rounded text-faint hover:text-fg" aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </label>
          <Segmented
            full
            className="sm:ml-auto"
            value={String(minScore) as "0" | "50" | "70"}
            onChange={(v) => setMinScore(Number(v))}
            options={[
              ["0", "Any score"],
              ["50", "50+"],
              ["70", "70+"],
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-2">
          <span className="hidden pl-1 pr-0.5 text-[12px] text-faint sm:inline" title="Applies to the New column">
            Type
          </span>
          {LEAD_TYPES.map((t) => (
            <FilterChip
              key={t}
              on={types.has(t)}
              onClick={() => {
                const n = new Set(types);
                if (n.has(t)) n.delete(t);
                else n.add(t);
                setTypes(n);
              }}
              title={`${TYPE_META[t].hint} (applies to the New column)`}
            >
              {TYPE_META[t].label}
            </FilterChip>
          ))}
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      <div className="-mx-4 snap-x snap-proximity scroll-px-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6">
        <div className="grid min-w-[1650px] grid-cols-6 gap-3 [&>*]:snap-start">
          {COLUMNS.map(({ status, hint }) => {
            const list = byStatus.get(status) ?? [];
            const items = status === "new" ? list.slice(0, limit) : list;
            const value = list.reduce((a, l) => a + l.budgetEur, 0);
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(status);
                }}
                onDragLeave={() => setOver((o) => (o === status ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  if (id) void move(id, status);
                  setDragId(null);
                }}
                className={`flex min-h-[420px] flex-col rounded-xl border bg-bg p-2 transition-colors ${over === status ? "border-accent/60 bg-accent-soft" : "border-line"}`}
              >
                <div className="mb-2 px-1">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_META[status].cls}`}>{STATUS_META[status].label}</span>
                    <span className="num text-[12px] text-faint">{list.length}</span>
                    {value > 0 && status !== "new" && <span className="num ml-auto text-[11.5px] text-muted">{eur(value)}</span>}
                  </div>
                  <div className="mt-1 text-[11px] text-faint">{hint}</div>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {items.map((l) => (
                    <Card key={l.id} lead={l} busy={busyId === l.id} selected={openId === l.id} onDragStart={() => setDragId(l.id)} onOpen={() => setOpenId(l.id)} />
                  ))}
                  {items.length === 0 && <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-line text-[12px] text-faint">{q ? "No matches" : "Drop here"}</div>}
                  {status === "new" && list.length > items.length && (
                    <button onClick={() => setLimit((n) => n + PAGE)} className="rounded-lg border border-line bg-surface py-1.5 text-center text-[12px] text-muted hover:text-fg">
                      Show {Math.min(PAGE, list.length - items.length)} more · {list.length - items.length} left
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-[12px] text-faint">Tip: search finds any lead in any stage. “Hide” removes a lead from the pipeline without deleting it.</p>

      {/* Detalj leada u bočnom panelu — bez napuštanja Pipeline-a */}
      {opened && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpenId(null)}>
          <div className="absolute inset-x-0 bottom-0 top-10 overflow-y-auto rounded-t-2xl border-t border-line bg-bg px-3 pb-8 pt-2 sm:inset-x-auto sm:right-0 sm:top-0 sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 -mx-3 mb-2 flex items-center bg-bg/90 px-3 py-2 backdrop-blur">
              <span className="text-[12.5px] text-muted">Lead · {STATUS_META[opened.status ?? "new"].label}</span>
              <button onClick={() => setOpenId(null)} className="ml-auto rounded-md px-2 py-1 text-[13px] text-muted hover:text-fg">
                Close
              </button>
            </div>
            <LeadDetail lead={opened} live={live} onUpdated={onUpdated} />
          </div>
        </div>
      )}
    </>
  );
}

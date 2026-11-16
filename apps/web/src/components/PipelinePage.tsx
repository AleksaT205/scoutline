import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { LeadStatus } from "@radar/shared";
import type { UiLead } from "../data/demo";
import { changeStatus } from "./LeadCrm";
import { ScoreRing, STATUS_META, TierBadge, flag } from "./ui";

const COLUMNS: Array<{ status: LeadStatus; hint: string }> = [
  { status: "new", hint: "Best new leads (top 25 by score)" },
  { status: "contacted", hint: "First message sent" },
  { status: "replied", hint: "They answered" },
  { status: "meeting", hint: "Call booked" },
  { status: "won", hint: "Signed" },
  { status: "lost", hint: "Not this time" },
];

const eur = (v: number) => (v >= 1000 ? `€${Math.round(v / 1000)}k` : `€${v}`);

function Card({ lead, busy, onDragStart, onOpen }: { lead: UiLead; busy: boolean; onDragStart: () => void; onOpen: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onClick={onOpen}
      className={`cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-sm transition-shadow hover:shadow-float active:cursor-grabbing ${busy ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-2">
        <ScoreRing score={lead.score} size={28} stroke={2.5} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[12.5px] font-medium leading-snug">{lead.title}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted">{lead.company}</div>
        </div>
        {busy && <Loader2 size={12} className="animate-spin text-faint" />}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
        {flag(lead.country)} <TierBadge tier={lead.tier} />
        {lead.budgetEur > 0 && <span className="num ml-auto">{lead.budgetLabel}</span>}
      </div>
    </div>
  );
}

export function PipelinePage({ leads, live, onUpdated, onOpenLead }: { leads: UiLead[]; live: boolean; onUpdated: (l: UiLead) => void; onOpenLead: (id: string) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStatus | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byStatus = useMemo(() => {
    const map = new Map<LeadStatus, UiLead[]>(COLUMNS.map((c) => [c.status, []]));
    for (const l of leads) {
      const s = l.status ?? "new";
      if (map.has(s)) map.get(s)!.push(l);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.score - a.score);
    return map;
  }, [leads]);

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

  const active = (["contacted", "replied", "meeting"] as LeadStatus[]).reduce((a, s) => a + (byStatus.get(s)?.length ?? 0), 0);
  const won = byStatus.get("won") ?? [];
  const lost = byStatus.get("lost") ?? [];
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">Drag leads between stages as conversations move forward. Every move is saved to the lead’s history.</p>
        </div>
      </div>

      <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ["In conversation", String(active)],
          ["Won", String(won.length)],
          ["Won value", won.length ? eur(won.reduce((a, l) => a + l.budgetEur, 0)) : "€0"],
          ["Win rate", winRate === null ? "—" : `${winRate}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface px-4 py-4">
            <div className="text-[12.5px] text-muted">{label}</div>
            <div className="num mt-1.5 text-[26px] font-semibold leading-tight tracking-tight">{value}</div>
          </div>
        ))}
      </section>

      {error && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
        <div className="grid min-w-[1100px] grid-cols-6 gap-3">
          {COLUMNS.map(({ status, hint }) => {
            const all = byStatus.get(status) ?? [];
            const items = status === "new" ? all.slice(0, 25) : all;
            const value = all.reduce((a, l) => a + l.budgetEur, 0);
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
                    <span className="num text-[12px] text-faint">{all.length}</span>
                    {value > 0 && status !== "new" && <span className="num ml-auto text-[11.5px] text-muted">{eur(value)}</span>}
                  </div>
                  <div className="mt-1 text-[11px] text-faint">{hint}</div>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {items.map((l) => (
                    <Card key={l.id} lead={l} busy={busyId === l.id} onDragStart={() => setDragId(l.id)} onOpen={() => onOpenLead(l.id)} />
                  ))}
                  {items.length === 0 && <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-line text-[12px] text-faint">Drop here</div>}
                  {status === "new" && all.length > items.length && (
                    <a href="#/" className="py-1 text-center text-[12px] text-muted hover:text-fg">
                      +{all.length - items.length} more in Leads
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-[12px] text-faint">Tip: open a lead to add notes. “Hide” removes a lead from the pipeline without deleting it.</p>
    </>
  );
}

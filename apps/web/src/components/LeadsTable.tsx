import type { UiLead } from "../data/demo";
import { CATEGORY_LABEL, DeadlineChip, ScoreRing, StatusPill, Tag, TierBadge, TypeBadge, flag, industryLabel, timeAgo } from "./ui";

import type { SortKey } from "./Filters";

function SortTh({ k, label, sort, onSort, className = "" }: { k: SortKey; label: string; sort?: { by: SortKey; dir: "asc" | "desc" }; onSort?: (k: SortKey) => void; className?: string }) {
  const on = sort?.by === k;
  return (
    <th className={`px-2.5 py-2.5 font-medium ${className}`} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort?.(k)} className={`inline-flex items-center gap-1 hover:text-fg ${on ? "text-fg" : ""}`} title={`Sort by ${label.toLowerCase()}`}>
        {label}
        <span className="text-[10px]">{on ? (sort!.dir === "desc" ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
}

function SortButton({ k, label, sort, onSort }: { k: SortKey; label: string; sort?: { by: SortKey; dir: "asc" | "desc" }; onSort?: (k: SortKey) => void }) {
  const on = sort?.by === k;
  return (
    <button onClick={() => onSort?.(k)} className={`inline-flex items-center gap-1 font-medium hover:text-fg ${on ? "text-fg" : ""}`} title={`Sort by ${label.toLowerCase()}`}>
      {label}
      <span className="text-[10px]">{on ? (sort!.dir === "desc" ? "▼" : "▲") : "↕"}</span>
    </button>
  );
}

export function LeadsTable({ leads, selectedId, onSelect, sort, onSort, loading }: { leads: UiLead[]; selectedId?: string; onSelect: (id: string) => void; sort?: { by: SortKey; dir: "asc" | "desc" }; onSort?: (k: SortKey) => void; loading?: boolean }) {
  if (loading)
    return (
      <div className="space-y-2 rounded-xl border border-line bg-surface p-3" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    );
  if (leads.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center">
        <div className="text-sm font-medium">No leads match these filters</div>
        <p className="mt-1 text-[13px] text-muted">Try another type (e.g. Hiring signals) or lower the minimum score.</p>
      </div>
    );
  }
  return (
    <>
    {/* Telefon: kartice */}
    <ul className="space-y-2 md:hidden">
      {leads.map((l) => (
        <li key={l.id}>
          <button
            onClick={() => onSelect(l.id)}
            className={`w-full rounded-xl border bg-surface p-3 text-left transition-colors ${l.id === selectedId ? "border-accent/60 bg-accent-soft" : "border-line active:bg-surface-2"}`}
          >
            <div className="flex items-start gap-3">
              <ScoreRing score={l.score} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <TypeBadge type={l.leadType} />
                  {l.status && l.status !== "new" && <StatusPill status={l.status} />}
                  {l.deadline && <DeadlineChip deadline={l.deadline} />}
                </div>
                <div className="line-clamp-2 text-[14px] font-medium leading-snug">{l.title}</div>
                <div className="mt-0.5 truncate text-[12.5px] text-muted">{l.company}</div>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1">
                {flag(l.country)} <TierBadge tier={l.tier} />
              </span>
              <span className="num">{l.budgetLabel}</span>
              <span className="ml-auto truncate text-faint">
                {l.source} · {timeAgo(l.postedMinutesAgo)}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
    {/* Tablet i računar: tabela */}
    <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
      <div className="overflow-x-auto">
        {/* Fiksne širine kolona: „Opportunity“ uzima ostatak, pa se ništa ne seče pored panela sa detaljima */}
        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[60px]" />
            <col />
            <col className="w-[88px]" />
            <col className="hidden w-[150px] 2xl:table-column" />
            <col className="w-[92px]" />
            <col className="w-[150px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-line text-left text-xs text-faint">
              <SortTh k="score" label="Score" sort={sort} onSort={onSort} />
              <th className="px-2.5 py-2.5 font-medium">Opportunity</th>
              <th className="px-2.5 py-2.5 font-medium">Market</th>
              <th className="hidden px-2.5 py-2.5 font-medium 2xl:table-cell">Category</th>
              <SortTh k="budget" label="Budget" sort={sort} onSort={onSort} />
              <th className="px-2.5 py-2.5 font-medium">
                <span className="inline-flex gap-2 whitespace-nowrap">
                  <SortButton k="source" label="Source" sort={sort} onSort={onSort} />
                  <span className="text-faint">·</span>
                  <SortButton k="posted" label="Posted" sort={sort} onSort={onSort} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const sel = l.id === selectedId;
              return (
                <tr
                  key={l.id}
                  onClick={() => onSelect(l.id)}
                  className={`cursor-pointer border-b border-line transition-colors last:border-0 ${
                    sel ? "bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-2"
                  }`}
                >
                  <td className="px-2.5 py-2.5">
                    <ScoreRing score={l.score} />
                  </td>
                  <td className="px-2.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <TypeBadge type={l.leadType} />
                      <span className="truncate font-medium" title={l.title}>{l.title}</span>
                      {l.status && l.status !== "new" && <StatusPill status={l.status} />}
                    </div>
                    <div className="flex items-center gap-1.5 truncate text-xs text-muted">
                      <span className="truncate">
                        {l.company} · {industryLabel(l.industry)}
                      </span>
                      {l.deadline && (
                        <>
                          <span className="text-faint">·</span>
                          <DeadlineChip deadline={l.deadline} />
                        </>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      {flag(l.country)} <TierBadge tier={l.tier} />
                    </span>
                  </td>
                  <td className="hidden px-2.5 py-2.5 2xl:table-cell">
                    <Tag>{CATEGORY_LABEL[l.category]}</Tag>
                  </td>
                  <td className="num whitespace-nowrap px-2.5 py-2.5 text-[12.5px]">{l.budgetLabel}</td>
                  <td className="px-2.5 py-2.5 text-xs text-muted">
                    <div className="truncate" title={l.source}>{l.source}</div>
                    <div className="text-faint">{timeAgo(l.postedMinutesAgo)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

import type { UiLead } from "../data/demo";
import { CATEGORY_LABEL, DeadlineChip, ScoreRing, StatusPill, Tag, TierBadge, TypeBadge, flag, industryLabel, timeAgo } from "./ui";

export function LeadsTable({ leads, selectedId, onSelect }: { leads: UiLead[]; selectedId?: string; onSelect: (id: string) => void }) {
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
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-faint">
              <th className="px-2.5 py-2.5 font-medium">Score</th>
              <th className="px-2.5 py-2.5 font-medium">Opportunity</th>
              <th className="px-2.5 py-2.5 font-medium">Market</th>
              <th className="hidden px-2.5 py-2.5 font-medium md:table-cell">Category</th>
              <th className="px-2.5 py-2.5 font-medium">Budget</th>
              <th className="hidden px-2.5 py-2.5 font-medium sm:table-cell">Source</th>
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
                  <td className="max-w-[300px] px-2.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <TypeBadge type={l.leadType} />
                      <span className="truncate font-medium">{l.title}</span>
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
                  <td className="hidden px-2.5 py-2.5 md:table-cell">
                    <Tag>{CATEGORY_LABEL[l.category]}</Tag>
                  </td>
                  <td className="num whitespace-nowrap px-2.5 py-2.5 text-[12.5px]">{l.budgetLabel}</td>
                  <td className="hidden whitespace-nowrap px-2.5 py-2.5 text-xs text-muted sm:table-cell">
                    {l.source}
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

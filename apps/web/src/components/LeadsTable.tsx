import type { UiLead } from "../data/demo";
import { CATEGORY_LABEL, ScoreRing, Tag, TierBadge, flag, industryLabel, timeAgo } from "./ui";

export function LeadsTable({ leads, selectedId, onSelect }: { leads: UiLead[]; selectedId?: string; onSelect: (id: string) => void }) {
  if (leads.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-line bg-surface px-6 py-16 text-center">
        <div className="text-sm font-medium">No leads match these filters</div>
        <p className="mt-1 text-[13px] text-muted">Try lowering the minimum score or budget.</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
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
                    <div className="truncate font-medium">{l.title}</div>
                    <div className="truncate text-xs text-muted">
                      {l.company} · {industryLabel(l.industry)}
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
  );
}

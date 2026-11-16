import type { Tier } from "@radar/shared";
import { X } from "lucide-react";

export interface FilterState {
  tiers: Set<Tier>;
  minScore: number;
  minBudget: number;
  remoteOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  tiers: new Set<Tier>(["T1", "T2", "DOMESTIC"]),
  minScore: 70,
  minBudget: 3000,
  remoteOnly: false,
};

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors ${
        on ? "border-accent/55 bg-accent-soft text-fg" : "border-line bg-surface text-muted hover:text-fg"
      }`}
    >
      {children}
      {on && <X size={12} className="text-faint" />}
    </button>
  );
}

export function Filters({ value, onChange, shown, total }: { value: FilterState; onChange: (f: FilterState) => void; shown: number; total: number }) {
  const toggleTier = (t: Tier) => {
    const tiers = new Set(value.tiers);
    if (tiers.has(t)) tiers.delete(t);
    else tiers.add(t);
    onChange({ ...value, tiers });
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Chip on={value.tiers.has("T1")} onClick={() => toggleTier("T1")}>Tier 1</Chip>
      <Chip on={value.tiers.has("T2")} onClick={() => toggleTier("T2")}>Tier 2</Chip>
      <Chip on={value.tiers.has("DOMESTIC")} onClick={() => toggleTier("DOMESTIC")}>🇷🇸 Domestic</Chip>
      <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
      <Chip on={value.minScore > 0} onClick={() => onChange({ ...value, minScore: value.minScore ? 0 : 70 })}>Score ≥ 70</Chip>
      <Chip on={value.minBudget > 0} onClick={() => onChange({ ...value, minBudget: value.minBudget ? 0 : 3000 })}>Budget ≥ €3k or unknown</Chip>
      <Chip on={value.remoteOnly} onClick={() => onChange({ ...value, remoteOnly: !value.remoteOnly })}>Remote-friendly</Chip>
      <span className="ml-auto text-[12.5px] text-faint">
        <span className="num">{shown}</span> of <span className="num">{total}</span> leads
      </span>
    </div>
  );
}

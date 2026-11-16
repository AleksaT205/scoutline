import { INDUSTRIES, SERVICE_CATEGORIES, type Tier } from "@radar/shared";
import { Info, RotateCcw } from "lucide-react";
import type { UiLead } from "../data/demo";
import { CATEGORY_LABEL } from "./ui";

export type Market = Tier | "UNKNOWN";

export interface FilterState {
  markets: Set<Market>;
  minScore: number; // 0 | 50 | 70
  minBudget: number; // 0 | 3000
  remoteOnly: boolean;
  category: string; // "all" | ServiceCategory
  industry: string; // "all" | Industry
  query: string;
}

export const DEFAULT_FILTERS: FilterState = {
  markets: new Set<Market>(["T1", "T2", "T3", "UNKNOWN", "DOMESTIC"]),
  minScore: 50,
  minBudget: 0,
  remoteOnly: false,
  category: "all",
  industry: "all",
  query: "",
};

export const marketOf = (l: UiLead): Market => l.tier ?? "UNKNOWN";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function applyFilters(leads: UiLead[], f: FilterState): UiLead[] {
  const q = f.query.trim().toLowerCase();
  return leads.filter(
    (l) =>
      f.markets.has(marketOf(l)) &&
      l.score >= f.minScore &&
      (!f.minBudget || !l.budgetEur || l.budgetEur >= f.minBudget) &&
      (!f.remoteOnly || l.remoteOk === true || (l.remoteOk === undefined && /remote|worldwide|eu/i.test(l.remote))) &&
      (f.category === "all" || l.category === f.category) &&
      (f.industry === "all" || norm(l.industry) === norm(f.industry)) &&
      (!q || `${l.title} ${l.company} ${l.city}`.toLowerCase().includes(q)),
  );
}

const MARKETS: Array<{ key: Market; label: string; hint: string }> = [
  { key: "T1", label: "Tier 1", hint: "Najbogatija tržišta: SAD, Kanada, UK, Irska, Nemačka, Austrija, Švajcarska, Benelux, Skandinavija, Australija, NZ, Singapur, UAE" },
  { key: "T2", label: "Tier 2", hint: "Dobra tržišta: Francuska, Italija, Španija, Portugal, Japan, Koreja, Estonija, Češka, Slovenija, Malta, Kipar…" },
  { key: "T3", label: "Other", hint: "Ostale zemlje (npr. Indija, Brazil, Poljska)" },
  { key: "UNKNOWN", label: "Worldwide / unknown", hint: "Oglas ne navodi zemlju firme (često „Remote, worldwide“). AI je popunjava kad je to moguće." },
  { key: "DOMESTIC", label: "🇷🇸 Serbia & region", hint: "Srbija i region. Domaći izvori (Infostud, HelloWorld…) se dodaju u sledećoj fazi." },
];

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors ${
        on ? "border-accent/55 bg-accent-soft text-fg" : "border-line bg-surface text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Select({ value, onChange, children, label }: { value: string; onChange: (v: string) => void; children: React.ReactNode; label: string }) {
  return (
    <label className="relative inline-flex h-[30px] items-center rounded-full border border-line bg-surface pl-2.5 pr-1 text-[12.5px] text-muted focus-within:border-accent/55">
      <span className="mr-1 text-faint">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="cursor-pointer appearance-none bg-transparent pr-4 text-fg outline-none">
        {children}
      </select>
      <span className="pointer-events-none absolute right-2 text-[10px] text-faint">▾</span>
    </label>
  );
}

export function Filters({ value, onChange, all, shown }: { value: FilterState; onChange: (f: FilterState) => void; all: UiLead[]; shown: number }) {
  const counts = new Map<Market, number>();
  for (const l of all) counts.set(marketOf(l), (counts.get(marketOf(l)) ?? 0) + 1);

  const toggleMarket = (m: Market) => {
    const markets = new Set(value.markets);
    if (markets.has(m)) markets.delete(m);
    else markets.add(m);
    onChange({ ...value, markets });
  };
  const isDefault =
    value.minScore === DEFAULT_FILTERS.minScore &&
    !value.minBudget &&
    !value.remoteOnly &&
    value.category === "all" &&
    value.industry === "all" &&
    !value.query &&
    value.markets.size === DEFAULT_FILTERS.markets.size;

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[12px] text-faint" title="Tier = koliko je tržište platežno. Klik uključuje/isključuje grupu.">
          Market <Info size={12} />
        </span>
        {MARKETS.map((m) => (
          <Chip key={m.key} on={value.markets.has(m.key)} onClick={() => toggleMarket(m.key)} title={m.hint}>
            {m.label}
            <span className="num text-[11px] text-faint">{counts.get(m.key) ?? 0}</span>
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-[30px] items-center rounded-full border border-line bg-surface p-0.5 text-[12.5px]">
          {[0, 50, 70].map((s) => (
            <button
              key={s}
              onClick={() => onChange({ ...value, minScore: s })}
              className={`h-full rounded-full px-2.5 transition-colors ${value.minScore === s ? "bg-surface-2 text-fg ring-1 ring-line ring-inset" : "text-muted hover:text-fg"}`}
            >
              {s === 0 ? "Any score" : `${s}+`}
            </button>
          ))}
        </div>
        <Select label="Service" value={value.category} onChange={(category) => onChange({ ...value, category })}>
          <option value="all">All</option>
          {SERVICE_CATEGORIES.filter((c) => c !== "not_relevant").map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select label="Industry" value={value.industry} onChange={(industry) => onChange({ ...value, industry })}>
          <option value="all">All</option>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>
              {i.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
            </option>
          ))}
        </Select>
        <Chip on={value.remoteOnly} onClick={() => onChange({ ...value, remoteOnly: !value.remoteOnly })}>
          Remote-friendly
        </Chip>
        <Chip on={value.minBudget > 0} onClick={() => onChange({ ...value, minBudget: value.minBudget ? 0 : 3000 })} title="Oglasi bez navedenog budžeta ostaju vidljivi">
          Budget ≥ €3k
        </Chip>
        {!isDefault && (
          <button onClick={() => onChange({ ...DEFAULT_FILTERS, markets: new Set(DEFAULT_FILTERS.markets) })} className="inline-flex h-[30px] items-center gap-1 px-1.5 text-[12.5px] text-muted hover:text-fg">
            <RotateCcw size={12} /> Reset
          </button>
        )}
        <span className="ml-auto text-[12.5px] text-faint">
          <span className="num">{shown}</span> of <span className="num">{all.length}</span> leads
        </span>
      </div>
    </div>
  );
}

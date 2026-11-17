import { useEffect, useRef, useState } from "react";
import { INDUSTRIES, LEAD_TYPES, SERVICE_CATEGORIES, type LeadType, type Tier } from "@radar/shared";
import { Check, ChevronDown, Info, RotateCcw, Search } from "lucide-react";
import type { UiLead } from "../data/demo";
import { CATEGORY_LABEL, TYPE_META } from "./ui";

export type Market = Tier | "UNKNOWN";

export interface FilterState {
  types: Set<LeadType>;
  markets: Set<Market>;
  sources: Set<string>; // prazno = svi izvori
  minScore: number; // 0 | 50 | 70 | 85
  minBudget: number; // 0 = bilo koji
  budgetKnownOnly: boolean; // sakrij oglase bez budžeta
  remoteOnly: boolean;
  category: string; // "all" | ServiceCategory
  industry: string; // "all" | Industry
  query: string;
  maxAgeHours: number; // 0 = bilo kada (po vremenu objave oglasa)
  status: string; // "open" | "all" | LeadStatus
  sortBy: SortKey;
  sortDir: "asc" | "desc";
}

export type SortKey = "score" | "budget" | "posted" | "source" | "deadline";

/** Podrazumevano: projekti za firmu, bez oglasa za posao. */
export const DEFAULT_TYPES: LeadType[] = ["tender", "project", "intent"];
const ALL_MARKETS: Market[] = ["T1", "T2", "T3", "UNKNOWN", "DOMESTIC"];

export const DEFAULT_FILTERS: FilterState = {
  types: new Set<LeadType>(DEFAULT_TYPES),
  markets: new Set<Market>(ALL_MARKETS),
  sources: new Set<string>(),
  minScore: 50,
  minBudget: 0,
  budgetKnownOnly: false,
  remoteOnly: false,
  category: "all",
  industry: "all",
  query: "",
  maxAgeHours: 0,
  status: "open",
  sortBy: "score",
  sortDir: "desc",
};

export const marketOf = (l: UiLead): Market => l.tier ?? "UNKNOWN";
export const typeOf = (l: UiLead): LeadType => l.leadType ?? "hiring_signal";
/** Nova kopija podrazumevanih filtera (Set-ovi se ne smeju deliti). */
export const freshFilters = (over: Partial<FilterState> = {}): FilterState => ({
  ...DEFAULT_FILTERS,
  types: new Set(DEFAULT_TYPES),
  markets: new Set(ALL_MARKETS),
  sources: new Set(),
  ...over,
});
const OPEN = ["new", "contacted", "replied", "meeting"];
const matchStatus = (s: string, f: string) => (f === "all" ? s !== "hidden" : f === "open" ? OPEN.includes(s) : s === f);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Sortiranje: bez vrednosti (npr. budžet nije naveden) uvek ide na kraj. */
export function sortLeads(list: UiLead[], by: SortKey, dir: "asc" | "desc"): UiLead[] {
  const val = (l: UiLead): number | string | null =>
    by === "score" ? l.score : by === "budget" ? (l.budgetEur || null) : by === "posted" ? (l.postedMinutesAgo === null ? null : -l.postedMinutesAgo) : by === "deadline" ? (l.deadline ? -Date.parse(l.deadline) : null) : l.source.toLowerCase();
  const m = dir === "desc" ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null && y === null) return b.score - a.score;
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return b.score - a.score;
    return (x < y ? -1 : 1) * m;
  });
}

export function applyFilters(leads: UiLead[], f: FilterState): UiLead[] {
  return sortLeads(filterLeads(leads, f), f.sortBy, f.sortDir);
}

function filterLeads(leads: UiLead[], f: FilterState): UiLead[] {
  const q = f.query.trim().toLowerCase();
  return leads.filter(
    (l) =>
      f.types.has(typeOf(l)) &&
      f.markets.has(marketOf(l)) &&
      (!f.sources.size || f.sources.has(l.source)) &&
      l.score >= f.minScore &&
      (!f.budgetKnownOnly || l.budgetEur > 0) &&
      (!f.minBudget || !l.budgetEur || l.budgetEur >= f.minBudget) &&
      (!f.remoteOnly || l.remoteOk === true || (l.remoteOk === undefined && /remote|worldwide|eu/i.test(l.remote))) &&
      (f.category === "all" || l.category === f.category) &&
      (f.industry === "all" || norm(l.industry) === norm(f.industry)) &&
      (!q || `${l.title} ${l.company} ${l.city}`.toLowerCase().includes(q)) &&
      (!f.maxAgeHours || (l.postedMinutesAgo !== null && l.postedMinutesAgo <= f.maxAgeHours * 60)) &&
      matchStatus(l.status ?? "new", f.status),
  );
}

const MARKETS: Array<{ key: Market; label: string; hint: string }> = [
  { key: "T1", label: "Tier 1", hint: "SAD, Kanada, UK, Irska, Nemačka, Austrija, Švajcarska, Benelux, Skandinavija, Australija, NZ, Singapur, UAE" },
  { key: "T2", label: "Tier 2", hint: "Francuska, Italija, Španija, Portugal, Japan, Koreja, Estonija, Češka, Slovenija…" },
  { key: "T3", label: "Other countries", hint: "Ostale zemlje (npr. Indija, Brazil, Poljska)" },
  { key: "UNKNOWN", label: "Worldwide / unknown", hint: "Oglas ne navodi zemlju" },
  { key: "DOMESTIC", label: "🇷🇸 Serbia & region", hint: "Srbija, BiH, Hrvatska, Crna Gora, S. Makedonija" },
];
const SCORES = [
  [0, "Any score"],
  [50, "50+"],
  [70, "70+ (good)"],
  [85, "85+ (best)"],
] as const;
const POSTED = [
  [0, "Any time"],
  [24, "Last 24 hours"],
  [72, "Last 3 days"],
  [168, "Last 7 days"],
  [720, "Last 30 days"],
] as const;
const BUDGETS = [
  [0, "Any budget"],
  [1000, "€1k+"],
  [5000, "€5k+"],
  [20000, "€20k+"],
  [100000, "€100k+"],
] as const;
const SORTS: Array<[SortKey, string, "asc" | "desc"]> = [
  ["score", "Score", "desc"],
  ["posted", "Newest", "desc"],
  ["budget", "Budget", "desc"],
  ["deadline", "Deadline (soonest)", "desc"],
  ["source", "Source (A–Z)", "asc"],
];
const STATUSES = [
  ["open", "Open (not won/lost)"],
  ["new", "New"],
  ["contacted", "Contacted"],
  ["replied", "Replied"],
  ["meeting", "Meeting"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["hidden", "Hidden"],
  ["all", "All (not hidden)"],
] as const;

/** Jedan uredan padajući filter: dugme sa trenutnom vrednošću + lista (jedan ili više izbora). */
function FilterMenu({ label, value, active, children, wide }: { label: string; value: string; active: boolean; children: (close: () => void) => React.ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] transition-colors ${active ? "border-accent/50 bg-accent-soft text-fg" : "border-line bg-surface text-muted hover:text-fg"}`}
      >
        <span className={active ? "text-muted" : "text-faint"}>{label}</span>
        <span className={`max-w-[150px] truncate ${active ? "font-medium text-fg" : "text-fg"}`}>{value}</span>
        <ChevronDown size={13} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`absolute left-0 z-40 mt-1 rounded-xl border border-line bg-surface p-1 shadow-float ${wide ? "w-72" : "w-56"}`} role="listbox">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Option({ selected, onClick, children, hint, count }: { selected: boolean; onClick: () => void; children: React.ReactNode; hint?: string; count?: number }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onClick} title={hint} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-surface-2 hover:text-fg">
      <span className={`grid size-4 shrink-0 place-items-center rounded ${selected ? "bg-accent text-white" : "border border-line-2"}`}>{selected && <Check size={11} strokeWidth={3} />}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="num text-[11px] text-faint">{count}</span>}
    </button>
  );
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors ${on ? "border-accent/55 bg-accent-soft text-fg" : "border-line bg-surface text-muted hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(set: Set<T>, v: T) => {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
};
const labelOf = <T extends readonly (readonly [number | string, string])[]>(list: T, v: number | string) => list.find(([k]) => k === v)?.[1] ?? String(v);

export function Filters({ value, onChange, all, shown }: { value: FilterState; onChange: (f: FilterState) => void; all: UiLead[]; shown: number }) {
  const [sourceQ, setSourceQ] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false); // na telefonu su filteri iza jednog dugmeta
  const set = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  const visible = all.filter((l) => (l.status ?? "new") !== "hidden");
  const count = <K,>(key: (l: UiLead) => K) => {
    const m = new Map<K, number>();
    for (const l of visible) m.set(key(l), (m.get(key(l)) ?? 0) + 1);
    return m;
  };
  const typeCounts = count(typeOf);
  const marketCounts = count(marketOf);
  const sourceCounts = count((l) => l.source);
  const sources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);

  const isDefault =
    value.minScore === DEFAULT_FILTERS.minScore &&
    !value.minBudget &&
    !value.budgetKnownOnly &&
    !value.remoteOnly &&
    value.category === "all" &&
    value.industry === "all" &&
    !value.query &&
    !value.maxAgeHours &&
    value.status === "open" &&
    !value.sources.size &&
    value.markets.size === ALL_MARKETS.length &&
    value.types.size === DEFAULT_TYPES.length &&
    DEFAULT_TYPES.every((t) => value.types.has(t));

  const marketValue = value.markets.size === ALL_MARKETS.length ? "All" : value.markets.size === 0 ? "None" : MARKETS.filter((m) => value.markets.has(m.key)).map((m) => m.label.replace("🇷🇸 ", "")).join(", ");
  const sourceValue = !value.sources.size ? "All" : value.sources.size === 1 ? [...value.sources][0]! : `${value.sources.size} sources`;

  return (
    <div className="mb-3 space-y-2">
      {/* Tip prilike — glavni izbor */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[12px] text-faint" title="Vrsta prilike. Oglasi za posao su podrazumevano isključeni — firmi trebaju projekti.">
          Type <Info size={12} />
        </span>
        {LEAD_TYPES.map((t) => (
          <Chip key={t} on={value.types.has(t)} onClick={() => set({ types: toggle(value.types, t) })} title={TYPE_META[t].hint}>
            {TYPE_META[t].label}
            <span className="num text-[11px] text-faint">{typeCounts.get(t) ?? 0}</span>
          </Chip>
        ))}
      </div>

      {/* Telefon: jedno dugme „Filters“ */}
      <div className="flex items-center gap-2 sm:hidden">
        <button onClick={() => setMobileOpen((o) => !o)} className={`inline-flex h-[32px] items-center gap-1.5 rounded-lg border px-3 text-[13px] ${!isDefault ? "border-accent/50 bg-accent-soft" : "border-line bg-surface"}`} aria-expanded={mobileOpen}>
          Filters {!isDefault && <span className="size-1.5 rounded-full bg-accent" />}
          <ChevronDown size={13} className={`text-faint transition-transform ${mobileOpen ? "rotate-180" : ""}`} />
        </button>
        {!isDefault && (
          <button onClick={() => onChange(freshFilters())} className="inline-flex h-[32px] items-center gap-1 px-1 text-[12.5px] text-muted">
            <RotateCcw size={12} /> Reset
          </button>
        )}
        <span className="ml-auto text-[12.5px] text-faint">
          <span className="num">{shown}</span> of <span className="num">{all.length}</span>
        </span>
      </div>

      {/* Ostali filteri — isti stil za svaki meni */}
      <div className={`${mobileOpen ? "flex" : "hidden"} flex-wrap items-center gap-1.5 sm:flex`}>
        <FilterMenu label="Score" value={labelOf(SCORES, value.minScore).replace(/ \(.+\)/, "")} active={value.minScore !== DEFAULT_FILTERS.minScore}>
          {(close) =>
            SCORES.map(([k, l]) => (
              <Option key={k} selected={value.minScore === k} onClick={() => (set({ minScore: k }), close())}>
                {l}
              </Option>
            ))
          }
        </FilterMenu>
        <FilterMenu label="Posted" value={labelOf(POSTED, value.maxAgeHours)} active={!!value.maxAgeHours}>
          {(close) =>
            POSTED.map(([k, l]) => (
              <Option key={k} selected={value.maxAgeHours === k} onClick={() => (set({ maxAgeHours: k }), close())}>
                {l}
              </Option>
            ))
          }
        </FilterMenu>
        <FilterMenu label="Budget" value={`${labelOf(BUDGETS, value.minBudget)}${value.budgetKnownOnly ? " · stated" : ""}`} active={!!value.minBudget || value.budgetKnownOnly}>
          {(close) => (
            <>
              {BUDGETS.map(([k, l]) => (
                <Option key={k} selected={value.minBudget === k} onClick={() => (set({ minBudget: k }), close())}>
                  {l}
                </Option>
              ))}
              <div className="my-1 border-t border-line" />
              <Option selected={value.budgetKnownOnly} onClick={() => set({ budgetKnownOnly: !value.budgetKnownOnly })} hint="Sakrij oglase koji ne navode budžet">
                Only with a stated budget
              </Option>
            </>
          )}
        </FilterMenu>
        <FilterMenu label="Source" value={sourceValue} active={value.sources.size > 0} wide>
          {() => (
            <>
              {sources.length > 7 && (
                <label className="mb-1 flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-bg px-2 text-faint focus-within:border-accent/60">
                  <Search size={12} />
                  <input autoFocus value={sourceQ} onChange={(e) => setSourceQ(e.target.value)} placeholder="Find a source…" className="w-full bg-transparent text-[12.5px] text-fg outline-none placeholder:text-faint" />
                </label>
              )}
              <div className="max-h-72 overflow-y-auto">
                <Option selected={!value.sources.size} onClick={() => set({ sources: new Set() })}>
                  All sources
                </Option>
                {sources
                  .filter(([s]) => !sourceQ || s.toLowerCase().includes(sourceQ.toLowerCase()))
                  .map(([s, n]) => (
                    <Option key={s} selected={value.sources.has(s)} onClick={() => set({ sources: toggle(value.sources, s) })} count={n}>
                      {s}
                    </Option>
                  ))}
              </div>
            </>
          )}
        </FilterMenu>
        <FilterMenu label="Market" value={marketValue} active={value.markets.size !== ALL_MARKETS.length} wide>
          {() => (
            <>
              {MARKETS.map((m) => (
                <Option key={m.key} selected={value.markets.has(m.key)} onClick={() => set({ markets: toggle(value.markets, m.key) })} hint={m.hint} count={marketCounts.get(m.key) ?? 0}>
                  {m.label}
                </Option>
              ))}
              <div className="my-1 border-t border-line" />
              <div className="flex gap-1 px-1 pb-0.5">
                <button type="button" onClick={() => set({ markets: new Set(ALL_MARKETS) })} className="rounded px-1.5 py-1 text-[12px] text-muted hover:text-fg">
                  All
                </button>
                <button type="button" onClick={() => set({ markets: new Set<Market>(["T1", "T2", "DOMESTIC"]) })} className="rounded px-1.5 py-1 text-[12px] text-muted hover:text-fg" title="Tier 1 + Tier 2 + region">
                  Best markets
                </button>
              </div>
            </>
          )}
        </FilterMenu>
        <FilterMenu label="Status" value={labelOf(STATUSES, value.status).replace(/ \(.+\)/, "")} active={value.status !== "open"}>
          {(close) =>
            STATUSES.map(([k, l]) => (
              <Option key={k} selected={value.status === k} onClick={() => (set({ status: k }), close())}>
                {l}
              </Option>
            ))
          }
        </FilterMenu>
        <FilterMenu label="Service" value={value.category === "all" ? "All" : (CATEGORY_LABEL[value.category as keyof typeof CATEGORY_LABEL] ?? value.category)} active={value.category !== "all"}>
          {(close) => (
            <div className="max-h-72 overflow-y-auto">
              <Option selected={value.category === "all"} onClick={() => (set({ category: "all" }), close())}>
                All services
              </Option>
              {SERVICE_CATEGORIES.filter((c) => c !== "not_relevant").map((c) => (
                <Option key={c} selected={value.category === c} onClick={() => (set({ category: c }), close())}>
                  {CATEGORY_LABEL[c]}
                </Option>
              ))}
            </div>
          )}
        </FilterMenu>
        <FilterMenu label="Industry" value={value.industry === "all" ? "All" : value.industry.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())} active={value.industry !== "all"}>
          {(close) => (
            <div className="max-h-72 overflow-y-auto">
              <Option selected={value.industry === "all"} onClick={() => (set({ industry: "all" }), close())}>
                All industries
              </Option>
              {INDUSTRIES.map((i) => (
                <Option key={i} selected={value.industry === i} onClick={() => (set({ industry: i }), close())}>
                  {i.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                </Option>
              ))}
            </div>
          )}
        </FilterMenu>
        <Chip on={value.remoteOnly} onClick={() => set({ remoteOnly: !value.remoteOnly })}>
          Remote-friendly
        </Chip>
        <FilterMenu label="Sort" value={`${SORTS.find(([k]) => k === value.sortBy)?.[1] ?? "Score"} ${value.sortDir === "desc" ? "↓" : "↑"}`} active={value.sortBy !== "score" || value.sortDir !== "desc"}>
          {(close) => (
            <>
              {SORTS.map(([k, l, dir]) => (
                <Option key={k} selected={value.sortBy === k} onClick={() => (set({ sortBy: k, sortDir: value.sortBy === k ? (value.sortDir === "desc" ? "asc" : "desc") : dir }), close())}>
                  {l}
                  {value.sortBy === k ? (value.sortDir === "desc" ? " ↓" : " ↑") : ""}
                </Option>
              ))}
              <div className="px-2 pt-1 text-[11px] text-faint">Click again to reverse the order</div>
            </>
          )}
        </FilterMenu>
        {!isDefault && (
          <button onClick={() => onChange(freshFilters())} className="hidden h-[30px] items-center gap-1 px-1.5 text-[12.5px] text-muted hover:text-fg sm:inline-flex">
            <RotateCcw size={12} /> Reset
          </button>
        )}
        <span className="ml-auto hidden text-[12.5px] text-faint sm:inline">
          <span className="num">{shown}</span> of <span className="num">{all.length}</span> leads
        </span>
      </div>
    </div>
  );
}

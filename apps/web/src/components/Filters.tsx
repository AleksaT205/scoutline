import { useEffect, useRef, useState } from "react";
import { INDUSTRIES, LEAD_TYPES, SERVICE_CATEGORIES, type LeadType, type Tier } from "@radar/shared";
import { Check, ChevronDown, Info, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
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
function FilterMenu({ label, value, active, children, wide, onClear, align = "left", block }: { label: string; value: string; active: boolean; children: (close: () => void) => React.ReactNode; wide?: boolean; onClear?: () => void; align?: "left" | "right"; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  return (
    <div ref={ref} className={`relative ${block ? "flex-1 sm:flex-none" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} className={`${toolBtn(active)} ${block ? "w-full justify-between sm:w-auto" : ""}`}>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className={active ? "text-muted" : "text-faint"}>{label}</span>
          <span className={`max-w-[150px] truncate text-fg ${active ? "font-medium" : ""}`}>{value}</span>
        </span>
        {active && onClear ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label} filter`}
            title={`Clear ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
              setOpen(false);
            }}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), e.stopPropagation(), onClear())}
            className="-mr-1 grid size-[18px] place-items-center rounded-full text-muted hover:bg-accent/20 hover:text-fg"
          >
            <X size={11} strokeWidth={2.5} />
          </span>
        ) : (
          <ChevronDown size={13} className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && (
        <div className={`absolute z-40 mt-1 rounded-xl border border-line bg-surface p-1 shadow-float ${align === "right" ? "right-0" : "left-0"} ${wide ? "w-72" : "w-56"}`} role="listbox">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Zatvaranje na klik sa strane i Esc. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      window.removeEventListener("keydown", esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** Dugme u traci filtera (34px): neutralno ili istaknuto kad je filter uključen. */
const toolBtn = (active: boolean) =>
  `inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[13px] transition-colors ${active ? "border-accent/50 bg-accent-soft text-fg" : "border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg"}`;

function Option({ selected, onClick, children, hint, count }: { selected: boolean; onClick: () => void; children: React.ReactNode; hint?: string; count?: number }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onClick} title={hint} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
      <span className={`grid size-4 shrink-0 place-items-center rounded ${selected ? "bg-accent text-white" : "border border-line-2"}`}>{selected && <Check size={11} strokeWidth={3} />}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="num text-[11px] text-faint">{count}</span>}
    </button>
  );
}

/** Čip-prekidač (28px) — isti na Leads i Pipeline. */
export function FilterChip({ on, onClick, title, children, count }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`inline-flex h-[28px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12px] transition-colors ${on ? "border-accent/55 bg-accent-soft text-fg" : "border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg"}`}
    >
      {children}
      {count !== undefined && <span className="num text-[11px] text-faint">{count}</span>}
    </button>
  );
}

/** Grupa u panelu „Filters“: naziv iznad, kontrole ispod. */
function Group({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{label}</div>
      {children}
    </div>
  );
}
/** Padajuća lista u panelu — isti izgled kao meniji Score i Posted (umesto sistemske liste pregledača). */
function PanelSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const list = useRef<HTMLDivElement>(null);
  // Na telefonu je panel list koji se skroluje — otvorenu listu dovedi u vidno polje
  useEffect(() => {
    if (open) list.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
  const current = options.find(([k]) => k === value)?.[1] ?? value;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        className={`flex h-[34px] w-full items-center justify-between gap-2 rounded-lg border bg-bg px-2.5 text-left text-[13px] text-fg outline-none transition-colors focus-visible:border-accent/60 ${open ? "border-accent/55" : "border-line hover:bg-surface-2"}`}
      >
        <span className="min-w-0 truncate">{current}</span>
        <ChevronDown size={13} className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div ref={list} className="absolute inset-x-0 z-40 mt-1 max-h-64 scroll-mb-3 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-float" role="listbox" aria-label={label}>
          {options.map(([k, l]) => (
            <Option key={k} selected={k === value} onClick={() => (onChange(k), setOpen(false))}>
              {l}
            </Option>
          ))}
        </div>
      )}
    </div>
  );
}

const toggle = <T,>(set: Set<T>, v: T) => {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
};
const labelOf = <T extends readonly (readonly [number | string, string])[]>(list: T, v: number | string) => list.find(([k]) => k === v)?.[1] ?? String(v);
const short = (s: string) => s.replace(/ \(.+\)/, "");
const cap = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function Filters({ value, onChange, all, shown }: { value: FilterState; onChange: (f: FilterState) => void; all: UiLead[]; shown: number }) {
  const [sourceQ, setSourceQ] = useState("");
  const [moreOpen, setMoreOpen] = useState(false); // ređe korišćeni filteri su u panelu „Filters“
  const moreRef = useRef<HTMLDivElement>(null);
  useDismiss(moreOpen, moreRef, () => setMoreOpen(false));
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

  // Spisak uključenih filtera (red „aktivni filteri“). Tip se ne ponavlja — vidi se na čipovima iznad.
  const active: Array<{ key: string; label: string; clear: () => void }> = [
    ...(value.query ? [{ key: "q", label: `“${value.query}”`, clear: () => set({ query: "" }) }] : []),
    ...(value.minScore !== DEFAULT_FILTERS.minScore ? [{ key: "score", label: `Score ${value.minScore ? `${value.minScore}+` : "any"}`, clear: () => set({ minScore: DEFAULT_FILTERS.minScore }) }] : []),
    ...(value.maxAgeHours ? [{ key: "posted", label: labelOf(POSTED, value.maxAgeHours), clear: () => set({ maxAgeHours: 0 }) }] : []),
    ...(value.minBudget ? [{ key: "budget", label: `Budget ${labelOf(BUDGETS, value.minBudget)}`, clear: () => set({ minBudget: 0 }) }] : []),
    ...(value.budgetKnownOnly ? [{ key: "known", label: "Budget stated", clear: () => set({ budgetKnownOnly: false }) }] : []),
    ...[...value.sources].map((src) => ({ key: `src:${src}`, label: src, clear: () => set({ sources: toggle(value.sources, src) }) })),
    ...(value.markets.size !== ALL_MARKETS.length ? [{ key: "market", label: `Market: ${value.markets.size ? MARKETS.filter((m) => value.markets.has(m.key)).map((m) => m.label.replace("🇷🇸 ", "")).join(", ") : "none"}`, clear: () => set({ markets: new Set(ALL_MARKETS) }) }] : []),
    ...(value.status !== "open" ? [{ key: "status", label: `Status: ${short(labelOf(STATUSES, value.status))}`, clear: () => set({ status: "open" }) }] : []),
    ...(value.category !== "all" ? [{ key: "cat", label: CATEGORY_LABEL[value.category as keyof typeof CATEGORY_LABEL] ?? value.category, clear: () => set({ category: "all" }) }] : []),
    ...(value.industry !== "all" ? [{ key: "ind", label: cap(value.industry), clear: () => set({ industry: "all" }) }] : []),
    ...(value.remoteOnly ? [{ key: "remote", label: "Remote-friendly", clear: () => set({ remoteOnly: false }) }] : []),
  ];
  const sameTypes = value.types.size === DEFAULT_TYPES.length && DEFAULT_TYPES.every((t) => value.types.has(t));
  const reset = () => onChange(freshFilters({ sortBy: value.sortBy, sortDir: value.sortDir }));

  // Koliko je filtera iz panela uključeno (oznaka na dugmetu). Na telefonu su u panelu i Score i Posted.
  const panelCount =
    (value.minBudget || value.budgetKnownOnly ? 1 : 0) + (value.sources.size ? 1 : 0) + (value.markets.size !== ALL_MARKETS.length ? 1 : 0) + (value.status !== "open" ? 1 : 0) + (value.category !== "all" ? 1 : 0) + (value.industry !== "all" ? 1 : 0) + (value.remoteOnly ? 1 : 0);
  const quickCount = (value.minScore !== DEFAULT_FILTERS.minScore ? 1 : 0) + (value.maxAgeHours ? 1 : 0);

  return (
    <div className="relative mb-3 rounded-xl border border-line bg-surface" ref={moreRef}>
      {/* Red 1: pretraga + najčešći filteri + „Filters“ (svi ostali) */}
      <div className="flex flex-wrap items-center gap-1.5 p-2">
        <label className="flex h-[34px] min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-line bg-bg px-3 text-faint focus-within:border-accent/55 sm:max-w-[420px] sm:basis-56">
          <Search size={14} className="shrink-0" />
          <input value={value.query} onChange={(e) => set({ query: e.target.value })} placeholder="Search title, company, city…" className="w-full min-w-0 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" aria-label="Search leads" />
          {value.query && (
            <button onClick={() => set({ query: "" })} className="grid size-[22px] shrink-0 place-items-center rounded text-faint hover:text-fg" aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </label>
        <div className="hidden items-center gap-1.5 sm:ml-auto sm:flex">
          <FilterMenu label="Score" value={short(labelOf(SCORES, value.minScore))} active={value.minScore !== DEFAULT_FILTERS.minScore} onClear={() => set({ minScore: DEFAULT_FILTERS.minScore })}>
            {(close) =>
              SCORES.map(([k, l]) => (
                <Option key={k} selected={value.minScore === k} onClick={() => (set({ minScore: k }), close())}>
                  {l}
                </Option>
              ))
            }
          </FilterMenu>
          <FilterMenu label="Posted" value={labelOf(POSTED, value.maxAgeHours)} active={!!value.maxAgeHours} onClear={() => set({ maxAgeHours: 0 })}>
            {(close) =>
              POSTED.map(([k, l]) => (
                <Option key={k} selected={value.maxAgeHours === k} onClick={() => (set({ maxAgeHours: k }), close())}>
                  {l}
                </Option>
              ))
            }
          </FilterMenu>
        </div>
        <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} aria-haspopup="dialog" className={`${toolBtn(panelCount > 0)} flex-1 justify-center sm:flex-none`}>
          <SlidersHorizontal size={13} /> Filters
          {panelCount > 0 && <span className="num hidden size-[16px] place-items-center rounded-full bg-accent text-[11px] font-semibold text-white sm:grid">{panelCount}</span>}
          {panelCount + quickCount > 0 && <span className="num grid size-[16px] place-items-center rounded-full bg-accent text-[11px] font-semibold text-white sm:hidden">{panelCount + quickCount}</span>}
        </button>
        <div className="flex flex-1 sm:hidden">
          <FilterMenu block align="right" label="Sort" value={`${SORTS.find(([k]) => k === value.sortBy)?.[1] ?? "Score"} ${value.sortDir === "desc" ? "↓" : "↑"}`} active={value.sortBy !== "score" || value.sortDir !== "desc"}>
            {(close) => (
              <>
                {SORTS.map(([k, l, dir]) => (
                  <Option key={k} selected={value.sortBy === k} onClick={() => (set({ sortBy: k, sortDir: value.sortBy === k ? (value.sortDir === "desc" ? "asc" : "desc") : dir }), close())}>
                    {l}
                    {value.sortBy === k ? (value.sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </Option>
                ))}
                <div className="px-2 pt-1 text-[11px] text-faint">Tap again to reverse the order</div>
              </>
            )}
          </FilterMenu>
        </div>
      </div>

      {/* Red 2: tip prilike (glavni izbor) i broj rezultata */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-2">
        <span className="hidden items-center gap-1 pl-1 pr-0.5 text-[12px] text-faint sm:inline-flex" title="Vrsta prilike. Oglasi za posao su podrazumevano isključeni — firmi trebaju projekti.">
          Type <Info size={12} />
        </span>
        {LEAD_TYPES.map((t) => (
          <FilterChip key={t} on={value.types.has(t)} onClick={() => set({ types: toggle(value.types, t) })} title={TYPE_META[t].hint} count={typeCounts.get(t) ?? 0}>
            {TYPE_META[t].label}
          </FilterChip>
        ))}
        <span className="ml-auto whitespace-nowrap pl-2 pr-1 text-[13px] text-faint" aria-live="polite">
          <span className="num font-medium text-fg">{shown}</span> of <span className="num">{all.length}</span> leads
        </span>
      </div>

      {/* Red 3 (samo kad nešto odstupa od podrazumevanog): šta je uključeno, × poništava jedan, „Reset“ sve */}
      {(active.length > 0 || !sameTypes) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-1.5">
          {active.map((a) => (
            <button key={a.key} onClick={a.clear} className="inline-flex h-[24px] items-center gap-1 rounded-md bg-accent-soft px-2 text-[12px] text-fg hover:bg-danger/10" title="Remove this filter">
              <span className="max-w-[180px] truncate">{a.label}</span> <X size={11} className="shrink-0 text-faint" />
            </button>
          ))}
          <button onClick={reset} className="ml-auto inline-flex h-[24px] items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg">
            <RotateCcw size={11} /> Reset filters
          </button>
        </div>
      )}

      {/* Panel „Filters“: grupisano, sa nazivima. Računar: preko tabele; telefon: list odozdo. */}
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={() => setMoreOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-label="Filters"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border border-line bg-surface shadow-float sm:absolute sm:inset-x-0 sm:bottom-auto sm:top-full sm:z-30 sm:mt-1.5 sm:max-h-none sm:rounded-xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:hidden">
              <span className="text-[14px] font-semibold">Filters</span>
              <button onClick={() => setMoreOpen(false)} className="grid size-[34px] place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Close filters">
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-x-6 gap-y-4 p-4 max-sm:overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-4">
              <Group label="Score" className="sm:hidden">
                <div className="flex flex-wrap gap-1.5">
                  {SCORES.map(([k, l]) => (
                    <FilterChip key={k} on={value.minScore === k} onClick={() => set({ minScore: k })}>
                      {short(l)}
                    </FilterChip>
                  ))}
                </div>
              </Group>
              <Group label="Posted" className="sm:hidden">
                <div className="flex flex-wrap gap-1.5">
                  {POSTED.map(([k, l]) => (
                    <FilterChip key={k} on={value.maxAgeHours === k} onClick={() => set({ maxAgeHours: k })}>
                      {l.replace("Last ", "")}
                    </FilterChip>
                  ))}
                </div>
              </Group>
              <Group label="Budget">
                <div className="flex flex-wrap gap-1.5">
                  {BUDGETS.map(([k, l]) => (
                    <FilterChip key={k} on={value.minBudget === k} onClick={() => set({ minBudget: k })}>
                      {k ? l : "Any"}
                    </FilterChip>
                  ))}
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] text-muted" title="Sakrij oglase koji ne navode budžet">
                  <input type="checkbox" checked={value.budgetKnownOnly} onChange={(e) => set({ budgetKnownOnly: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                  Only with a stated budget
                </label>
              </Group>
                <Group label="Status">
                  <PanelSelect label="Status" value={value.status} onChange={(v) => set({ status: v })} options={STATUSES} />
                </Group>
                <Group label="Work mode">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
                    <input type="checkbox" checked={value.remoteOnly} onChange={(e) => set({ remoteOnly: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                    Remote-friendly only
                  </label>
                </Group>
              </div>
              <div className="space-y-4">
              <Group label="Market">
                <div className="flex flex-wrap gap-1.5">
                  {MARKETS.map((m) => (
                    <FilterChip key={m.key} on={value.markets.has(m.key)} onClick={() => set({ markets: toggle(value.markets, m.key) })} title={m.hint} count={marketCounts.get(m.key) ?? 0}>
                      {m.label}
                    </FilterChip>
                  ))}
                </div>
                <div className="mt-2 flex gap-3 text-[12px]">
                  <button type="button" onClick={() => set({ markets: new Set(ALL_MARKETS) })} className="text-muted underline-offset-2 hover:text-fg hover:underline">
                    All markets
                  </button>
                  <button type="button" onClick={() => set({ markets: new Set<Market>(["T1", "T2", "DOMESTIC"]) })} className="text-muted underline-offset-2 hover:text-fg hover:underline" title="Tier 1 + Tier 2 + region">
                    Best markets only
                  </button>
                </div>
              </Group>
              <Group label="Service">
                <PanelSelect label="Service" value={value.category} onChange={(v) => set({ category: v })} options={[["all", "All services"], ...SERVICE_CATEGORIES.filter((c) => c !== "not_relevant").map((c) => [c, CATEGORY_LABEL[c]] as const)]} />
              </Group>
              <Group label="Industry">
                <PanelSelect label="Industry" value={value.industry} onChange={(v) => set({ industry: v })} options={[["all", "All industries"], ...INDUSTRIES.map((i) => [i, cap(i)] as const)]} />
              </Group>
              </div>
              <div className="space-y-4">
              <Group label={value.sources.size ? `Source · ${value.sources.size} selected` : "Source"}>
                <div className="rounded-lg border border-line bg-bg">
                  {sources.length > 7 && (
                    <label className="flex h-[34px] items-center gap-1.5 border-b border-line px-2.5 text-faint">
                      <Search size={12} />
                      <input value={sourceQ} onChange={(e) => setSourceQ(e.target.value)} placeholder="Find a source…" className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" aria-label="Find a source" />
                    </label>
                  )}
                  <div className="max-h-[196px] overflow-y-auto p-1">
                    {sources
                      .filter(([s]) => !sourceQ || s.toLowerCase().includes(sourceQ.toLowerCase()))
                      .map(([s, n]) => (
                        <Option key={s} selected={value.sources.has(s)} onClick={() => set({ sources: toggle(value.sources, s) })} count={n}>
                          {s}
                        </Option>
                      ))}
                  </div>
                </div>
              </Group>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-line px-4 py-3">
              <button type="button" onClick={reset} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
                <RotateCcw size={12} /> Reset
              </button>
              <button type="button" onClick={() => setMoreOpen(false)} className="ml-auto inline-flex h-[34px] items-center rounded-lg bg-fg px-3.5 text-[13px] font-medium text-bg hover:opacity-90">
                Show <span className="num mx-1">{shown}</span> leads
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

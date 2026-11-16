import { useMemo, useState } from "react";
import { Bell, Link2, Menu, Plus, Search } from "lucide-react";
import { DEMO_LEADS } from "./data/demo";
import { useApiStatus, useLeads } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { Kpis } from "./components/Kpis";
import { DEFAULT_FILTERS, Filters, type FilterState } from "./components/Filters";
import { LeadsTable } from "./components/LeadsTable";
import { LeadDetail } from "./components/LeadDetail";

export function App() {
  const status = useApiStatus();
  const api = useLeads();
  const [menuOpen, setMenuOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string>();

  // Pravi leadovi iz API-ja; dok ih nema, prikazuju se primeri.
  const allLeads = api.live && api.leads ? api.leads : DEMO_LEADS;
  const leads = useMemo(
    () =>
      allLeads.filter(
        (l) =>
          (l.tier ? filters.tiers.has(l.tier) : filters.tiers.has("T1") || filters.tiers.has("T2")) &&
          l.score >= filters.minScore &&
          (!l.budgetEur || l.budgetEur >= filters.minBudget) &&
          (!filters.remoteOnly || l.remoteOk === true || (l.remoteOk === undefined && /remote|worldwide|eu/i.test(l.remote))),
      ),
    [allLeads, filters],
  );
  const selected = leads.find((l) => l.id === selectedId) ?? leads[0];

  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[232px_1fr]">
      <Sidebar status={status} open={menuOpen} onClose={() => setMenuOpen(false)} leadCount={allLeads.length} />

      <main className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
          <button className="text-muted lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="text-[13px] text-muted">
            <span className="hidden sm:inline">Prospecting / </span>
            <b className="font-medium text-fg">Leads</b>
          </div>
          <div className="ml-auto hidden h-[34px] w-80 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-faint md:flex">
            <Search size={14} /> Search leads, companies, sources…
            <span className="ml-auto rounded border border-line-2 px-1.5 text-[11px] text-muted">⌘K</span>
          </div>
          <button className="ml-auto grid size-[34px] place-items-center rounded-[7px] border border-line bg-surface text-muted hover:bg-surface-2 md:ml-0" aria-label="Notifications">
            <Bell size={15} />
          </button>
          <div className="grid size-[30px] place-items-center rounded-full border border-line-2 bg-gradient-to-br from-zinc-600 to-zinc-800 text-xs font-medium text-white">
            AT
          </div>
        </header>

        <div className="mx-auto max-w-[1480px] px-4 pt-7 pb-10 sm:px-6">
          <div className="mb-5 flex flex-wrap items-end gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
              <p className="mt-0.5 text-[13.5px] text-muted">New opportunities from 5 sources, scored and filtered for your services.</p>
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <button className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
                <Link2 size={14} /> Share view
              </button>
              <button className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-fg px-3 text-[13px] font-medium text-bg hover:opacity-90">
                <Plus size={14} /> Add source
              </button>
            </div>
          </div>

          {!api.live && api.leads !== null && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[12.5px] text-muted">
              <span className="rounded bg-accent px-1.5 py-px text-[11px] font-medium text-white">Preview</span>
              Showing sample data. Live leads appear here as soon as the first sources sync.
            </div>
          )}

          <Kpis leads={allLeads} newToday={api.live ? api.newToday : undefined} />
          <Filters value={filters} onChange={setFilters} shown={leads.length} total={allLeads.length} />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <LeadsTable leads={leads} selectedId={selected?.id} onSelect={setSelectedId} />
            {selected && <LeadDetail lead={selected} />}
          </div>
        </div>
      </main>
    </div>
  );
}

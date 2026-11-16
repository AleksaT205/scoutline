import { useEffect, useMemo, useState } from "react";
import { Bell, BellRing, Menu, Moon, Plus, RefreshCw, Search, Sun } from "lucide-react";
import { DEMO_LEADS } from "./data/demo";
import { useApiStatus, useLeads } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { Kpis } from "./components/Kpis";
import { DEFAULT_FILTERS, Filters, applyFilters, type FilterState } from "./components/Filters";
import { LeadsTable } from "./components/LeadsTable";
import { LeadDetail } from "./components/LeadDetail";
import { AddLeadDialog } from "./components/AddLeadDialog";
import { RouterPage } from "./components/RouterPage";
import { SourcesPage } from "./components/SourcesPage";
import { AlertsDialog } from "./components/AlertsDialog";
import { PipelinePage } from "./components/PipelinePage";

type Theme = "light" | "dark";
const systemTheme = (): Theme => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("theme") as Theme | null) ?? systemTheme();
    } catch {
      return systemTheme();
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* privatni režim — samo ne pamtimo */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export type Page = "leads" | "router" | "sources" | "pipeline";
function useHashPage(): Page {
  const read = (): Page =>
    window.location.hash.startsWith("#/router")
      ? "router"
      : window.location.hash.startsWith("#/sources")
        ? "sources"
        : window.location.hash.startsWith("#/pipeline")
          ? "pipeline"
          : "leads";
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const on = () => {
      setPage(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return page;
}

export function App() {
  const page = useHashPage();
  const [theme, toggleTheme] = useTheme();
  const status = useApiStatus();
  const api = useLeads();
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 30_000); // osveži "Updated X ago"
    return () => clearInterval(id);
  }, []);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string>();

  // Pravi leadovi iz API-ja; dok ih nema, prikazuju se primeri.
  const allLeads = api.live && api.leads ? api.leads : DEMO_LEADS;
  const leads = useMemo(() => applyFilters(allLeads, filters), [allLeads, filters]);
  const selected = leads.find((l) => l.id === selectedId) ?? leads[0];

  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[232px_1fr]">
      <Sidebar status={status} open={menuOpen} onClose={() => setMenuOpen(false)} leadCount={api.live ? (api.total ?? allLeads.length) : allLeads.length} aiCostUsd={api.aiCostUsd} page={page} />

      <main className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
          <button className="text-muted lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="text-[13px] text-muted">
            <span className="hidden sm:inline">{page === "router" ? "AI Ops / " : "Prospecting / "}</span>
            <b className="font-medium text-fg">{page === "router" ? "AI Router" : page === "sources" ? "Sources" : page === "pipeline" ? "Pipeline" : "Leads"}</b>
          </div>
          <label className={`ml-auto h-[34px] w-80 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-faint focus-within:border-accent/55 ${page === "leads" ? "hidden md:flex" : "hidden"}`}>
            <Search size={14} />
            <input
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder="Search leads, companies, locations…"
              className="w-full bg-transparent text-fg placeholder:text-faint outline-none"
            />
          </label>
          <button
            onClick={toggleTheme}
            className={`ml-auto grid size-[34px] place-items-center rounded-[7px] border border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg ${page === "leads" ? "md:ml-0" : ""}`}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button className="grid size-[34px] place-items-center rounded-[7px] border border-line bg-surface text-muted hover:bg-surface-2" aria-label="Notifications">
            <Bell size={15} />
          </button>
          <div className="grid size-[30px] place-items-center rounded-full border border-line-2 bg-gradient-to-br from-zinc-600 to-zinc-800 text-xs font-medium text-white">
            AT
          </div>
        </header>

        <div className="mx-auto max-w-[1480px] px-4 pt-7 pb-10 sm:px-6">
          {page === "router" ? (
            <RouterPage />
          ) : page === "sources" ? (
            <SourcesPage />
          ) : page === "pipeline" ? (
            <PipelinePage
              leads={allLeads}
              live={api.live}
              onUpdated={api.update}
              onOpenLead={(id) => {
                setFilters({ ...DEFAULT_FILTERS, markets: new Set(DEFAULT_FILTERS.markets), minScore: 0, status: "all" });
                setSelectedId(id);
                window.location.hash = "#/";
              }}
            />
          ) : (
          <>
          <div className="mb-5 flex flex-wrap items-end gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
              <p className="mt-0.5 text-[13.5px] text-muted">New opportunities from 7 sources, scored and filtered for your services.</p>
              {api.live && api.loadedAt && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-faint">
                  Updated {Math.max(0, Math.round((Date.now() - api.loadedAt) / 60_000)) || "<1"} min ago · refreshes every minute · sources sync every 30–60 min
                  <button onClick={api.reload} className="inline-flex items-center gap-1 text-muted hover:text-fg" aria-label="Refresh now">
                    <RefreshCw size={11} /> Refresh
                  </button>
                </p>
              )}
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <button
                onClick={() => setAlertsOpen(true)}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
              >
                <BellRing size={14} /> Telegram alerts
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-fg px-3 text-[13px] font-medium text-bg hover:opacity-90"
              >
                <Plus size={14} /> Add lead
              </button>
            </div>
          </div>

          {!api.live && api.leads !== null && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[12.5px] text-muted">
              <span className="rounded bg-accent px-1.5 py-px text-[11px] font-medium text-white">Preview</span>
              Showing sample data. Live leads appear here as soon as the first sources sync.
            </div>
          )}

          <Kpis leads={allLeads} />
          <Filters value={filters} onChange={setFilters} all={allLeads} shown={leads.length} />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <LeadsTable leads={leads} selectedId={selected?.id} onSelect={setSelectedId} />
            {selected && <LeadDetail lead={selected} live={api.live} onUpdated={api.update} />}
          </div>
          </>
          )}
        </div>
      </main>
      <AlertsDialog open={alertsOpen} onClose={() => setAlertsOpen(false)} />
      <AddLeadDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(lead) => {
          api.add(lead);
          setFilters({ ...DEFAULT_FILTERS, markets: new Set(DEFAULT_FILTERS.markets), minScore: 0 });
          setSelectedId(lead.id);
        }}
      />
    </div>
  );
}

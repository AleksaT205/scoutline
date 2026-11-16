import { useEffect, useMemo, useState } from "react";
import { Bell, BellRing, Menu, Moon, Plus, RefreshCw, Search, Sun } from "lucide-react";
import { DEMO_LEADS } from "./data/demo";
import { useApiStatus, useLeads } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { Kpis } from "./components/Kpis";
import { LEAD_TYPES } from "@radar/shared";
import { Filters, applyFilters, freshFilters, type FilterState } from "./components/Filters";
import { LeadsTable } from "./components/LeadsTable";
import { LeadDetail } from "./components/LeadDetail";
import { AddLeadDialog } from "./components/AddLeadDialog";
import { RouterPage } from "./components/RouterPage";
import { SourcesPage } from "./components/SourcesPage";
import { AlertsDialog } from "./components/AlertsDialog";
import { PipelinePage } from "./components/PipelinePage";
import { OverviewPage } from "./components/OverviewPage";
import { SettingsPage } from "./components/SettingsPage";
import { TasksPage } from "./components/TasksPage";
import { ClientsPage, MyIssuesPage, ProjectPage, ProjectsPage } from "./components/delivery/pages";
import { SharePage } from "./components/SharePage";
import { AcceptInvitePage, LoginPage, SetupPage } from "./components/AuthPages";
import { clearSession, useSessionUser } from "./lib/session";
import { API_URL } from "./lib/api";

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

export type Page = "leads" | "router" | "sources" | "pipeline" | "overview" | "settings" | "team" | "tasks" | "issues" | "projects" | "project" | "clients";
const PAGES: Page[] = ["router", "sources", "pipeline", "overview", "settings", "team", "tasks"];
const readHash = () => window.location.hash;
function useHash(): string {
  const [hash, setHash] = useState(readHash);
  useEffect(() => {
    const on = () => {
      setHash(readHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}
const pageOf = (hash: string): Page => {
  // Delivery (Faza 10)
  if (hash.startsWith("#/delivery/projects/")) return "project";
  if (hash.startsWith("#/delivery/clients")) return "clients";
  if (hash.startsWith("#/delivery/issues")) return "issues";
  if (hash.startsWith("#/delivery")) return "projects";
  return PAGES.find((p) => hash.startsWith(`#/${p}`)) ?? "leads";
};

/** Ulaz u aplikaciju: javni linkovi (deljeni pregled, pozivnica), prijava, pa dashboard. */
export function App() {
  const hash = useHash();
  const user = useSessionUser();
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`${API_URL}/auth/state`)
      .then((r) => (r.ok ? r.json() : { hasUsers: false }))
      .then((d: { hasUsers: boolean }) => setHasUsers(d.hasUsers))
      .catch(() => setHasUsers(false));
  }, [user]);

  if (hash.startsWith("#/share/")) return <SharePage token={hash.slice("#/share/".length)} />;
  if (hash.startsWith("#/invite/")) return <AcceptInvitePage token={hash.slice("#/invite/".length)} onDone={() => (window.location.hash = "#/")} />;
  if (hash.startsWith("#/setup")) return <SetupPage onDone={() => (window.location.hash = "#/")} />;
  if (hasUsers && !user?.id) return <LoginPage />;
  return <Dashboard page={pageOf(hash)} projectId={hash.startsWith("#/delivery/projects/") ? hash.slice("#/delivery/projects/".length).split(/[?/]/)[0] : undefined} needsSetup={hasUsers === false} />;
}

function Dashboard({ page, projectId, needsSetup }: { page: Page; projectId?: string; needsSetup: boolean }) {
  const user = useSessionUser();
  const [userMenu, setUserMenu] = useState(false);
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
  const [filters, setFilters] = useState<FilterState>(() => freshFilters());
  const [selectedId, setSelectedId] = useState<string>();

  // Pravi leadovi iz API-ja; dok ih nema, prikazuju se primeri.
  const allLeads = api.live && api.leads ? api.leads : DEMO_LEADS;
  const leads = useMemo(() => applyFilters(allLeads, filters), [allLeads, filters]);
  // Izabrani lead ostaje otvoren i kad ga filter više ne prikazuje (npr. posle „Won“ — da se vidi „Create project“)
  const selected = leads.find((l) => l.id === selectedId) ?? allLeads.find((l) => l.id === selectedId) ?? leads[0];

  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[232px_1fr]">
      <Sidebar status={status} open={menuOpen} onClose={() => setMenuOpen(false)} leadCount={api.live ? (api.total ?? allLeads.length) : allLeads.length} aiCostUsd={api.aiCostUsd} page={page} />

      <main className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
          <button className="text-muted lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="text-[13px] text-muted">
            <span className="hidden sm:inline">
              {page === "router" ? "AI Ops / " : page === "settings" || page === "team" || page === "tasks" ? "Workspace / " : ["issues", "projects", "project", "clients"].includes(page) ? "Delivery / " : "Prospecting / "}
            </span>
            <b className="font-medium text-fg">
              {{ router: "AI Router", sources: "Sources", pipeline: "Pipeline", overview: "Overview", settings: "Settings", team: "Team", tasks: "Tasks", leads: "Leads", issues: "My issues", projects: "Projects", project: "Project", clients: "Clients" }[page]}
            </b>
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
          <div className="relative">
            <button
              onClick={() => setUserMenu((v) => !v)}
              className="grid size-[30px] place-items-center rounded-full border border-line-2 bg-gradient-to-br from-zinc-600 to-zinc-800 text-xs font-medium text-white"
              aria-label="Account menu"
            >
              {(user?.name ?? "Team").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </button>
            {userMenu && (
              <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-float" onMouseLeave={() => setUserMenu(false)}>
                <div className="px-2.5 py-2">
                  <div className="text-[13px] font-medium">{user?.name ?? "Team password"}</div>
                  <div className="truncate text-[12px] text-muted">{user ? `${user.email} · ${user.role}` : "Not signed in"}</div>
                </div>
                <a href="#/settings" onClick={() => setUserMenu(false)} className="block rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
                  Settings
                </a>
                {user && (
                  <button
                    onClick={() => {
                      clearSession();
                      setUserMenu(false);
                      window.location.hash = "#/";
                    }}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-fg"
                  >
                    Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="mx-auto max-w-[1480px] px-4 pt-7 pb-10 sm:px-6">
          {needsSetup && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[12.5px] text-muted">
              <span className="rounded bg-accent px-1.5 py-px text-[11px] font-medium text-white">Setup</span>
              Create the owner account so your team can sign in with their own email and password.
              <a href="#/setup" className="font-medium text-accent">Create account →</a>
            </div>
          )}
          {page === "projects" ? (
            <ProjectsPage />
          ) : page === "project" && projectId ? (
            <ProjectPage key={projectId} id={projectId} />
          ) : page === "issues" ? (
            <MyIssuesPage />
          ) : page === "clients" ? (
            <ClientsPage />
          ) : page === "tasks" ? (
            <TasksPage />
          ) : page === "settings" || page === "team" ? (
            <SettingsPage initialTab={page === "team" ? "team" : "profile"} onOpenAlerts={() => setAlertsOpen(true)} />
          ) : page === "router" ? (
            <RouterPage />
          ) : page === "overview" ? (
            <OverviewPage />
          ) : page === "sources" ? (
            <SourcesPage />
          ) : page === "pipeline" ? (
            <PipelinePage
              leads={allLeads}
              live={api.live}
              onUpdated={api.update}
              onOpenLead={(id) => {
                setFilters(freshFilters({ types: new Set(LEAD_TYPES), minScore: 0, status: "all" }));
                setSelectedId(id);
                window.location.hash = "#/";
              }}
            />
          ) : (
          <>
          <div className="mb-5 flex flex-wrap items-end gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
              <p className="mt-0.5 text-[13.5px] text-muted">Projects for the team — public tenders, marketplace projects, email alerts and growth signals, scored for your services.</p>
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
          setFilters(freshFilters({ types: new Set(LEAD_TYPES), minScore: 0 }));
          setSelectedId(lead.id);
        }}
      />
    </div>
  );
}

import { Suspense, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useDismiss } from "./lib/useDismiss";
import { AssistantPage, ClientsPage, CyclesPage, InboxPage, MyIssuesPage, OverviewPage, PipelinePage, ProjectPage, ProjectsPage, ReportsPage, RouterPage, SettingsPage, SourcesPage, TasksPage, warmUp } from "./pages";
import { BellRing, Menu, Moon, Plus, RefreshCw, Search, Sun } from "lucide-react";
import { useApiStatus, useLeads } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { Kpis } from "./components/Kpis";
import { LEAD_TYPES } from "@radar/shared";
import { Filters, applyFilters, freshFilters, type FilterState } from "./components/Filters";
import { LeadsTable } from "./components/LeadsTable";
import { LeadDetail } from "./components/LeadDetail";
import { AddLeadDialog } from "./components/AddLeadDialog";
import { AlertsDialog } from "./components/AlertsDialog";
import { PortalPage } from "./components/PortalPage";
import { NotificationsBell } from "./components/NotificationsBell";
import { SharePage } from "./components/SharePage";
import { AcceptInvitePage, LoginPage, SetupPage } from "./components/AuthPages";
import { clearSession, getSessionToken, onlySpace, setSession, useSessionUser, type SessionUser } from "./lib/session";
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

export type Page = "leads" | "router" | "sources" | "pipeline" | "overview" | "settings" | "team" | "tasks" | "issues" | "projects" | "project" | "clients" | "inbox" | "cycles" | "reports" | "assistant";
const PAGES: Page[] = ["router", "sources", "pipeline", "overview", "settings", "team", "tasks"];
const readHash = () => window.location.hash;
function useHash(): string {
  const [hash, setHash] = useState(readHash);
  useEffect(() => {
    // Prelaz kao „transition“: stara stranica ostaje na ekranu dok nova nije spremna (bez treptanja skeletona)
    const on = () => startTransition(() => setHash(readHash()));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [hash]);
  return hash;
}
const pageOf = (hash: string): Page => {
  // Delivery (Faza 10)
  if (hash.startsWith("#/delivery/projects/")) return "project";
  if (hash.startsWith("#/delivery/clients")) return "clients";
  if (hash.startsWith("#/delivery/issues")) return "issues";
  if (hash.startsWith("#/delivery/inbox")) return "inbox";
  if (hash.startsWith("#/delivery/cycles")) return "cycles";
  if (hash.startsWith("#/delivery/reports")) return "reports";
  if (hash.startsWith("#/delivery/assistant")) return "assistant";
  if (hash.startsWith("#/delivery")) return "projects";
  return PAGES.find((p) => hash.startsWith(`#/${p}`)) ?? "leads";
};

/** Dok se deo stranice učitava (retko — delovi se skidaju unapred). */
function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded-md bg-surface-2" />
      <div className="h-4 w-80 max-w-full rounded bg-surface-2" />
      <div className="grid gap-3 pt-2 sm:grid-cols-3">
        <div className="h-24 rounded-xl bg-surface-2" />
        <div className="h-24 rounded-xl bg-surface-2" />
        <div className="h-24 rounded-xl bg-surface-2" />
      </div>
      <div className="h-64 rounded-xl bg-surface-2" />
    </div>
  );
}

/** Ulaz u aplikaciju: javni linkovi (deljeni pregled, pozivnica), prijava, pa dashboard. */
export function App() {
  const hash = useHash();
  const user = useSessionUser();
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  // Osveži podatke o nalogu (uloga, pristup) sa servera
  useEffect(() => {
    const token = getSessionToken();
    if (!token) return;
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: SessionUser } | null) => {
        const cur = user;
        if (d?.user && (d.user.access !== cur?.access || d.user.role !== cur?.role || d.user.name !== cur?.name)) setSession(token, d.user);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    fetch(`${API_URL}/auth/state`)
      .then((r) => (r.ok ? r.json() : { hasUsers: false }))
      .then((d: { hasUsers: boolean }) => setHasUsers(d.hasUsers))
      .catch(() => setHasUsers(false));
  }, [user]);

  if (hash.startsWith("#/share/")) return <SharePage token={hash.slice("#/share/".length)} />;
  if (hash.startsWith("#/portal/")) return <PortalPage token={hash.slice("#/portal/".length)} />;
  if (hash.startsWith("#/invite/")) return <AcceptInvitePage token={hash.slice("#/invite/".length)} onDone={() => (window.location.hash = "#/")} />;
  if (hash.startsWith("#/setup")) return <SetupPage onDone={() => (window.location.hash = "#/")} />;
  if (hasUsers && !user?.id) return <LoginPage />;
  // Korisnik sa pristupom samo jednom delu aplikacije ide tamo
  const only = onlySpace(user);
  const delivery = ["issues", "projects", "project", "clients", "inbox", "cycles", "reports", "assistant"].includes(pageOf(hash));
  const salesOnlyPage = ["leads", "pipeline", "sources", "overview", "router"].includes(pageOf(hash));
  if (only === "delivery" && salesOnlyPage) {
    window.location.hash = "#/delivery/issues";
    return null;
  }
  if (only === "sales" && delivery) {
    window.location.hash = "#/";
    return null;
  }
  return <Dashboard page={pageOf(hash)} projectId={hash.startsWith("#/delivery/projects/") ? hash.slice("#/delivery/projects/".length).split(/[?/]/)[0] : undefined} needsSetup={hasUsers === false} />;
}

function Dashboard({ page, projectId, needsSetup }: { page: Page; projectId?: string; needsSetup: boolean }) {
  const user = useSessionUser();
  const [userMenu, setUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useDismiss(userMenuRef, userMenu, () => setUserMenu(false));
  const [theme, toggleTheme] = useTheme();
  const status = useApiStatus();
  const space = onlySpace(user);
  const api = useLeads(space !== "delivery");
  // Posle prvog prikaza: u pozadini skini ostale stranice i njihove podatke
  useEffect(() => {
    warmUp(space);
  }, [space]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // „Add lead“ sa bilo koje stranice (npr. Sources) otvara prozor na mestu
  useEffect(() => {
    const open = () => setAddOpen(true);
    window.addEventListener("open-add-lead", open);
    return () => window.removeEventListener("open-add-lead", open);
  }, []);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 30_000); // osveži "Updated X ago"
    return () => clearInterval(id);
  }, []);
  const [filters, setFilters] = useState<FilterState>(() => freshFilters());
  const [selectedId, setSelectedId] = useState<string>();
  const [sheet, setSheet] = useState(false); // detalj leada na telefonu

  // Pravi leadovi iz API-ja; dok ih nema, prikazuju se primeri.
  // Bez probnih podataka: dok se učitava prikazuje se skeleton, a ne lažni brojevi
  const loading = api.leads === null;
  const allLeads = useMemo(() => api.leads ?? [], [api.leads]);
  // Kucanje u pretrazi ostaje glatko: lista se preračuna odmah posle, bez kočenja unosa
  const deferredFilters = useDeferredValue(filters);
  const leads = useMemo(() => applyFilters(allLeads, deferredFilters), [allLeads, deferredFilters]);
  const PAGE_SIZE = 50;
  const [pageNo, setPage] = useState(0);
  useEffect(() => setPage(0), [filters]); // novi filter/sort → prva strana
  const pages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  const pageLeads = useMemo(() => leads.slice(Math.min(pageNo, pages - 1) * PAGE_SIZE, (Math.min(pageNo, pages - 1) + 1) * PAGE_SIZE), [leads, pageNo, pages]);
  // Izabrani lead ostaje otvoren i kad ga filter više ne prikazuje (npr. posle „Won“ — da se vidi „Create project“)
  const selected = leads.find((l) => l.id === selectedId) ?? allLeads.find((l) => l.id === selectedId) ?? pageLeads[0];

  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[232px_1fr]">
      <Sidebar status={status} open={menuOpen} onClose={() => setMenuOpen(false)} leadCount={loading ? undefined : (api.total ?? allLeads.length)} aiCostUsd={api.aiCostUsd} page={page} />

      <main className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
          <button className="text-muted lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="text-[13px] text-muted">
            <span className="hidden sm:inline">
              {page === "router" ? "AI Ops / " : page === "settings" || page === "team" || page === "tasks" ? "Workspace / " : ["issues", "projects", "project", "clients", "inbox", "cycles", "reports", "assistant"].includes(page) ? "Delivery / " : "Prospecting / "}
            </span>
            <b className="font-medium text-fg">
              {{ router: "AI Router", sources: "Sources", pipeline: "Pipeline", overview: "Overview", settings: "Settings", team: "Team", tasks: "Feedback", leads: "Leads", issues: "My tasks", projects: "Projects", project: "Project", clients: "Clients", inbox: "Inbox", cycles: "Cycles", reports: "Reports", assistant: "Assistant" }[page]}
            </b>
          </div>
          <label className="hidden">
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
            className="ml-auto grid size-[34px] place-items-center rounded-[7px] border border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <NotificationsBell />
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenu((v) => !v)}
              aria-expanded={userMenu}
              className="grid size-[30px] place-items-center rounded-full border border-line-2 bg-gradient-to-br from-zinc-600 to-zinc-800 text-xs font-medium text-white"
              aria-label="Account menu"
            >
              {(user?.name ?? "Team").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </button>
            {userMenu && (
              <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-float">
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
          <Suspense fallback={<PageSkeleton />}>
          {page === "projects" ? (
            <ProjectsPage />
          ) : page === "project" && projectId ? (
            <ProjectPage key={projectId} id={projectId} />
          ) : page === "issues" ? (
            <MyIssuesPage />
          ) : page === "clients" ? (
            <ClientsPage />
          ) : page === "inbox" ? (
            <InboxPage />
          ) : page === "cycles" ? (
            <CyclesPage />
          ) : page === "reports" ? (
            !user || user.role === "owner" ? (
              <ReportsPage />
            ) : (
              <div className="rounded-xl border border-line bg-surface px-6 py-14 text-center">
                <div className="text-[15px] font-medium">Reports are for the workspace owner</div>
                <p className="mt-1 text-[13px] text-muted">Margins, costs and rates are visible only to the owner.</p>
              </div>
            )
          ) : page === "assistant" ? (
            <AssistantPage />
          ) : page === "tasks" ? (
            <TasksPage />
          ) : page === "settings" || page === "team" ? (
            <SettingsPage initialTab={page === "team" ? "team" : window.location.hash.startsWith("#/settings/integrations") ? "integrations" : "profile"} onOpenAlerts={() => setAlertsOpen(true)} />
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

          {!loading && allLeads.length === 0 && (
            <div className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">
              {api.live ? "No leads yet — sources sync every 30–60 minutes (or use Sources → Run now)." : "Can't reach the server right now — retrying automatically."}
            </div>
          )}

          <Kpis leads={allLeads} loading={loading} />
          <Filters value={filters} onChange={setFilters} all={allLeads} shown={leads.length} />

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0">
            <LeadsTable
              leads={pageLeads}
              loading={loading}
              sort={{ by: filters.sortBy, dir: filters.sortDir }}
              onSort={(k) => setFilters({ ...filters, sortBy: k, sortDir: filters.sortBy === k ? (filters.sortDir === "desc" ? "asc" : "desc") : k === "source" ? "asc" : "desc" })}
              selectedId={selected?.id}
              onSelect={(id) => {
                setSelectedId(id);
                setSheet(true);
              }}
            />
            {!loading && leads.length > PAGE_SIZE && (
              <nav className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted" aria-label="Pagination">
                <span className="num">
                  {Math.min(pageNo, pages - 1) * PAGE_SIZE + 1}–{Math.min(leads.length, (Math.min(pageNo, pages - 1) + 1) * PAGE_SIZE)} of {leads.length}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button disabled={pageNo === 0} onClick={() => (setPage((p) => Math.max(0, p - 1)), window.scrollTo({ top: 0, behavior: "smooth" }))} className="h-[30px] rounded-md border border-line bg-surface px-2.5 hover:bg-surface-2 disabled:opacity-40">
                    ← Prev
                  </button>
                  {Array.from({ length: pages }, (_, i) => i)
                    .filter((i) => i === 0 || i === pages - 1 || Math.abs(i - pageNo) <= 1)
                    .map((i, k, arr) => (
                      <span key={i} className="flex items-center gap-1">
                        {k > 0 && i - arr[k - 1]! > 1 && <span className="px-1 text-faint">…</span>}
                        <button onClick={() => (setPage(i), window.scrollTo({ top: 0, behavior: "smooth" }))} className={`num h-[30px] min-w-[30px] rounded-md px-2 ${i === pageNo ? "bg-fg font-medium text-bg" : "border border-line bg-surface hover:bg-surface-2"}`} aria-current={i === pageNo ? "page" : undefined}>
                          {i + 1}
                        </button>
                      </span>
                    ))}
                  <button disabled={pageNo >= pages - 1} onClick={() => (setPage((p) => Math.min(pages - 1, p + 1)), window.scrollTo({ top: 0, behavior: "smooth" }))} className="h-[30px] rounded-md border border-line bg-surface px-2.5 hover:bg-surface-2 disabled:opacity-40">
                    Next →
                  </button>
                </div>
              </nav>
            )}
            </div>
            {selected && (
              <div className="hidden xl:block">
                <LeadDetail lead={selected} live={api.live} onUpdated={api.update} />
              </div>
            )}
          </div>
          {/* Telefon / tablet: detalj leada kao panel preko ekrana */}
          {selected && sheet && (
            <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] xl:hidden" onClick={() => setSheet(false)}>
              <div className="absolute inset-x-0 bottom-0 top-10 overflow-y-auto rounded-t-2xl border-t border-line bg-bg px-3 pb-8 pt-2 sm:inset-x-auto sm:right-0 sm:top-0 sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 -mx-3 mb-2 flex items-center bg-bg/90 px-3 py-2 backdrop-blur">
                  <span className="mx-auto h-1 w-10 rounded-full bg-line-2 sm:hidden" />
                  <button onClick={() => setSheet(false)} className="absolute right-3 rounded-md px-2 py-1 text-[13px] text-muted hover:text-fg">
                    Close
                  </button>
                </div>
                <LeadDetail lead={selected} live={api.live} onUpdated={api.update} />
              </div>
            </div>
          )}
          </>
          )}
          </Suspense>
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
          setPage(0);
          if (page !== "leads") setSheet(true); // na drugoj stranici: ostani tu, lead se vidi na Leads
        }}
      />
    </div>
  );
}

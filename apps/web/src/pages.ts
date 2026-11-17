import { lazy } from "react";
import { prefetch } from "./lib/cache";

/**
 * Stranice se učitavaju u delovima (manji početni JS → brže otvaranje, naročito na telefonu).
 * Svaki deo se unapred skine: pri hover-u/dodiru na meni i kad aplikacija miruje posle učitavanja,
 * pa je prelazak na stranicu odmah, bez čekanja.
 */
const loaders = {
  delivery: () => import("./components/delivery/pages"),
  more: () => import("./components/delivery/more"),
  reports: () => import("./components/delivery/reports"),
  assistant: () => import("./components/delivery/assistant"),
  overview: () => import("./components/OverviewPage"),
  sources: () => import("./components/SourcesPage"),
  pipeline: () => import("./components/PipelinePage"),
  settings: () => import("./components/SettingsPage"),
  tasks: () => import("./components/TasksPage"),
  router: () => import("./components/RouterPage"),
};
type Loader = keyof typeof loaders;

export const ProjectsPage = lazy(() => loaders.delivery().then((m) => ({ default: m.ProjectsPage })));
export const ProjectPage = lazy(() => loaders.delivery().then((m) => ({ default: m.ProjectPage })));
export const MyIssuesPage = lazy(() => loaders.delivery().then((m) => ({ default: m.MyIssuesPage })));
export const ClientsPage = lazy(() => loaders.delivery().then((m) => ({ default: m.ClientsPage })));
export const InboxPage = lazy(() => loaders.more().then((m) => ({ default: m.InboxPage })));
export const CyclesPage = lazy(() => loaders.more().then((m) => ({ default: m.CyclesPage })));
export const ReportsPage = lazy(() => loaders.reports().then((m) => ({ default: m.ReportsPage })));
export const AssistantPage = lazy(() => loaders.assistant().then((m) => ({ default: m.AssistantPage })));
export const OverviewPage = lazy(() => loaders.overview().then((m) => ({ default: m.OverviewPage })));
export const SourcesPage = lazy(() => loaders.sources().then((m) => ({ default: m.SourcesPage })));
export const PipelinePage = lazy(() => loaders.pipeline().then((m) => ({ default: m.PipelinePage })));
export const SettingsPage = lazy(() => loaders.settings().then((m) => ({ default: m.SettingsPage })));
export const TasksPage = lazy(() => loaders.tasks().then((m) => ({ default: m.TasksPage })));
export const RouterPage = lazy(() => loaders.router().then((m) => ({ default: m.RouterPage })));

/** Šta treba svakoj stranici: deo koda + podaci (ključevi iz keša). */
const ROUTES: Array<[prefix: string, chunk: Loader | null, data: string[]]> = [
  ["#/delivery/issues", "delivery", ["/delivery/issues?assignee=me&scope=open", "/delivery/projects"]],
  ["#/delivery/inbox", "more", ["/delivery/issues?status=triage"]],
  ["#/delivery/cycles", "more", ["/delivery/cycles", "/delivery/issues?cycle=current"]],
  ["#/delivery/clients", "delivery", ["/delivery/customers"]],
  ["#/delivery/reports", "reports", []],
  ["#/delivery/assistant", "assistant", ["/delivery/projects"]],
  ["#/delivery", "delivery", ["/delivery/projects"]],
  ["#/overview", "overview", ["/analytics?days=30"]],
  ["#/sources", "sources", ["/sources"]],
  ["#/pipeline", "pipeline", []],
  ["#/settings", "settings", []],
  ["#/team", "settings", []],
  ["#/tasks", "tasks", []],
  ["#/router", "router", []],
];

/** Unapred učitaj kod i podatke za link (hover, fokus, dodir). */
export function prefetchHref(href: string) {
  const r = ROUTES.find(([p]) => href.startsWith(p));
  if (!r) return;
  if (r[1]) void loaders[r[1]]().catch(() => undefined);
  r[2].forEach((k) => prefetch(k));
}

const idle = (fn: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1200));

/** Posle prvog prikaza, u mirovanju: skini kod svih stranica i podatke za glavne stranice prostora. */
export function warmUp(space: "sales" | "delivery" | null) {
  idle(() => {
    (Object.keys(loaders) as Loader[]).forEach((k, i) => setTimeout(() => void loaders[k]().catch(() => undefined), i * 150));
    const sales = ["/sources", "/analytics?days=30"];
    const delivery = ["/delivery/projects", "/delivery/issues?assignee=me&scope=open", "/delivery/issues?status=triage"];
    const keys = space === "sales" ? sales : space === "delivery" ? delivery : [...sales, ...delivery];
    keys.forEach((k, i) => setTimeout(() => prefetch(k, 60_000), 600 + i * 250));
  });
}

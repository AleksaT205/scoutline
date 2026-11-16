import { useCallback, useEffect, useState } from "react";
import type { IssueStatus, ProjectStatus } from "@radar/shared";
import { teamFetch } from "./team";

/** Delivery (Faza 10): tipovi i učitavanje podataka. */
export interface Member {
  id: string;
  name: string;
  email: string;
}

export interface Customer {
  id: string;
  name: string;
  website: string | null;
  country: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  leadId: string | null;
  projects: number;
  activeProjects: number;
  valueEur: number;
  createdAt: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  customerId: string | null;
  customerName: string | null;
  leadId: string | null;
  status: ProjectStatus;
  budgetEur: number | null;
  startDate: string | null;
  dueDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
  repoUrl: string | null;
  githubImport: boolean;
  billing: "fixed" | "hourly";
  hourlyRateEur: number | null;
  issues: { total: number; done: number; inProgress: number; todo: number };
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  key: string; // ACME-12
  number: number;
  projectId: string;
  projectKey: string;
  projectName: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: number;
  assigneeId: string | null;
  assigneeName: string | null;
  estimate: number | null;
  labels: string[];
  dueDate: string | null;
  sortOrder: number;
  cycleId: string | null;
  agent: "claude" | "codex" | null;
  createdBy: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Cycle {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  state: "past" | "current" | "upcoming";
  scope: number;
  done: number;
  started: number;
  points: number;
  pointsDone: number;
}

export interface IssueLink {
  id: string;
  kind: "gh_issue" | "pr";
  repo: string;
  number: number;
  url: string;
  title: string | null;
  state: string | null;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  issueId: string | null;
  userId: string | null;
  userName: string;
  minutes: number;
  spentOn: string;
  note: string | null;
  billable: boolean;
}

export interface IssueEvent {
  id: string;
  type: string;
  data: Record<string, unknown> | null;
  actor: string | null;
  createdAt: string;
}

/** Jednostavno učitavanje sa ponovnim pokušajem i lokalnim izmenama (optimistično). */
function useResource<T>(path: string | null, pick: (d: unknown) => T) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(pick(await teamFetch(path)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  return { data, setData, error, reload };
}

export const useProjects = () => useResource<Project[]>("/delivery/projects", (d) => (d as { projects: Project[] }).projects);
export const useProject = (id: string) => useResource<Project>(`/delivery/projects/${id}`, (d) => (d as { project: Project }).project);
export const useCustomers = () => useResource<Customer[]>("/delivery/customers", (d) => (d as { customers: Customer[] }).customers);
export const useCycles = () => useResource<{ cycles: Cycle[]; burn: Array<{ day: string; done: number }> }>("/delivery/cycles", (d) => d as { cycles: Cycle[]; burn: Array<{ day: string; done: number }> });
export const cycleLabel = (c: Pick<Cycle, "number" | "name">) => c.name ?? `Cycle ${c.number}`;

/** Broj zahteva u Inboxu (za meni); osvežava se na minut. */
export function useInboxCount(enabled: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => teamFetch<{ count: number }>("/delivery/inbox/count").then((d) => alive && setN(d.count)).catch(() => undefined);
    void load();
    const id = setInterval(load, 60_000);
    window.addEventListener("inbox-changed", load);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("inbox-changed", load);
    };
  }, [enabled]);
  return n;
}
export const inboxChanged = () => window.dispatchEvent(new Event("inbox-changed"));

export const useIssues = (query: string) => useResource<Issue[]>(`/delivery/issues?${query}`, (d) => (d as { issues: Issue[] }).issues);

let membersCache: Member[] | null = null;
export function useMembers(): Member[] {
  const [members, setMembers] = useState<Member[]>(membersCache ?? []);
  useEffect(() => {
    if (membersCache) return;
    teamFetch<{ members: Member[] }>("/delivery/members")
      .then((d) => {
        membersCache = d.members;
        setMembers(d.members);
      })
      .catch(() => undefined);
  }, []);
  return members;
}

export const patchIssue = (id: string, body: Partial<Issue>) =>
  teamFetch<{ issue: Issue }>(`/delivery/issues/${id}`, { method: "PATCH", body: JSON.stringify(body) }).then((d) => d.issue);

export const fmtEur = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `€${(v / 1000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : `€${v}`);
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");
export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
export const initials = (name: string | null | undefined) =>
  (name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Da li korisnik kuca u polje (prečice sa tastature se tada ne aktiviraju). */
export const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};

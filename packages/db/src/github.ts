import { and, eq, sql } from "drizzle-orm";
import { parseRepo, type IssueStatus } from "@radar/shared";
import { issueEvents, issueLinks, issues, projectRepos, projects, users } from "./schema.js";
import type { Db } from "./index.js";
import type { UserIntegrations } from "./integrations.js";

/**
 * Faza 14 — GitHub kao izvor istine: zajednička logika za API (upis na GitHub) i worker (čitanje sa GitHub-a).
 * Dvosmerna sinhronizacija issue-a za projekte sa uključenim „githubSync“.
 */
export async function ghFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "scoutline",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

export async function ghJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await ghFetch(token, path, init);
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`GitHub ${path.split("?")[0]}: ${data.message ?? `HTTP ${res.status}`}`);
  return data;
}

/** Svi repoi projekta („owner/name“): glavni + dodatni. */
export async function projectRepoNames(db: Db, p: { id: string; repoUrl: string | null }): Promise<string[]> {
  const extra = await db.select({ url: projectRepos.repoUrl }).from(projectRepos).where(eq(projectRepos.projectId, p.id));
  const names = [p.repoUrl, ...extra.map((e) => e.url)]
    .map((u) => parseRepo(u))
    .filter((r): r is { owner: string; repo: string } => !!r)
    .map((r) => `${r.owner}/${r.repo}`);
  return [...new Set(names.map((n) => n.toLowerCase()))].map((l) => names.find((n) => n.toLowerCase() === l)!);
}

/** GitHub nalog ↔ korisnik (iz ličnih integracija: povezan GitHub). */
export async function loginMap(db: Db) {
  const rows = await db.select({ id: users.id, integrations: users.integrations }).from(users);
  const byLogin = new Map<string, string>();
  const byUser = new Map<string, string>();
  for (const r of rows) {
    const login = (r.integrations as UserIntegrations | null)?.githubLogin;
    if (login) {
      byLogin.set(login.toLowerCase(), r.id);
      byUser.set(r.id, login);
    }
  }
  return { byLogin, byUser };
}

/** Status sa GitHub-a → lokalni (otvoren issue zadržava lokalni tok rada: todo / in progress / review). */
export function localStatusFrom(remote: { state: "open" | "closed"; state_reason?: string | null }, current: IssueStatus | null): IssueStatus {
  if (remote.state === "closed") return remote.state_reason === "not_planned" ? "canceled" : "done";
  if (!current || current === "done" || current === "canceled" || current === "triage") return "todo";
  return current;
}

export function remoteStateFor(status: IssueStatus): { state: "open" | "closed"; state_reason?: "completed" | "not_planned" } {
  if (status === "done") return { state: "closed", state_reason: "completed" };
  if (status === "canceled") return { state: "closed", state_reason: "not_planned" };
  return { state: "open" };
}

interface GhIssueRemote {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  state_reason?: string | null;
  labels: Array<{ name: string } | string>;
  assignees?: Array<{ login: string }>;
  updated_at: string;
  pull_request?: unknown;
  user?: { login: string; type?: string };
}

/**
 * Čitanje sa GitHub-a (worker, na 5 min): svaki issue iz repoa projekta postaje/ostaje task.
 * Vraća broj novih i izmenjenih taskova.
 */
export async function pullIssues(db: Db, token: string, p: typeof projects.$inferSelect, full: string, since: Date | null) {
  const { byLogin } = await loginMap(db);
  let created = 0;
  let updated = 0;
  for (let page = 1; page <= 5; page++) {
    const list = await ghJson<GhIssueRemote[]>(token, `/repos/${full}/issues?state=all&sort=updated&direction=desc&per_page=100&page=${page}${since ? `&since=${since.toISOString()}` : ""}`);
    for (const gi of list.filter((x) => !x.pull_request)) {
      const remoteAt = new Date(gi.updated_at);
      const labels = gi.labels.map((l) => (typeof l === "string" ? l : l.name).toLowerCase().slice(0, 30)).slice(0, 8);
      const assigneeId = gi.assignees?.map((a) => byLogin.get(a.login.toLowerCase())).find(Boolean) ?? null;
      const [link] = await db.select().from(issueLinks).where(and(eq(issueLinks.kind, "gh_issue"), eq(issueLinks.repo, full), eq(issueLinks.number, gi.number))).limit(1);
      if (link) {
        if (link.remoteUpdatedAt && remoteAt <= link.remoteUpdatedAt) continue; // već viđeno (ili naša sopstvena izmena)
        const [cur] = await db.select().from(issues).where(eq(issues.id, link.issueId)).limit(1);
        if (!cur) continue;
        const status = localStatusFrom(gi, cur.status);
        const set: Partial<typeof issues.$inferInsert> = { title: gi.title.slice(0, 300), description: (gi.body ?? "").slice(0, 20_000) || null, labels, status, updatedAt: new Date() };
        if (assigneeId) set.assigneeId = assigneeId;
        if (status !== cur.status) set.completedAt = status === "done" ? new Date() : null;
        await db.update(issues).set(set).where(eq(issues.id, cur.id));
        if (status !== cur.status) await db.insert(issueEvents).values({ issueId: cur.id, type: "status", data: { from: cur.status, to: status, via: `GitHub #${gi.number}` }, actor: "GitHub" });
        await db.update(issueLinks).set({ title: gi.title.slice(0, 300), state: gi.state, remoteUpdatedAt: remoteAt, updatedAt: new Date() }).where(eq(issueLinks.id, link.id));
        updated++;
      } else {
        // Bez petlje: issue koji smo mi napravili za agenta ima link pre nego što ga vidimo ovde
        const [seq] = await db.update(projects).set({ issueSeq: sql`${projects.issueSeq} + 1` }).where(eq(projects.id, p.id)).returning({ n: projects.issueSeq });
        const status = localStatusFrom(gi, null);
        const [row] = await db
          .insert(issues)
          .values({ projectId: p.id, number: seq!.n, title: gi.title.slice(0, 300), description: (gi.body ?? "").slice(0, 20_000) || null, status, labels, assigneeId, createdBy: `GitHub: ${gi.user?.login ?? "?"}`, completedAt: status === "done" ? remoteAt : null })
          .returning({ id: issues.id });
        await db.insert(issueLinks).values({ issueId: row!.id, kind: "gh_issue", repo: full, number: gi.number, url: gi.html_url, title: gi.title.slice(0, 300), state: gi.state, remoteUpdatedAt: remoteAt }).onConflictDoNothing();
        await db.insert(issueEvents).values({ issueId: row!.id, type: "created", data: { via: "github", url: gi.html_url }, actor: `GitHub: ${gi.user?.login ?? "?"}` });
        created++;
      }
    }
    if (list.length < 100) break;
  }
  return { created, updated };
}

/**
 * Upis na GitHub (API, posle izmene u aplikaciji): napravi ili ažuriraj GitHub issue taska.
 * Radi samo za projekte sa uključenom sinhronizacijom. Greške se samo beleže — rad u aplikaciji se ne prekida.
 */
export async function pushIssue(db: Db, token: string, issueId: string): Promise<string | null> {
  const [row] = await db.select({ i: issues, p: projects }).from(issues).innerJoin(projects, eq(issues.projectId, projects.id)).where(eq(issues.id, issueId)).limit(1);
  if (!row || !row.p.githubSync || !token || row.i.status === "triage") return null;
  const repo = parseRepo(row.p.repoUrl);
  if (!repo) return null;
  const { byUser } = await loginMap(db);
  const [link] = await db.select().from(issueLinks).where(and(eq(issueLinks.issueId, issueId), eq(issueLinks.kind, "gh_issue"))).limit(1);
  const full = link?.repo ?? `${repo.owner}/${repo.repo}`;
  const assignee = row.i.assigneeId ? byUser.get(row.i.assigneeId) : undefined;
  const body = {
    title: row.i.title,
    body: row.i.description ?? "",
    labels: row.i.labels,
    ...(assignee ? { assignees: [assignee] } : {}),
    ...remoteStateFor(row.i.status),
  };
  type Remote = { number: number; html_url: string; title: string; state: string; updated_at: string };
  const remote = link
    ? await ghJson<Remote>(token, `/repos/${full}/issues/${link.number}`, { method: "PATCH", body: JSON.stringify(body) })
    : await ghJson<Remote>(token, `/repos/${full}/issues`, { method: "POST", body: JSON.stringify({ title: body.title, body: body.body, labels: body.labels, ...(assignee ? { assignees: [assignee] } : {}) }) });
  // Zapamti GitHub vreme izmene — worker je neće uvesti nazad kao novu promenu
  if (link) await db.update(issueLinks).set({ state: remote.state, title: remote.title, remoteUpdatedAt: new Date(remote.updated_at), updatedAt: new Date() }).where(eq(issueLinks.id, link.id));
  else await db.insert(issueLinks).values({ issueId, kind: "gh_issue", repo: full, number: remote.number, url: remote.html_url, title: remote.title, state: remote.state, remoteUpdatedAt: new Date(remote.updated_at) }).onConflictDoNothing();
  // Novi issue koji treba odmah zatvoriti (npr. napravljen kao Done)
  if (!link && body.state === "closed") await ghFetch(token, `/repos/${full}/issues/${remote.number}`, { method: "PATCH", body: JSON.stringify(remoteStateFor(row.i.status)) });
  return remote.html_url;
}

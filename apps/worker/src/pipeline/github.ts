import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { issueEvents, issueLinks, issues, projectRepoNames, projects, pullIssues, type Db } from "@radar/db";
import { parseRepo, type IssueStatus } from "@radar/shared";
import { rt } from "../runtime.js";

/**
 * GitHub sinhronizacija (Faza 11), bez webhook-a — worker na 5 min čita repo svakog projekta:
 * - PR koji pominje ključ taska (ACME-12) ili GitHub issue koji smo napravili za agenta (#34)
 *   → otvoren: task ide u In Review · spojen (merged): Done.
 * - (opciono, po projektu) novi GitHub issues → Inbox (triage).
 * Treba GITHUB_TOKEN sa pristupom tim repoima (Pull requests: read, Issues: read & write).
 */
const TOKEN = () => rt.githubToken; // Settings → Integrations (ili GITHUB_TOKEN)
export const githubConfigured = () => Boolean(TOKEN());

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${TOKEN()}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "scoutline" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub ${path.split("?")[0]} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface GhPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  updated_at: string;
  head: { ref: string };
}
interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  pull_request?: unknown;
  user?: { login: string; type?: string };
}

const ORDER: IssueStatus[] = ["triage", "backlog", "todo", "in_progress", "in_review", "done", "canceled"];
/** Ne vraćamo status unazad (npr. ručno Done ostaje Done i kad se PR ponovo otvori). */
const target = (pr: GhPull): IssueStatus => (pr.merged_at ? "done" : pr.state === "open" ? (pr.draft ? "in_progress" : "in_review") : "in_progress");
const prState = (pr: GhPull) => (pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open");

export async function syncGithub(db: Db) {
  if (!githubConfigured()) return;
  const list = await db.select().from(projects).where(and(isNotNull(projects.repoUrl), inArray(projects.status, ["planned", "active", "paused"])));
  for (const p of list) {
    const since = p.githubSyncedAt ?? new Date(Date.now() - 30 * 86_400_000);
    const started = new Date();
    let ok = true;
    // Svi repoi projekta (glavni + dodatni: frontend, backend…)
    for (const full of await projectRepoNames(db, p)) {
    try {
      // 0) GitHub kao izvor istine: dvosmerni sync issue-a (čitanje; upis radi API pri izmeni)
      if (p.githubSync) {
        const r = await pullIssues(db, TOKEN(), p, full, p.githubSyncedAt ? new Date(since.getTime() - 60_000) : null);
        if (r.created || r.updated) console.log(`[github] ${full}: issues → ${r.created} novih, ${r.updated} izmenjenih taskova`);
      }
      // 1) Pull request-ovi izmenjeni od poslednje provere
      const pulls = (await gh<GhPull[]>(`/repos/${full}/pulls?state=all&sort=updated&direction=desc&per_page=50`)).filter((pr) => new Date(pr.updated_at) > since);
      if (pulls.length) {
        const own = await db.select({ id: issues.id, number: issues.number, status: issues.status }).from(issues).where(eq(issues.projectId, p.id));
        const ghLinks = await db.select({ issueId: issueLinks.issueId, number: issueLinks.number }).from(issueLinks).where(and(eq(issueLinks.repo, full), eq(issueLinks.kind, "gh_issue")));
        const keyRe = new RegExp(`\\b${p.key}-(\\d+)\\b`, "gi");
        let moved = 0;
        for (const pr of pulls) {
          const text = `${pr.title}\n${pr.body ?? ""}\n${pr.head.ref}`;
          const nums = new Set([...text.matchAll(keyRe)].map((m) => Number(m[1])));
          const ids = new Set(own.filter((i) => nums.has(i.number)).map((i) => i.id));
          // „Fixes #34“ → GitHub issue koji smo napravili za agenta
          for (const m of text.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) for (const l of ghLinks.filter((x) => x.number === Number(m[1]))) ids.add(l.issueId);
          for (const issueId of ids) {
            const values = { issueId, kind: "pr", repo: full, number: pr.number, url: pr.html_url, title: pr.title.slice(0, 300), state: prState(pr) };
            const [prev] = await db.select({ state: issueLinks.state }).from(issueLinks).where(and(eq(issueLinks.issueId, issueId), eq(issueLinks.kind, "pr"), eq(issueLinks.repo, full), eq(issueLinks.number, pr.number))).limit(1);
            await db
              .insert(issueLinks)
              .values(values)
              .onConflictDoUpdate({ target: [issueLinks.issueId, issueLinks.kind, issueLinks.repo, issueLinks.number], set: { title: values.title, state: values.state, updatedAt: new Date() } });
            const cur = own.find((i) => i.id === issueId);
            const to = target(pr);
            if (prev?.state !== values.state) await db.insert(issueEvents).values({ issueId, type: "github", data: { pr: pr.number, url: pr.html_url, state: values.state }, actor: "GitHub" });
            if (cur && cur.status !== "canceled" && ORDER.indexOf(to) > ORDER.indexOf(cur.status)) {
              await db.update(issues).set({ status: to, completedAt: to === "done" ? new Date() : null, updatedAt: new Date() }).where(eq(issues.id, issueId));
              await db.insert(issueEvents).values({ issueId, type: "status", data: { from: cur.status, to, via: `PR #${pr.number}` }, actor: "GitHub" });
              cur.status = to;
              moved++;
            }
          }
        }
        if (moved) console.log(`[github] ${full}: ${moved} taskova pomereno po PR-ovima`);
      }

      // 2) Novi GitHub issues → Inbox (samo ako je uključeno za projekat, a pun sync nije)
      if (p.githubImport && !p.githubSync) {
        const fresh = (await gh<GhIssue[]>(`/repos/${full}/issues?state=open&sort=created&direction=desc&per_page=30&since=${since.toISOString()}`)).filter(
          (i) => !i.pull_request && new Date(i.created_at) > since && !/^\[[A-Z0-9]+-\d+\]/.test(i.title) && i.user?.type !== "Bot",
        );
        const known = new Set((await db.select({ n: issueLinks.number }).from(issueLinks).where(and(eq(issueLinks.repo, full), eq(issueLinks.kind, "gh_issue")))).map((r) => r.n));
        const toImport = fresh.filter((i) => !known.has(i.number)).reverse();
        for (const gi of toImport) {
          const [seq] = await db.update(projects).set({ issueSeq: sql`${projects.issueSeq} + 1` }).where(eq(projects.id, p.id)).returning({ n: projects.issueSeq });
          const [row] = await db
            .insert(issues)
            .values({ projectId: p.id, number: seq!.n, title: gi.title.slice(0, 300), description: `${(gi.body ?? "").slice(0, 8000)}\n\n— Imported from GitHub #${gi.number}`, status: "triage", createdBy: `GitHub: ${gi.user?.login ?? "?"}`, labels: ["github"] })
            .returning({ id: issues.id });
          await db.insert(issueLinks).values({ issueId: row!.id, kind: "gh_issue", repo: full, number: gi.number, url: gi.html_url, title: gi.title.slice(0, 300), state: "open" }).onConflictDoNothing();
          await db.insert(issueEvents).values({ issueId: row!.id, type: "created", data: { via: "github", url: gi.html_url }, actor: `GitHub: ${gi.user?.login ?? "?"}` });
        }
        if (toImport.length) console.log(`[github] ${full}: ${toImport.length} novih issues → Inbox`);
      }
    } catch (e) {
      ok = false;
      console.warn(`[github] ${full}: ${(e as Error).message}`);
    }
    }
    if (ok) await db.update(projects).set({ githubSyncedAt: started }).where(eq(projects.id, p.id));
  }
}

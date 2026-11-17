import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { decryptSecret, deploys, encryptSecret, ghFetch, ghJson, issueLinks, issues, projectRepoNames, projectRepos, projects, userGithubToken, type Db, type Secret } from "@radar/db";
import { parseRepo } from "@radar/shared";
import { runtime } from "./runtime.js";

/**
 * Faza 14 — GitHub tok rada iz aplikacije: više repoa po projektu, analitika (commit-ovi, PR-ovi, CI),
 * pull request-ovi (approve / merge / AI review), grane (nova za task, brisanje spojenih), Actions (run) i deploy dugmad.
 * Token: lični GitHub korisnika (Settings → Integrations), inače token firme.
 * Potrebne dozvole tokena: Issues R/W, Pull requests R/W, Contents R/W, Actions R/W, Metadata R.
 */
interface Guards {
  readGuard: MiddlewareHandler;
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
}
type Actor = { id: string | null; name: string; role?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
const DAY = 86_400_000;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);
const weekStart = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

interface Hook {
  id: string;
  name: string;
  url: Secret;
  token?: Secret; // Coolify API token (Bearer) — Netlify build hook ga nema
}

const insightsCache = new Map<string, { at: number; data: unknown }>();

export function githubFlowRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };
  const member = g.require("member");
  const token = async (c: Context) => (await userGithubToken(getDb(), actor(c).id)) ?? (await runtime(getDb())).githubToken;
  const project = async (id: string) => (isUuid(id) ? (await getDb().select().from(projects).where(eq(projects.id, id)).limit(1))[0] : undefined);
  /** Repo mora da pripada projektu (zaštita: ne dozvoljavamo proizvoljne repoe). */
  const repoOf = async (c: Context): Promise<{ p: typeof projects.$inferSelect; full: string } | Response> => {
    const p = await project(c.req.param("id")!);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const names = await projectRepoNames(getDb(), p);
    const want = c.req.query("repo") ?? names[0];
    const full = names.find((n) => n.toLowerCase() === (want ?? "").toLowerCase());
    if (!full) return c.json({ error: names.length ? "This repo isn't linked to the project." : "Add a GitHub repo to the project first." }, 400);
    return { p, full };
  };
  const fail = (c: Context, e: unknown) => c.json({ error: (e as Error).message }, 502);

  // ── Repoi projekta ──
  app.get("/projects/:id/repos", g.readGuard, async (c) => {
    const p = await project(c.req.param("id")!);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const extra = await getDb().select().from(projectRepos).where(eq(projectRepos.projectId, p.id));
    const primary = parseRepo(p.repoUrl);
    return c.json({
      repos: [
        ...(primary ? [{ id: "primary", full: `${primary.owner}/${primary.repo}`, label: "main", primary: true }] : []),
        ...extra.map((e) => {
          const r = parseRepo(e.repoUrl);
          return { id: e.id, full: r ? `${r.owner}/${r.repo}` : e.repoUrl, label: e.label, primary: false };
        }),
      ],
    });
  });
  app.post("/projects/:id/repos", member, async (c) => {
    const p = await project(c.req.param("id")!);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { repo?: string; label?: string };
    const raw = (b.repo ?? "").trim();
    const r = parseRepo(raw.includes("github.com") ? raw : `https://github.com/${raw}`);
    if (!r || !REPO_NAME.test(`${r.owner}/${r.repo}`)) return c.json({ error: "Use owner/name or a github.com link." }, 400);
    const url = `https://github.com/${r.owner}/${r.repo}`;
    if (!p.repoUrl) await getDb().update(projects).set({ repoUrl: url, updatedAt: new Date() }).where(eq(projects.id, p.id));
    else await getDb().insert(projectRepos).values({ projectId: p.id, repoUrl: url, label: (b.label ?? "").trim().slice(0, 30) || null }).onConflictDoNothing();
    return c.json({ ok: true });
  });
  app.delete("/projects/:id/repos/:rid", member, async (c) => {
    const rid = c.req.param("rid")!;
    if (!isUuid(rid)) return c.json({ error: "Remove the main repo in Edit project." }, 400);
    await getDb().delete(projectRepos).where(and(eq(projectRepos.id, rid), eq(projectRepos.projectId, c.req.param("id")!)));
    return c.json({ ok: true });
  });

  // ── Analitika iz GitHub-a (za sve repoe projekta), keš 10 min ──
  app.get("/projects/:id/insights", g.readGuard, async (c) => {
    const p = await project(c.req.param("id")!);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const names = await projectRepoNames(getDb(), p);
    if (!names.length) return c.json({ repos: [], configured: false });
    const tok = await token(c);
    if (!tok) return c.json({ error: "Connect GitHub in Settings → Integrations." }, 400);
    const key = `${p.id}:${names.join(",")}`;
    const hit = insightsCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000 && c.req.query("fresh") !== "1") return c.json(hit.data);
    const since = new Date(Date.now() - 12 * 7 * DAY);
    const weeks: Array<{ week: string; commits: number; opened: number; merged: number }> = [];
    for (let i = 11; i >= 0; i--) weeks.push({ week: weekStart(new Date(Date.now() - i * 7 * DAY)), commits: 0, opened: 0, merged: 0 });
    const people = new Map<string, { commits: number; prs: number }>();
    const openPrs: Array<{ repo: string; number: number; title: string; author: string; ageDays: number; draft: boolean; url: string }> = [];
    const mergeHours: number[] = [];
    let ciRuns = 0;
    let ciOk = 0;
    let lastRun: { repo: string; name: string; conclusion: string | null; at: string; url: string } | null = null;
    const milestones: Array<{ repo: string; title: string; open: number; closed: number; due: string | null }> = [];
    const errors: string[] = [];
    for (const full of names) {
      try {
        const commits = await ghJson<Array<{ commit: { author: { date: string; name: string } }; author: { login: string } | null }>>(tok, `/repos/${full}/commits?since=${since.toISOString()}&per_page=100`);
        for (const cm of commits) {
          const w = weeks.find((x) => x.week === weekStart(new Date(cm.commit.author.date)));
          if (w) w.commits++;
          const who = cm.author?.login ?? cm.commit.author.name;
          people.set(who, { commits: (people.get(who)?.commits ?? 0) + 1, prs: people.get(who)?.prs ?? 0 });
        }
        const pulls = await ghJson<Array<{ number: number; title: string; html_url: string; state: string; draft: boolean; created_at: string; merged_at: string | null; user: { login: string } }>>(tok, `/repos/${full}/pulls?state=all&sort=created&direction=desc&per_page=100`);
        for (const pr of pulls) {
          const created = new Date(pr.created_at);
          const w = weeks.find((x) => x.week === weekStart(created));
          if (w) w.opened++;
          if (pr.merged_at) {
            const mw = weeks.find((x) => x.week === weekStart(new Date(pr.merged_at!)));
            if (mw) mw.merged++;
            if (new Date(pr.merged_at) >= since) mergeHours.push((Date.parse(pr.merged_at) - created.getTime()) / 3_600_000);
          }
          if (created >= since) people.set(pr.user.login, { commits: people.get(pr.user.login)?.commits ?? 0, prs: (people.get(pr.user.login)?.prs ?? 0) + 1 });
          if (pr.state === "open") openPrs.push({ repo: full, number: pr.number, title: pr.title, author: pr.user.login, ageDays: Math.floor((Date.now() - created.getTime()) / DAY), draft: pr.draft, url: pr.html_url });
        }
        const runs = await ghFetch(tok, `/repos/${full}/actions/runs?per_page=30`);
        if (runs.ok) {
          const d = (await runs.json()) as { workflow_runs?: Array<{ name: string; conclusion: string | null; status: string; created_at: string; html_url: string }> };
          for (const r of d.workflow_runs ?? []) {
            if (r.status !== "completed") continue;
            ciRuns++;
            if (r.conclusion === "success") ciOk++;
          }
          const first = d.workflow_runs?.[0];
          if (first && (!lastRun || first.created_at > lastRun.at)) lastRun = { repo: full, name: first.name, conclusion: first.conclusion ?? first.status, at: first.created_at, url: first.html_url };
        }
        const ms = await ghFetch(tok, `/repos/${full}/milestones?state=open&per_page=10`);
        if (ms.ok) for (const m of (await ms.json()) as Array<{ title: string; open_issues: number; closed_issues: number; due_on: string | null }>) milestones.push({ repo: full, title: m.title, open: m.open_issues, closed: m.closed_issues, due: m.due_on });
      } catch (e) {
        errors.push(`${full}: ${(e as Error).message}`);
      }
    }
    const data = {
      configured: true,
      repos: names,
      weeks,
      totals: {
        commits: weeks.reduce((a, w) => a + w.commits, 0),
        prsOpened: weeks.reduce((a, w) => a + w.opened, 0),
        prsMerged: weeks.reduce((a, w) => a + w.merged, 0),
        openPrs: openPrs.length,
        medianMergeHours: median(mergeHours) !== null ? Math.round(median(mergeHours)! * 10) / 10 : null,
        ciSuccessPct: ciRuns ? Math.round((ciOk / ciRuns) * 100) : null,
      },
      openPrs: openPrs.sort((a, b) => b.ageDays - a.ageDays).slice(0, 20),
      people: [...people.entries()].map(([login, v]) => ({ login, ...v })).sort((a, b) => b.commits + b.prs - (a.commits + a.prs)).slice(0, 12),
      lastRun,
      milestones,
      errors,
      at: new Date().toISOString(),
    };
    insightsCache.set(key, { at: Date.now(), data });
    return c.json(data);
  });

  // ── Pull request-ovi ──
  app.get("/projects/:id/pulls", g.readGuard, async (c) => {
    const r = await repoOf(c);
    if (r instanceof Response) return r;
    try {
      const tok = await token(c);
      const pulls = await ghJson<Array<{ number: number; title: string; html_url: string; draft: boolean; user: { login: string }; head: { ref: string; sha: string }; base: { ref: string }; created_at: string; requested_reviewers?: Array<{ login: string }> }>>(tok, `/repos/${r.full}/pulls?state=open&per_page=30`);
      const out = await Promise.all(
        pulls.map(async (pr) => {
          let checks: { total: number; ok: number; failed: number; pending: number } | null = null;
          const cr = await ghFetch(tok, `/repos/${r.full}/commits/${pr.head.sha}/check-runs?per_page=50`);
          if (cr.ok) {
            const d = (await cr.json()) as { check_runs?: Array<{ status: string; conclusion: string | null }> };
            const runs = d.check_runs ?? [];
            checks = { total: runs.length, ok: runs.filter((x) => x.conclusion === "success" || x.conclusion === "skipped" || x.conclusion === "neutral").length, failed: runs.filter((x) => x.conclusion === "failure" || x.conclusion === "timed_out" || x.conclusion === "cancelled").length, pending: runs.filter((x) => x.status !== "completed").length };
          }
          const rv = await ghFetch(tok, `/repos/${r.full}/pulls/${pr.number}/reviews?per_page=30`);
          const reviews = rv.ok ? ((await rv.json()) as Array<{ state: string; user: { login: string } }>) : [];
          const approved = reviews.some((x) => x.state === "APPROVED");
          const changes = reviews.some((x) => x.state === "CHANGES_REQUESTED");
          const [link] = await getDb().select({ issueId: issueLinks.issueId }).from(issueLinks).where(and(eq(issueLinks.kind, "pr"), eq(issueLinks.repo, r.full), eq(issueLinks.number, pr.number))).limit(1);
          const issue = link ? (await getDb().select({ number: issues.number }).from(issues).where(eq(issues.id, link.issueId)).limit(1))[0] : undefined;
          return { number: pr.number, title: pr.title, url: pr.html_url, draft: pr.draft, author: pr.user.login, branch: pr.head.ref, base: pr.base.ref, createdAt: pr.created_at, checks, approved, changesRequested: changes, issueKey: issue ? `${r.p.key}-${issue.number}` : null };
        }),
      );
      return c.json({ repo: r.full, pulls: out });
    } catch (e) {
      return fail(c, e);
    }
  });

  // POST /projects/:id/pulls/:n/approve | merge | review
  app.post("/projects/:id/pulls/:n/:action", member, async (c) => {
    const r = await repoOf(c);
    if (r instanceof Response) return r;
    const n = Number(c.req.param("n"));
    const action = c.req.param("action");
    if (!Number.isInteger(n) || n < 1) return c.json({ error: "Bad pull request number." }, 400);
    const tok = await token(c);
    try {
      if (action === "approve") {
        await ghJson(tok, `/repos/${r.full}/pulls/${n}/reviews`, { method: "POST", body: JSON.stringify({ event: "APPROVE", body: `Approved in Scoutline by ${actor(c).name}.` }) });
        return c.json({ ok: true, message: "Approved." });
      }
      if (action === "merge") {
        const method = (await c.req.json().catch(() => ({})) as { method?: string }).method;
        const res = await ghJson<{ merged?: boolean; message?: string }>(tok, `/repos/${r.full}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: method === "merge" || method === "rebase" ? method : "squash" }) });
        return c.json({ ok: !!res.merged, message: res.message ?? "Merged." });
      }
      if (action === "review") {
        const agent = ((await c.req.json().catch(() => ({}))) as { agent?: string }).agent === "codex" ? "codex" : "claude";
        await ghJson(tok, `/repos/${r.full}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body: `@${agent} please review this pull request: correctness, security, tests, and anything that could break. Keep it short and concrete.` }) });
        return c.json({ ok: true, message: `Asked ${agent === "codex" ? "Codex" : "Claude"} to review — the comment appears on the PR.` });
      }
      return c.json({ error: "Unknown action." }, 400);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: /own pull request/i.test(msg) ? "GitHub doesn't allow approving your own pull request — ask a teammate." : msg }, 502);
    }
  });

  // ── Grane ──
  app.get("/projects/:id/branches", g.readGuard, async (c) => {
    const r = await repoOf(c);
    if (r instanceof Response) return r;
    try {
      const tok = await token(c);
      const meta = await ghJson<{ default_branch: string }>(tok, `/repos/${r.full}`);
      const branches = await ghJson<Array<{ name: string; protected: boolean; commit: { sha: string } }>>(tok, `/repos/${r.full}/branches?per_page=100`);
      const merged = await ghJson<Array<{ head: { ref: string }; merged_at: string | null; state: string; number: number }>>(tok, `/repos/${r.full}/pulls?state=all&per_page=100&sort=updated&direction=desc`);
      const prByBranch = new Map<string, { number: number; state: string; merged: boolean }>();
      for (const pr of merged) if (!prByBranch.has(pr.head.ref)) prByBranch.set(pr.head.ref, { number: pr.number, state: pr.state, merged: !!pr.merged_at });
      return c.json({
        repo: r.full,
        defaultBranch: meta.default_branch,
        branches: branches.map((b) => ({ name: b.name, protected: b.protected, isDefault: b.name === meta.default_branch, pr: prByBranch.get(b.name) ?? null })),
      });
    } catch (e) {
      return fail(c, e);
    }
  });
  // POST /projects/:id/branches { issueId } — nova grana za task (acme-12-naslov) iz glavne grane
  app.post("/projects/:id/branches", member, async (c) => {
    const r = await repoOf(c);
    if (r instanceof Response) return r;
    const b = (await c.req.json().catch(() => ({}))) as { issueId?: string; name?: string };
    let name = (b.name ?? "").trim();
    if (isUuid(b.issueId)) {
      const [i] = await getDb().select({ number: issues.number, title: issues.title }).from(issues).where(eq(issues.id, b.issueId)).limit(1);
      if (i) name = `${r.p.key}-${i.number}-${i.title}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    }
    if (!/^[\w./-]{2,80}$/.test(name)) return c.json({ error: "Invalid branch name." }, 400);
    try {
      const tok = await token(c);
      const meta = await ghJson<{ default_branch: string }>(tok, `/repos/${r.full}`);
      const ref = await ghJson<{ object: { sha: string } }>(tok, `/repos/${r.full}/git/ref/heads/${encodeURIComponent(meta.default_branch)}`);
      await ghJson(tok, `/repos/${r.full}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }) });
      return c.json({ ok: true, name, url: `https://github.com/${r.full}/tree/${encodeURIComponent(name)}` }, 201);
    } catch (e) {
      return fail(c, e);
    }
  });
  // DELETE /projects/:id/branches?repo=&name= — samo grane čiji je PR spojen ili zatvoren (zaštita)
  app.delete("/projects/:id/branches", member, async (c) => {
    const r = await repoOf(c);
    if (r instanceof Response) return r;
    const name = c.req.query("name") ?? "";
    if (!/^[\w./-]{1,100}$/.test(name)) return c.json({ error: "Invalid branch name." }, 400);
    try {
      const tok = await token(c);
      const meta = await ghJson<{ default_branch: string }>(tok, `/repos/${r.full}`);
      if (name === meta.default_branch) return c.json({ error: "The main branch can't be deleted." }, 400);
      const prs = await ghJson<Array<{ state: string }>>(tok, `/repos/${r.full}/pulls?state=all&head=${encodeURIComponent(r.full.split("/")[0]! + ":" + name)}&per_page=5`);
      if (!prs.length || prs.some((p) => p.state === "open")) return c.json({ error: "Only branches whose pull request is merged or closed can be deleted here." }, 400);
      const res = await ghFetch(tok, `/repos/${r.full}/git/refs/heads/${name.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
      if (!res.ok && res.status !== 422) throw new Error(`GitHub: HTTP ${res.status}`);
      return c.json({ ok: true });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── GitHub Actions ──
  app.get("/projects/:id/actions", g.readGuard, async (c) => {
    const r = await repoOf(c);
    if (r instanceof Response) return r;
    try {
      const tok = await token(c);
      const wf = await ghJson<{ workflows: Array<{ id: number; name: string; path: string; state: string }> }>(tok, `/repos/${r.full}/actions/workflows?per_page=50`);
      const runs = await ghJson<{ workflow_runs: Array<{ id: number; name: string; status: string; conclusion: string | null; head_branch: string; created_at: string; html_url: string; workflow_id: number; event: string }> }>(tok, `/repos/${r.full}/actions/runs?per_page=15`);
      // Koji workflow može da se pokrene ručno (ima workflow_dispatch)
      const dispatchable = new Set<number>();
      for (const w of wf.workflows.filter((x) => x.state === "active")) {
        const f = await ghFetch(tok, `/repos/${r.full}/contents/${w.path.split("/").map(encodeURIComponent).join("/")}`, { headers: { Accept: "application/vnd.github.raw" } });
        if (f.ok && /workflow_dispatch/.test(await f.text())) dispatchable.add(w.id);
      }
      return c.json({
        repo: r.full,
        workflows: wf.workflows.map((w) => ({ id: w.id, name: w.name, path: w.path, active: w.state === "active", canRun: dispatchable.has(w.id) })),
        runs: runs.workflow_runs.map((x) => ({ id: x.id, name: x.name, status: x.status, conclusion: x.conclusion, branch: x.head_branch, at: x.created_at, url: x.html_url, event: x.event })),
      });
    } catch (e) {
      return fail(c, e);
    }
  });
  app.post("/projects/:id/actions/:wid/run", member, async (c) => {
    const r = await repoOf(c);
    if (r instanceof Response) return r;
    const wid = Number(c.req.param("wid"));
    if (!Number.isInteger(wid)) return c.json({ error: "Bad workflow." }, 400);
    try {
      const tok = await token(c);
      const meta = await ghJson<{ default_branch: string }>(tok, `/repos/${r.full}`);
      const ref = ((await c.req.json().catch(() => ({}))) as { ref?: string }).ref || meta.default_branch;
      const res = await ghFetch(tok, `/repos/${r.full}/actions/workflows/${wid}/dispatches`, { method: "POST", body: JSON.stringify({ ref }) });
      if (!res.ok) throw new Error(`GitHub: ${((await res.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${res.status}`}`);
      return c.json({ ok: true, message: `Started on ${ref} — it appears in the list within a few seconds.` });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Deploy dugmad (Coolify webhook, Netlify build hook…) ──
  app.get("/projects/:id/deploys", g.readGuard, async (c) => {
    const p = await project(c.req.param("id")!);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const hooks = ((p.deployHooks as Hook[] | null) ?? []).map((h) => ({ id: h.id, name: h.name, hint: h.url.hint, withToken: !!h.token }));
    const history = await getDb().select().from(deploys).where(eq(deploys.projectId, p.id)).orderBy(desc(deploys.createdAt)).limit(15);
    return c.json({ hooks, history });
  });
  // POST /projects/:id/deploy-hooks { name, url } (vlasnik) · DELETE /projects/:id/deploy-hooks/:hid
  app.post("/projects/:id/deploy-hooks", g.require("owner"), async (c) => {
    const p = await project(c.req.param("id")!);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; url?: string; token?: string };
    const name = (b.name ?? "").trim().slice(0, 40);
    const url = (b.url ?? "").trim();
    if (!name || !/^https?:\/\/[^\s]+$/i.test(url)) return c.json({ error: "Add a name and the deploy hook URL (from Coolify → Webhooks or Netlify → Build hooks)." }, 400);
    const hooks = [...((p.deployHooks as Hook[] | null) ?? []), { id: crypto.randomUUID(), name, url: encryptSecret(url), ...(b.token?.trim() ? { token: encryptSecret(b.token.trim()) } : {}) }].slice(0, 10);
    await getDb().update(projects).set({ deployHooks: hooks, updatedAt: new Date() }).where(eq(projects.id, p.id));
    return c.json({ ok: true });
  });
  app.delete("/projects/:id/deploy-hooks/:hid", g.require("owner"), async (c) => {
    const p = await project(c.req.param("id")!);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const hooks = ((p.deployHooks as Hook[] | null) ?? []).filter((h) => h.id !== c.req.param("hid"));
    await getDb().update(projects).set({ deployHooks: hooks, updatedAt: new Date() }).where(eq(projects.id, p.id));
    return c.json({ ok: true });
  });
  app.post("/projects/:id/deploy/:hid", member, async (c) => {
    const p = await project(c.req.param("id")!);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const hook = ((p.deployHooks as Hook[] | null) ?? []).find((h) => h.id === c.req.param("hid"));
    const url = hook ? decryptSecret(hook.url) : null;
    if (!hook || !url) return c.json({ error: "Deploy hook not found — add it again." }, 404);
    let ok = false;
    let status: number | null = null;
    let message = "";
    try {
      // Coolify: GET sa API tokenom (Bearer) · Netlify build hook: POST bez tokena (pa GET ako POST nije dozvoljen)
      const bearer = hook.token ? decryptSecret(hook.token) : null;
      let res = bearer
        ? await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(20_000) })
        : await fetch(url, { method: "POST", signal: AbortSignal.timeout(20_000) });
      if (!bearer && res.status === 405) res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(20_000) });
      status = res.status;
      ok = res.ok;
      message = ok ? "Deploy started." : `The hook answered HTTP ${res.status}.`;
    } catch (e) {
      message = (e as Error).message;
    }
    await getDb().insert(deploys).values({ projectId: p.id, hookName: hook.name, actor: actor(c).name, ok, status, message });
    return c.json({ ok, message }, ok ? 200 : 502);
  });

  return app;
}

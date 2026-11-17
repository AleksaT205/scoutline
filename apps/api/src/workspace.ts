import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { decryptSecret, ghFetch, ghJson, issueEvents, issueLinks, projectRepoNames, projectRepos, projects, readUserIntegrations, settings, skills, userGithubToken, type Db } from "@radar/db";
import { runtime } from "./runtime.js";
import { repoContext, runModel } from "./assistant.js";

/**
 * Faza 15: organizacija (profil i brend), biblioteka skills-a za AI agente (PR u repo projekta),
 * Figma dizajn u tasku i „pokreni lokalno“ (VS Code / Cursor / Codespaces + komande).
 */
interface Guards {
  readGuard: MiddlewareHandler;
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
}
type Actor = { id: string | null; name: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ── Organizacija ──
export interface Organization {
  name: string;
  logoUrl: string;
  accent: string;
  website: string;
  email: string;
  invoiceDetails: string; // adresa, PIB, matični broj, račun — na fakturi
}
const DEFAULT_ORG: Organization = { name: "", logoUrl: "", accent: "#5b4bff", website: "", email: "", invoiceDetails: "" };
export async function loadOrganization(db: Db): Promise<Organization> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "organization")).limit(1);
  return { ...DEFAULT_ORG, ...((row?.value as Partial<Organization>) ?? {}) };
}

// ── Ugrađena biblioteka skills-a (proverene osnove; tim dodaje svoje) ──
const skill = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;

// ── Skills sa GitHub-a: katalog (npr. anthropics/skills) i uvoz iz linka ──
const DEFAULT_SKILL_SOURCES = ["anthropics/skills"];
/** Link → repo, grana i folder skill-a. Prima github.com/o/r/tree/main/skills/x, …/blob/main/skills/x/SKILL.md ili o/r/putanja. */
export function parseSkillUrl(input: string): { repo: string; ref: string | null; dir: string } | null {
  const t = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/+$/, "").replace(/\.git$/, "");
  const m = /^([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([^/]+))?(?:\/(.*))?$/.exec(t);
  if (!m) return null;
  let dir = (m[4] ?? "").replace(/\/?SKILL\.md$/i, "");
  if (dir.includes("..")) return null;
  dir = dir.replace(/^\/+/, "");
  return { repo: `${m[1]}/${m[2]}`, ref: m[3] ?? null, dir };
}
/** Frontmatter iz SKILL.md: name, description, license. */
export function skillFrontmatter(md: string): { name?: string; description?: string; license?: string } {
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "";
  const lines = fm.split(/\r?\n/);
  const get = (k: string) => {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (i < 0) return undefined;
    const v = lines[i]!.slice(k.length + 1).trim();
    // YAML blok (> ili |): sledeći uvučeni redovi
    if (/^[>|][-+]?$/.test(v)) {
      const block: string[] = [];
      for (let j = i + 1; j < lines.length && (/^\s+/.test(lines[j]!) || lines[j] === ""); j++) block.push(lines[j]!.trim());
      return block.join(v.startsWith(">") ? " " : "\n").trim() || undefined;
    }
    return v ? v.replace(/^["']|["']$/g, "") : undefined;
  };
  return { name: get("name"), description: get("description"), license: get("license") };
}
const catalogCache = new Map<string, { at: number; items: unknown[] }>();
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "skill";

export const BUILTIN_SKILLS = [
  {
    id: "agents-md",
    name: "AGENTS.md — project guide",
    description: "Short map of the repo for any AI agent (Claude, Codex, Cursor): structure, commands, rules. Saves tokens on every task.",
    path: "AGENTS.md",
    content: `# AGENTS.md

Short and exact, so an AI assistant knows where things are without scanning the whole repo.

## Project
<one sentence: what this app does and for whom>

## Structure
\`\`\`
<folder>   <what lives there>
\`\`\`

## Commands
\`\`\`bash
<install>
<dev>
<test>
<build>
\`\`\`
All checks must pass before a pull request.

## Rules
- Small, focused changes; don't refactor what the task doesn't ask for.
- Start the pull request title with the task key (e.g. ACME-12).
- No secrets in code — use environment variables.
- Write/update tests for behavior you change.
`,
  },
  { id: "claude-md", name: "CLAUDE.md", description: "Claude Code reads it automatically; points to AGENTS.md plus Claude-specific notes.", path: "CLAUDE.md", content: "@AGENTS.md\n\n## For Claude Code\n- Read AGENTS.md and only the files the task touches.\n- One task per session; plan first for bigger changes.\n- Run the checks from AGENTS.md before committing.\n" },
  {
    id: "code-review",
    name: "Skill: code review",
    description: "Checklist Claude uses when asked to review a pull request.",
    path: ".claude/skills/code-review/SKILL.md",
    content: skill(
      "code-review",
      "Review a pull request or diff for bugs, security issues, missing tests and unclear code. Use when asked to review changes.",
      `Review the diff, not the whole repo.

1. **Correctness** — edge cases, null/empty input, error paths, off-by-one, async races.
2. **Security** — secrets in code, injection (SQL, shell, HTML), missing auth checks, unsafe redirects.
3. **Tests** — is changed behavior covered? Suggest the smallest missing test.
4. **Clarity** — confusing names, dead code, duplicated logic.

Reply with a short list ordered by severity: \`file:line — problem — suggested fix\`. Say "Looks good" if nothing important.`,
    ),
  },
  {
    id: "tests-first",
    name: "Skill: tests first",
    description: "Write or update tests before changing behavior, then run the full check.",
    path: ".claude/skills/tests-first/SKILL.md",
    content: skill(
      "tests-first",
      "When fixing a bug or adding behavior, first write a failing test, then make it pass, then run all checks.",
      `1. Reproduce the bug or describe the new behavior as a test (it should fail).
2. Make the smallest change that makes it pass.
3. Run the project's test, typecheck and build commands (see AGENTS.md).
4. In the PR description list what you tested.`,
    ),
  },
  {
    id: "commit-style",
    name: "Skill: commits & PRs",
    description: "Small commits, clear messages, PR title with the task key, short PR description.",
    path: ".claude/skills/commit-style/SKILL.md",
    content: skill(
      "commit-style",
      "How to write commits and pull requests in this repo.",
      `- One logical change per commit; message in imperative mood ("Add CSV export").
- PR title starts with the task key: \`ACME-12 Add CSV export\`.
- PR description: what changed, why, how it was tested, screenshots for UI.
- Keep PRs small (< 400 lines when possible).`,
    ),
  },
  {
    id: "security-check",
    name: "Skill: security check",
    description: "Quick security pass for auth, secrets and input handling.",
    path: ".claude/skills/security-check/SKILL.md",
    content: skill(
      "security-check",
      "Check changes for common security problems before opening a PR.",
      `- No API keys, passwords or tokens in code, logs or tests.
- Every endpoint that changes data checks the user's permission.
- User input is validated; queries are parameterized; HTML is escaped.
- External URLs are allow-listed; file uploads are size/type limited.
- Dependencies: no new package without a reason.`,
    ),
  },
  {
    id: "ui-polish",
    name: "Skill: UI polish",
    description: "Consistent design tokens, responsive layout and accessibility for UI tasks.",
    path: ".claude/skills/ui-polish/SKILL.md",
    content: skill(
      "ui-polish",
      "Use for any UI change: keep the design consistent, responsive and accessible.",
      `- Use the existing design tokens/components; no hard-coded colors or one-off spacing.
- Check mobile (375px), tablet and desktop; no horizontal scroll.
- Dark and light themes both readable.
- Buttons/inputs have labels; keyboard focus is visible; contrast is sufficient.
- Empty, loading and error states exist.`,
    ),
  },
  { id: "pr-template", name: "Pull request template", description: "GitHub shows this when anyone opens a PR.", path: ".github/pull_request_template.md", content: "## What\n\n## Why\n\n## How tested\n- [ ] Tests pass\n- [ ] Checked on mobile (UI)\n\nTask: <!-- e.g. ACME-12 -->\n" },
];

function figmaParse(url: string): { key: string; node: string | null } | null {
  const m = url.match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,})/);
  if (!m) return null;
  const node = new URL(url).searchParams.get("node-id");
  return { key: m[1]!, node: node ? node.replace(/-/g, ":") : null };
}
const hash31 = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 2_147_483_647, 7);
const figmaImageCache = new Map<string, { at: number; url: string | null }>();

export function workspaceRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };
  const member = g.require("member");
  const ghToken = async (c: Context) => (await userGithubToken(getDb(), actor(c).id)) ?? (await runtime(getDb())).githubToken;
  const figmaToken = async (c: Context) => {
    const a = actor(c);
    const own = a.id ? decryptSecret((await readUserIntegrations(getDb(), a.id)).figmaToken) : null;
    return own ?? (await runtime(getDb())).figmaToken;
  };
  const repoFor = async (c: Context) => {
    const id = c.req.param("id")!;
    const p = isUuid(id) ? (await getDb().select().from(projects).where(eq(projects.id, id)).limit(1))[0] : undefined;
    if (!p) return null;
    const names = await projectRepoNames(getDb(), p);
    const want = c.req.query("repo") ?? names[0];
    const full = names.find((n) => n.toLowerCase() === (want ?? "").toLowerCase());
    return full ? { p, full } : { p, full: null };
  };

  // ── Organizacija (javno čitanje — portal klijenta prikazuje ime i logo) ──
  app.get("/organization", async (c) => c.json({ organization: await loadOrganization(getDb()) }));
  app.put("/organization", g.require("owner"), async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Partial<Organization>;
    const logo = str(b.logoUrl, 500);
    const accent = str(b.accent, 9);
    const org: Organization = {
      name: str(b.name, 80),
      logoUrl: /^https:\/\//.test(logo) ? logo : "",
      accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_ORG.accent,
      website: str(b.website, 200),
      email: str(b.email, 200),
      invoiceDetails: str(b.invoiceDetails, 1000),
    };
    await getDb().insert(settings).values({ key: "organization", value: org }).onConflictDoUpdate({ target: settings.key, set: { value: org, updatedAt: new Date() } });
    return c.json({ organization: org });
  });

  // ── Biblioteka skills-a ──
  app.get("/delivery/skills", member, async (c) => {
    const custom = await getDb().select().from(skills).orderBy(desc(skills.updatedAt));
    return c.json({ skills: [...BUILTIN_SKILLS.map((s) => ({ ...s, builtin: true })), ...custom.map((s) => ({ id: s.id, name: s.name, description: s.description, path: s.path, content: s.content, builtin: false, createdBy: s.createdBy }))] });
  });
  const skillInput = (b: Record<string, unknown>) => {
    const path = str(b.path, 200);
    if (!/^[\w.\-/]+\.md$/.test(path) || path.includes("..") || path.startsWith("/")) return { error: "Path must be a .md file inside the repo, e.g. .claude/skills/my-skill/SKILL.md" };
    const name = str(b.name, 80);
    const content = typeof b.content === "string" ? b.content.slice(0, 20_000) : "";
    if (!name || !content.trim()) return { error: "Name and content are required." };
    return { name, path, content, description: str(b.description, 300) || null };
  };
  app.post("/delivery/skills", member, async (c) => {
    const v = skillInput((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
    if ("error" in v) return c.json({ error: v.error }, 400);
    const [row] = await getDb().insert(skills).values({ ...v, createdBy: actor(c).name }).returning();
    return c.json({ skill: row }, 201);
  });
  app.patch("/delivery/skills/:sid", member, async (c) => {
    const sid = c.req.param("sid")!;
    if (!isUuid(sid)) return c.json({ error: "Built-in skills can't be edited — duplicate it first." }, 400);
    const v = skillInput((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
    if ("error" in v) return c.json({ error: v.error }, 400);
    const [row] = await getDb().update(skills).set({ ...v, updatedAt: new Date() }).where(eq(skills.id, sid)).returning();
    return row ? c.json({ skill: row }) : c.json({ error: "Not found." }, 404);
  });
  app.delete("/delivery/skills/:sid", member, async (c) => {
    const sid = c.req.param("sid")!;
    if (!isUuid(sid)) return c.json({ error: "Built-in skills can't be deleted." }, 400);
    await getDb().delete(skills).where(eq(skills.id, sid));
    return c.json({ ok: true });
  });

  // GitHub helper za javne/privatne repoe sa skill-ovima (radi i bez tokena za javne repoe)
  const ghPublic = async (tok: string | null, path: string, raw = false) => {
    const headers: Record<string, string> = raw ? { Accept: "application/vnd.github.raw" } : {};
    const anon = () => fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, { headers: { "User-Agent": "scoutline", ...(raw ? headers : { Accept: "application/vnd.github+json" }) }, signal: AbortSignal.timeout(15_000) });
    let r = tok ? await ghFetch(tok, path, { headers }) : await anon();
    // Javni repo: ako token ne važi ili ne vidi taj repo, pokušaj bez tokena
    if (tok && (r.status === 401 || r.status === 403 || r.status === 404)) r = await anon();
    if (!r.ok) throw new Error(r.status === 404 ? "Not found on GitHub — check the link (and that your token can see the repo)." : `GitHub: HTTP ${r.status}`);
    return r;
  };
  /** Svi fajlovi foldera skill-a (do 40 fajlova, svaki do 300 KB), kao base64. */
  const skillFolder = async (tok: string | null, src: { repo: string; ref: string | null; dir: string }, full = true) => {
    const ref = src.ref ?? ((await (await ghPublic(tok, `/repos/${src.repo}`)).json()) as { default_branch: string }).default_branch;
    const tree = (await (await ghPublic(tok, `/repos/${src.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`)).json()) as { tree: Array<{ path: string; type: string; size?: number }> };
    const prefix = src.dir ? `${src.dir}/` : "";
    const all = tree.tree.filter((x) => x.type === "blob" && x.path.startsWith(prefix));
    if (!all.some((b) => b.path.toLowerCase() === `${prefix}skill.md`)) throw new Error("No SKILL.md in that folder.");
    // Samo SKILL.md (za biblioteku) — bez ograničenja veličine foldera
    if (!full) {
      const sk = all.find((b) => b.path.toLowerCase() === `${prefix}skill.md`)!;
      const r = await ghPublic(tok, `/repos/${src.repo}/contents/${sk.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, true);
      const md = await r.text();
      return { ref, files: all.map((b) => ({ rel: b.path.slice(prefix.length), b64: "" })), md, fm: skillFrontmatter(md) };
    }
    const blobs = all.filter((x) => (x.size ?? 0) <= 300_000).sort((a, b) => Number(b.path.toLowerCase().endsWith("skill.md")) - Number(a.path.toLowerCase().endsWith("skill.md")));
    if (blobs.length > 60 || blobs.length < all.length) throw Object.assign(new Error(`This skill has ${all.length} files${blobs.length < all.length ? " (some over 300 KB)" : ""} — too big to copy from here. Use “Add to library” for SKILL.md, or copy the folder on GitHub.`), { tooBig: true });
    const files = await Promise.all(
      blobs.map(async (b) => {
        const r = await ghPublic(tok, `/repos/${src.repo}/contents/${b.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, true);
        return { rel: b.path.slice(prefix.length), b64: Buffer.from(await r.arrayBuffer()).toString("base64") };
      }),
    );
    const md = Buffer.from(files.find((f) => f.rel.toLowerCase() === "skill.md")!.b64, "base64").toString("utf8");
    return { ref, files, md, fm: skillFrontmatter(md) };
  };

  // GET /delivery/skills/catalog?source=owner/repo — katalog skill-ova iz repoa (keš 1 h)
  app.get("/delivery/skills/catalog", member, async (c) => {
    const source = (c.req.query("source") ?? DEFAULT_SKILL_SOURCES[0]!).trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(source)) return c.json({ error: "Use owner/repo." }, 400);
    const hit = catalogCache.get(source);
    if (hit && Date.now() - hit.at < 3_600_000) return c.json({ source, items: hit.items });
    const tok = (await ghToken(c)) || null;
    try {
      const repo = (await (await ghPublic(tok, `/repos/${source}`)).json()) as { default_branch: string };
      const tree = (await (await ghPublic(tok, `/repos/${source}/git/trees/${repo.default_branch}?recursive=1`)).json()) as { tree: Array<{ path: string; type: string }> };
      const dirs = tree.tree.filter((x) => x.type === "blob" && /(^|\/)SKILL\.md$/i.test(x.path) && !/^template\//i.test(x.path)).map((x) => x.path.replace(/\/?SKILL\.md$/i, "")).slice(0, 60);
      // SKILL.md: javni repo direktno sa raw.githubusercontent.com (brže, bez API limita), inače preko API-ja; najviše 6 odjednom
      const readSkill = async (dir: string) => {
        const rel = `${dir ? `${dir}/` : ""}SKILL.md`;
        if (!process.env.GITHUB_API_URL) {
          const raw = await fetch(`https://raw.githubusercontent.com/${source}/${repo.default_branch}/${rel.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
          if (raw?.ok) return raw.text();
        }
        return (await ghPublic(tok, `/repos/${source}/contents/${rel.split("/").map(encodeURIComponent).join("/")}?ref=${repo.default_branch}`, true)).text();
      };
      const items: Array<{ name: string; description: string; license: string | null; dir: string; files: number; url: string }> = [];
      for (let i = 0; i < dirs.length; i += 6) {
        const batch = await Promise.all(
          dirs.slice(i, i + 6).map(async (dir) => {
            const md = await readSkill(dir).catch(() => "");
            const fm = skillFrontmatter(md);
            const files = tree.tree.filter((x) => x.type === "blob" && x.path.startsWith(dir ? `${dir}/` : "")).length;
            return { name: fm.name ?? dir.split("/").pop() ?? source, description: (fm.description ?? "").slice(0, 400), license: fm.license ?? null, dir, files, url: `https://github.com/${source}/tree/${repo.default_branch}/${dir}` };
          }),
        );
        items.push(...batch);
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      catalogCache.set(source, { at: Date.now(), items });
      return c.json({ source, items });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // POST /delivery/skills/import { url } — skill sa GitHub-a u biblioteku (SKILL.md)
  app.post("/delivery/skills/import", member, async (c) => {
    const src = parseSkillUrl(String(((await c.req.json().catch(() => ({}))) as { url?: string }).url ?? ""));
    if (!src) return c.json({ error: "Paste a GitHub link to a skill folder or its SKILL.md." }, 400);
    try {
      const sk = await skillFolder((await ghToken(c)) || null, src, false);
      const name = sk.fm.name ?? (src.dir.split("/").pop() || src.repo.split("/")[1]!);
      const path = `.claude/skills/${slugOf(name)}/SKILL.md`;
      const existing = await getDb().select().from(skills).where(eq(skills.path, path)).limit(1);
      const values = { name, description: (sk.fm.description ?? "").slice(0, 300) || null, path, content: sk.md.slice(0, 20_000) };
      const [row] = existing[0]
        ? await getDb().update(skills).set({ ...values, updatedAt: new Date() }).where(eq(skills.id, existing[0].id)).returning()
        : await getDb().insert(skills).values({ ...values, createdBy: actor(c).name }).returning();
      return c.json({ skill: row, extraFiles: sk.files.length - 1, source: `https://github.com/${src.repo}/tree/${sk.ref}/${src.dir}` }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Koji skills već postoje u repou projekta
  app.get("/delivery/projects/:id/skills", member, async (c) => {
    const r = await repoFor(c);
    if (!r) return c.json({ error: "Project not found." }, 404);
    if (!r.full) return c.json({ repo: null, installed: [] });
    const tok = await ghToken(c);
    if (!tok) return c.json({ error: "Connect GitHub in Settings → Integrations." }, 400);
    const custom = await getDb().select({ path: skills.path }).from(skills);
    const paths = [...new Set([...BUILTIN_SKILLS.map((s) => s.path), ...custom.map((s) => s.path)])];
    const installed: string[] = [];
    await Promise.all(
      paths.map(async (p) => {
        const res = await ghFetch(tok, `/repos/${r.full}/contents/${p.split("/").map(encodeURIComponent).join("/")}`);
        if (res.ok) installed.push(p);
      }),
    );
    return c.json({ repo: r.full, installed });
  });

  // POST /delivery/projects/:id/skills/install { ids?: string[], files?: [{ path, content, name }] } → grana + commit-ovi + PR
  app.post("/delivery/projects/:id/skills/install", member, async (c) => {
    const r = await repoFor(c);
    if (!r) return c.json({ error: "Project not found." }, 404);
    if (!r.full) return c.json({ error: "Add a GitHub repo to the project first." }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { ids?: unknown; files?: unknown; remote?: unknown };
    const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const custom = ids.filter(isUuid).length ? await getDb().select().from(skills) : [];
    // Skill-ovi sa GitHub-a: ceo folder (SKILL.md, skripte, LICENSE) ide u .claude/skills/<ime>/
    const remote: Array<{ path: string; content: string; name: string; b64?: string }> = [];
    try {
      for (const url of (Array.isArray(b.remote) ? (b.remote as unknown[]) : []).filter((x): x is string => typeof x === "string").slice(0, 5)) {
        const src = parseSkillUrl(url);
        if (!src) return c.json({ error: `Not a GitHub skill link: ${url}` }, 400);
        const sk = await skillFolder((await ghToken(c)) || null, src);
        const name = sk.fm.name ?? (src.dir.split("/").pop() || "skill");
        for (const f of sk.files) remote.push({ path: `.claude/skills/${slugOf(name)}/${f.rel}`, content: "", b64: f.b64, name });
      }
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
    const files: Array<{ path: string; content: string; name: string; b64?: string }> = [
      ...BUILTIN_SKILLS.filter((s) => ids.includes(s.id)).map((s) => ({ path: s.path, content: s.content.replace("<one sentence: what this app does and for whom>", r.p.description?.split("\n")[0]?.slice(0, 200) || r.p.name), name: s.name })),
      ...custom.filter((s) => ids.includes(s.id)).map((s) => ({ path: s.path, content: s.content, name: s.name })),
      ...(Array.isArray(b.files) ? (b.files as Array<Record<string, unknown>>) : []).map((f) => skillInput({ ...f, name: f.name ?? f.path })).filter((v): v is { name: string; path: string; content: string; description: string | null } => !("error" in v)),
    ].slice(0, 20);
    files.push(...remote.slice(0, 80));
    if (!files.length) return c.json({ error: "Pick at least one skill." }, 400);
    const tok = await ghToken(c);
    try {
      const meta = await ghJson<{ default_branch: string }>(tok, `/repos/${r.full}`);
      const base = await ghJson<{ object: { sha: string } }>(tok, `/repos/${r.full}/git/ref/heads/${encodeURIComponent(meta.default_branch)}`);
      const branch = `scoutline/skills-${Date.now().toString(36)}`;
      await ghJson(tok, `/repos/${r.full}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }) });
      for (const f of files) {
        const enc = f.path.split("/").map(encodeURIComponent).join("/");
        const existing = await ghFetch(tok, `/repos/${r.full}/contents/${enc}?ref=${encodeURIComponent(branch)}`);
        const sha = existing.ok ? ((await existing.json()) as { sha?: string }).sha : undefined;
        await ghJson(tok, `/repos/${r.full}/contents/${enc}`, { method: "PUT", body: JSON.stringify({ message: `${sha ? "Update" : "Add"} ${f.path}`, content: f.b64 ?? Buffer.from(f.content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }) });
      }
      const pr = await ghJson<{ html_url: string; number: number }>(tok, `/repos/${r.full}/pulls`, {
        method: "POST",
        body: JSON.stringify({ title: `Add project skills (${new Set(files.map((f) => f.name)).size})`, head: branch, base: meta.default_branch, body: `Added from Scoutline by ${actor(c).name}:\n\n${[...new Set(files.map((f) => f.name))].map((n) => `- ${n}`).join("\n")}\n\nFiles: ${files.length}.` }),
      });
      return c.json({ ok: true, url: pr.html_url, number: pr.number }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // POST /delivery/projects/:id/skills/draft-agents — AI napravi AGENTS.md iz repoa (pregled pre PR-a)
  app.post("/delivery/projects/:id/skills/draft-agents", member, async (c) => {
    const r = await repoFor(c);
    if (!r?.full) return c.json({ error: "Add a GitHub repo to the project first." }, 400);
    const tok = await ghToken(c);
    try {
      const ctx = await repoContext(tok, r.full, "readme package json config scripts makefile docker agents claude contributing");
      const out = await runModel(
        getDb(),
        actor(c).id,
        "auto",
        "You write AGENTS.md files: a short, exact guide for AI coding agents. Sections: Project (1-2 sentences), Structure (code block: folder — purpose, only real folders), Commands (install/dev/test/build — only commands that really exist in the repo files), Rules (5-7 bullets: focused changes, tests, PR title with task key, no secrets, project-specific conventions you can see). Max 60 lines. Never invent files or commands. Output only the Markdown.",
        [{ role: "user", content: `Project: ${r.p.name}\n${r.p.description ?? ""}\n\n${ctx.text}` }],
        1200,
        "free-smart",
      );
      return c.json({ content: out.text.replace(/^```(?:markdown|md)?\n|\n```$/g, ""), model: out.model, tokens: out.tokensIn + out.tokensOut });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // ── Pokreni lokalno: linkovi + komande prepoznate iz repoa ──
  app.get("/delivery/projects/:id/dev", member, async (c) => {
    const r = await repoFor(c);
    if (!r?.full) return c.json({ error: "Add a GitHub repo to the project first." }, 400);
    const tok = await ghToken(c);
    const clone = `https://github.com/${r.full}.git`;
    const dir = r.full.split("/")[1]!;
    const links = {
      vscode: `vscode://vscode.git/clone?url=${encodeURIComponent(clone)}`,
      cursor: `cursor://vscode.git/clone?url=${encodeURIComponent(clone)}`,
      codespaces: `https://codespaces.new/${r.full}`,
      githubDev: `https://github.dev/${r.full}`,
      // Pokretanje u browseru (bez instalacije): StackBlitz radi Node i obične sajtove u samom browseru
      stackblitz: `https://stackblitz.com/github/${r.full}`,
      codesandbox: `https://codesandbox.io/p/github/${r.full}`,
      github: `https://github.com/${r.full}`,
    };
    const steps: Array<{ label: string; cmd: string }> = [{ label: "Clone", cmd: `git clone ${clone} && cd ${dir}` }];
    let stack = "unknown";
    let localUrl: string | null = null; // adresa posle pokretanja (dugme „Open localhost“)
    let note: string | null = null;
    try {
      const root = await ghJson<Array<{ name: string; type: string }>>(tok, `/repos/${r.full}/contents/`);
      const has = (n: string) => root.some((f) => f.name === n);
      if (has("package.json")) {
        const pkgRes = await ghFetch(tok, `/repos/${r.full}/contents/package.json`, { headers: { Accept: "application/vnd.github.raw" } });
        const pkg = pkgRes.ok ? ((await pkgRes.json().catch(() => ({}))) as { scripts?: Record<string, string>; packageManager?: string }) : {};
        const pm = pkg.packageManager?.startsWith("pnpm") || has("pnpm-lock.yaml") ? "pnpm" : pkg.packageManager?.startsWith("yarn") || has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
        stack = `Node.js (${pm})`;
        if (pm === "pnpm" && pkg.packageManager) steps.push({ label: "Enable pnpm", cmd: "corepack enable" });
        steps.push({ label: "Install", cmd: `${pm} install` });
        const run = (s: string) => (pm === "npm" ? `npm run ${s}` : `${pm} ${s}`);
        const sc = pkg.scripts ?? {};
        if (has(".env.example")) steps.push({ label: "Environment", cmd: "cp .env.example .env   # then fill in the values" });
        for (const s of ["dev", "start", "test", "build"]) if (sc[s]) steps.push({ label: s[0]!.toUpperCase() + s.slice(1), cmd: run(s) });
        // Uobičajen port po alatu iz dev/start skripte
        const devScript = `${sc.dev ?? ""} ${sc.start ?? ""}`;
        const port = /--port[ =](\d+)|-p (\d+)/.exec(devScript);
        localUrl = `http://localhost:${port?.[1] ?? port?.[2] ?? (/vite/.test(devScript) ? 5173 : /astro/.test(devScript) ? 4321 : /ng serve/.test(devScript) ? 4200 : 3000)}`;
        if (!sc.dev && !sc.start) localUrl = null;
      } else if (has("index.html") || root.some((f) => f.type === "dir" && (f.name === "public" || f.name === "site"))) {
        // Običan sajt (HTML/CSS/JS): dovoljan je mali lokalni server
        stack = "Static site";
        const dirArg = has("index.html") ? "." : root.some((f) => f.name === "public") ? "public" : "site";
        steps.push({ label: "Run", cmd: `npx --yes serve ${dirArg} -l 3000   # or: python3 -m http.server 3000${dirArg === "." ? "" : ` -d ${dirArg}`}` });
        localUrl = "http://localhost:3000";
      } else if (has("pyproject.toml") || has("requirements.txt")) {
        stack = "Python";
        steps.push({ label: "Virtual env", cmd: "python3 -m venv .venv && source .venv/bin/activate" });
        steps.push({ label: "Install", cmd: has("requirements.txt") ? "pip install -r requirements.txt" : "pip install -e ." });
        if (has("manage.py")) {
          steps.push({ label: "Run", cmd: "python manage.py runserver" });
          localUrl = "http://localhost:8000";
        }
      } else if (has("go.mod")) {
        stack = "Go";
        steps.push({ label: "Run", cmd: "go run ." });
      } else if (has("Gemfile")) {
        stack = "Ruby";
        steps.push({ label: "Install", cmd: "bundle install" });
      } else if (root.every((f) => /^(readme|license|\.github|\.gitignore)/i.test(f.name))) {
        stack = "Empty repo";
        note = "Nothing to run yet — hand a task to Claude or Codex (or push code), then come back here.";
      }
      if (has("docker-compose.yml") || has("compose.yaml")) steps.push({ label: "Or with Docker", cmd: "docker compose up" });
      return c.json({ repo: r.full, stack, links, steps, localUrl, note, devcontainer: has(".devcontainer") });
    } catch (e) {
      return c.json({ repo: r.full, stack, links, steps, error: (e as Error).message });
    }
  });

  // ── Pokreni ceo projekat lokalno (FE + BE…): jedna komanda za sve repoe projekta ──
  // Klonira ili osveži svaki repo, instalira zavisnosti i pokrene sve zajedno (concurrently, označeni logovi).
  app.get("/delivery/projects/:id/dev-all", member, async (c) => {
    const id = c.req.param("id")!;
    const [p] = /^[0-9a-f-]{36}$/i.test(id) ? await getDb().select().from(projects).where(eq(projects.id, id)).limit(1) : [];
    if (!p) return c.json({ error: "Project not found." }, 404);
    const names = await projectRepoNames(getDb(), p);
    if (!names.length) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const extra = await getDb().select().from(projectRepos).where(eq(projectRepos.projectId, p.id));
    const labelOf = (full: string) => extra.find((e) => e.repoUrl.toLowerCase().endsWith(`/${full.toLowerCase()}`))?.label ?? null;
    const tok = await ghToken(c);
    let staticPort = 3000;
    const parts = await Promise.all(
      names.map(async (full) => {
        const dir = full.split("/")[1]!;
        const base = { repo: full, dir, label: labelOf(full) ?? (names.length === 1 ? dir : full === names[0] ? "app" : dir), stack: "unknown", start: null as string | null, url: null as string | null };
        try {
          const root = await ghJson<Array<{ name: string; type: string }>>(tok, `/repos/${full}/contents/`);
          const has = (n: string) => root.some((f) => f.name === n);
          if (has("package.json")) {
            const res = await ghFetch(tok, `/repos/${full}/contents/package.json`, { headers: { Accept: "application/vnd.github.raw" } });
            const pkg = res.ok ? ((await res.json().catch(() => ({}))) as { scripts?: Record<string, string>; packageManager?: string }) : {};
            const pm = pkg.packageManager?.startsWith("pnpm") || has("pnpm-lock.yaml") ? "pnpm" : pkg.packageManager?.startsWith("yarn") || has("yarn.lock") ? "yarn" : "npm";
            const sc = pkg.scripts ?? {};
            const script = sc.dev ? "dev" : sc.start ? "start" : null;
            const env = has(".env.example") ? "([ -f .env ] || cp .env.example .env) && " : "";
            const pre = pm === "pnpm" ? "corepack enable && " : "";
            const devScript = `${sc.dev ?? ""} ${sc.start ?? ""}`;
            const port = /--port[ =](\d+)|-p (\d+)/.exec(devScript);
            return {
              ...base,
              stack: `Node.js (${pm})`,
              start: script ? `${pre}${env}${pm} install && ${pm === "npm" ? `npm run ${script}` : `${pm} ${script}`}` : null,
              url: script ? `http://localhost:${port?.[1] ?? port?.[2] ?? (/vite/.test(devScript) ? 5173 : /astro/.test(devScript) ? 4321 : 3000)}` : null,
            };
          }
          if (has("index.html") || has("public")) {
            const port = staticPort++;
            const d = has("index.html") ? "." : "public";
            return { ...base, stack: "Static site", start: `npx --yes serve ${d} -l ${port}`, url: `http://localhost:${port}` };
          }
          if (has("requirements.txt") || has("pyproject.toml")) {
            const run = has("manage.py") ? "python manage.py runserver" : has("main.py") ? "python main.py" : has("app.py") ? "python app.py" : null;
            return { ...base, stack: "Python", start: run ? `python3 -m venv .venv && . .venv/bin/activate && pip install -q ${has("requirements.txt") ? "-r requirements.txt" : "-e ."} && ${run}` : null, url: has("manage.py") ? "http://localhost:8000" : null };
          }
          if (has("go.mod")) return { ...base, stack: "Go", start: "go run ." };
          if (has("docker-compose.yml") || has("compose.yaml")) return { ...base, stack: "Docker", start: "docker compose up" };
          return { ...base, stack: root.every((f) => /^(readme|license|\.github|\.gitignore)/i.test(f.name)) ? "Empty repo" : "unknown" };
        } catch (e) {
          return { ...base, stack: "unreachable", error: (e as Error).message };
        }
      }),
    );
    const runnable = parts.filter((x) => x.start);
    const folder = `$HOME/scoutline/${p.key}`;
    const q = (x: string) => `"${x.replace(/(["\\$`])/g, "\\$1")}"`;
    const lines = [
      "#!/usr/bin/env bash",
      `# Scoutline — ${p.name}: preuzme i pokrene sve delove projekta lokalno`,
      "set -e",
      `mkdir -p ${folder} && cd ${folder}`,
      `for r in ${names.join(" ")}; do d="\${r#*/}"; if [ -d "$d/.git" ]; then git -C "$d" pull --ff-only; else git clone "https://github.com/$r.git"; fi; done`,
    ];
    if (runnable.length === 1) lines.push(`cd ${runnable[0]!.dir} && ${runnable[0]!.start}`);
    else if (runnable.length > 1)
      lines.push(`npx --yes concurrently -k -n ${q(runnable.map((x) => x.label.replace(/[ ,]/g, "-")).join(","))} -c "magenta,cyan,green,yellow" ${runnable.map((x) => q(`cd ${x.dir} && ${x.start}`)).join(" ")}`);
    return c.json({ project: p.key, folder, parts, script: lines.join("\n"), canRun: runnable.length > 0 });
  });

  // ── Figma u tasku ──
  app.post("/delivery/issues/:iid/figma", member, async (c) => {
    const iid = c.req.param("iid")!;
    if (!isUuid(iid)) return c.json({ error: "Task not found." }, 404);
    const url = str(((await c.req.json().catch(() => ({}))) as { url?: unknown }).url, 600);
    const f = figmaParse(url);
    if (!f) return c.json({ error: "Paste a Figma link (figma.com/design/… or /file/…)." }, 400);
    let title = "Figma design";
    const tok = await figmaToken(c);
    if (tok) {
      try {
        const res = await fetch(f.node ? `https://api.figma.com/v1/files/${f.key}/nodes?ids=${encodeURIComponent(f.node)}` : `https://api.figma.com/v1/files/${f.key}?depth=1`, { headers: { "X-Figma-Token": tok }, signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          const d = (await res.json()) as { name?: string; nodes?: Record<string, { document?: { name?: string } }> };
          title = (f.node ? d.nodes?.[f.node]?.document?.name : undefined) ?? d.name ?? title;
          if (f.node && d.name) title = `${d.name} · ${title}`;
        }
      } catch {
        /* bez naziva — link i dalje radi */
      }
    }
    await getDb()
      .insert(issueLinks)
      .values({ issueId: iid, kind: "figma", repo: f.key, number: hash31(f.node ?? "file"), url, title: title.slice(0, 200), state: f.node })
      .onConflictDoUpdate({ target: [issueLinks.issueId, issueLinks.kind, issueLinks.repo, issueLinks.number], set: { url, title: title.slice(0, 200), updatedAt: new Date() } });
    await getDb().insert(issueEvents).values({ issueId: iid, type: "figma", data: { url, title }, actor: actor(c).name });
    return c.json({ ok: true, title });
  });
  app.delete("/delivery/figma/:lid", member, async (c) => {
    const lid = c.req.param("lid")!;
    if (!isUuid(lid)) return c.json({ error: "Not found." }, 404);
    await getDb().delete(issueLinks).where(and(eq(issueLinks.id, lid), eq(issueLinks.kind, "figma")));
    return c.json({ ok: true });
  });
  // GET /delivery/figma/:lid/image — sličica dizajna (Figma API, keš 1 h)
  app.get("/delivery/figma/:lid/image", g.readGuard, async (c) => {
    const lid = c.req.param("lid")!;
    if (!isUuid(lid)) return c.json({ url: null });
    const hit = figmaImageCache.get(lid);
    if (hit && Date.now() - hit.at < 3_600_000) return c.json({ url: hit.url });
    const [l] = await getDb().select().from(issueLinks).where(and(eq(issueLinks.id, lid), eq(issueLinks.kind, "figma"))).limit(1);
    const tok = l ? await figmaToken(c) : "";
    if (!l || !tok) return c.json({ url: null, reason: tok ? "not found" : "Add a Figma token in Settings → Integrations to see previews." });
    try {
      let img: string | null = null;
      if (l.state) {
        const res = await fetch(`https://api.figma.com/v1/images/${l.repo}?ids=${encodeURIComponent(l.state)}&format=png&scale=1`, { headers: { "X-Figma-Token": tok }, signal: AbortSignal.timeout(20_000) });
        if (res.ok) img = ((await res.json()) as { images?: Record<string, string | null> }).images?.[l.state] ?? null;
      } else {
        const res = await fetch(`https://api.figma.com/v1/files/${l.repo}?depth=1`, { headers: { "X-Figma-Token": tok }, signal: AbortSignal.timeout(20_000) });
        if (res.ok) img = ((await res.json()) as { thumbnailUrl?: string }).thumbnailUrl ?? null;
      }
      figmaImageCache.set(lid, { at: Date.now(), url: img });
      return c.json({ url: img });
    } catch (e) {
      return c.json({ url: null, reason: (e as Error).message });
    }
  });

  return app;
}


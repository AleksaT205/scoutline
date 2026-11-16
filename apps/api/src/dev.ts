import { Hono } from "hono";

/**
 * Faza 7 — taskovi iz dashboard-a = GitHub Issues.
 * GITHUB_TOKEN: fine-grained token samo za ovaj repo (Issues: read & write).
 * GITHUB_REPO:  "vlasnik/repo".
 * "Let Claude do it" doda @claude u task → GitHub akcija (.github/workflows/claude.yml) uradi posao preko Claude pretplate.
 */
const TOKEN = () => process.env.GITHUB_TOKEN ?? "";
const REPO = () => process.env.GITHUB_REPO ?? "";

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${REPO()}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "scoutline",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`GitHub: ${data.message ?? `HTTP ${res.status}`}`);
  return data;
}

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  assignee: { login: string } | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

const toTask = (i: GhIssue) => ({
  number: i.number,
  title: i.title,
  state: i.state,
  url: i.html_url,
  labels: i.labels.map((l) => ({ name: l.name, color: l.color })),
  assignee: i.assignee?.login ?? null,
  comments: i.comments,
  claude: /@claude/i.test(i.body ?? "") || i.labels.some((l) => l.name === "claude"),
  createdAt: i.created_at,
  updatedAt: i.updated_at,
  closedAt: i.closed_at,
});

export function devTasks() {
  const app = new Hono();

  app.get("/", async (c) => {
    if (!TOKEN() || !REPO()) return c.json({ configured: false, repo: REPO() || null, tasks: [] });
    const state = c.req.query("state") === "closed" ? "closed" : "open";
    try {
      const issues = await gh<GhIssue[]>(`/issues?state=${state}&per_page=100&sort=updated`);
      return c.json({ configured: true, repo: REPO(), tasks: issues.filter((i) => !i.pull_request).map(toTask) });
    } catch (e) {
      return c.json({ configured: true, repo: REPO(), tasks: [], error: (e as Error).message }, 502);
    }
  });

  app.post("/", async (c) => {
    if (!TOKEN() || !REPO()) return c.json({ error: "GitHub isn't connected: set GITHUB_TOKEN and GITHUB_REPO on the server." }, 400);
    const input = await c.req.json<{ title?: string; body?: string; type?: "task" | "bug"; claude?: boolean }>().catch(() => null);
    const title = input?.title?.trim();
    if (!title) return c.json({ error: "Title is required." }, 400);
    const body = [input?.body?.trim() ?? "", input?.claude ? "\n@claude please implement this task, run `pnpm typecheck && pnpm test && pnpm build`, and open a PR." : ""]
      .join("\n")
      .trim();
    try {
      const issue = await gh<GhIssue>("/issues", {
        method: "POST",
        body: JSON.stringify({ title: title.slice(0, 200), body, labels: [input?.type === "bug" ? "bug" : "task"] }),
      });
      return c.json({ task: toTask(issue) }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // "Ask Claude" na postojećem tasku → komentar sa @claude
  app.post("/:number/claude", async (c) => {
    if (!TOKEN() || !REPO()) return c.json({ error: "GitHub isn't connected." }, 400);
    const n = Number(c.req.param("number"));
    if (!Number.isInteger(n) || n <= 0) return c.json({ error: "Invalid task number." }, 400);
    const input = await c.req.json<{ note?: string }>().catch(() => null);
    try {
      await gh(`/issues/${n}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `@claude ${input?.note?.trim() || "please implement this task, run `pnpm typecheck && pnpm test && pnpm build`, and open a PR."}` }),
      });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  return app;
}

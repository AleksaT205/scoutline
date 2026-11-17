import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AGENT_WORKFLOW, autoEffort, parseResult } from "./agents.js";
import { startFakeGitHub } from "./test/fake-github.js";

// ── Bez baze: delovi koji moraju uvek da važe ──
describe("Claude workflow", () => {
  it("never adds AI attribution to git", () => {
    expect(AGENT_WORKFLOW).toContain(`--settings '{"includeCoAuthoredBy":false}'`);
    expect(AGENT_WORKFLOW).not.toMatch(/Co-Authored-By|Generated with|anthropics\/claude-code-action/i);
    // commit pod imenom osobe koja je pokrenula rad
    expect(AGENT_WORKFLOW).toContain('git config user.name "${AN:-$GITHUB_ACTOR}"');
  });
  it("only gets write access to code, not issues or PRs", () => {
    const perms = /permissions:\n((?: {2}.+\n)+)/.exec(AGENT_WORKFLOW)?.[1] ?? "";
    expect(perms.trim()).toBe("contents: write");
  });
  it("is found by Scoutline through its run name", () => {
    expect(AGENT_WORKFLOW).toContain("run-name: agent ${{ inputs.id }}");
  });
});

describe("result from the job log", () => {
  it("reads SCOUTLINE_RESULT", () => {
    const res = { ok: true, text: "Gotovo — pomerio sam logo.", cost: 0.2, turns: 4, ms: 1000, in: 10, out: 2, steps: [], commits: ["Move logo"] };
    const log = `2026-01-01T00:00:00Z noise\n2026-01-01T00:00:01Z SCOUTLINE_RESULT ${Buffer.from(JSON.stringify(res)).toString("base64")}\n`;
    expect(parseResult(log)).toEqual(res);
  });
  it("returns null for a log without a result or with garbage", () => {
    expect(parseResult("nothing here")).toBeNull();
    expect(parseResult("SCOUTLINE_RESULT !!!")).toBeNull();
  });
});

describe("auto effort", () => {
  it("questions are low, redesigns are high, the rest medium", () => {
    expect(autoEffort("gde je logika za login?")).toBe("low");
    expect(autoEffort("redizajn cele početne strane")).toBe("high");
    expect(autoEffort("dodaj dugme za kontakt u footer")).toBe("medium");
  });
});

// ── Ceo tok sa bazom i lažnim GitHub-om (TEST_DATABASE_URL; u CI-ju je uključeno) ──
const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("Build with Claude flow", () => {
  let gh: Awaited<ReturnType<typeof startFakeGitHub>>;
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let db: import("@radar/db").Db;
  let projectId = "";
  const TOKEN = "test-team-token";
  const call = async (path: string, body?: unknown) => {
    const r = await app.request(path, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  };
  const runs = () => call(`/delivery/projects/${projectId}/agent/runs?repo=acme/app`);

  beforeAll(async () => {
    gh = await startFakeGitHub();
    Object.assign(process.env, { GITHUB_API_URL: gh.url, GITHUB_TOKEN: "fake", API_TOKEN: TOKEN, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test", DATABASE_URL: TEST_DB });
    const { createDb, projects } = await import("@radar/db");
    db = createDb(TEST_DB);
    await (await import("@radar/db")).migrateLocked(db, fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)), TEST_DB);
    const { eq } = await import("drizzle-orm");
    await db.delete(projects).where(eq(projects.key, "TST"));
    const [p] = await db.insert(projects).values({ key: "TST", name: "Test project", repoUrl: "https://github.com/acme/app", status: "active" }).returning();
    projectId = p!.id;
    const { createApp } = await import("./app.js");
    app = createApp(() => db);
  });
  afterAll(async () => {
    await gh?.close();
  });
  beforeEach(() => {
    gh.state.dispatches.length = 0;
  });

  it("starts work on a temporary branch, commits under the person's name", async () => {
    const r = await call(`/delivery/projects/${projectId}/agent/runs?repo=acme/app`, { prompt: "TST-3: pomeri logo ulevo", effort: "low" });
    expect(r.status).toBe(201);
    const d = gh.state.dispatches[0]!;
    expect(d.inputs.branch).toMatch(/^wip\//);
    expect(d.inputs.author_email).toBe("7+dev@users.noreply.github.com");
    const task = Buffer.from(d.inputs.task!, "base64").toString("utf8");
    expect(task).toContain("never mention Claude, AI");
    expect(task).toContain("Don't push, don't open pull requests");
    expect(gh.state.secret).toBeTruthy(); // pretplata osobe koja pokreće rad
  });

  it("when done: renames the branch, opens the PR under the person's token, saves the answer", async () => {
    await call(`/delivery/projects/${projectId}/agent/runs?repo=acme/app`, { prompt: "TST-4: dodaj kontakt formu" });
    const d = gh.finishLast({ commits: ["Add contact form", "Style the form"], text: "Dodao sam formu." });
    const list = await runs();
    const run = list.json.runs.find((x: { title: string }) => x.title.startsWith("TST-4"));
    expect(run.status).toBe("pr_open");
    expect(run.branch).toBe("feature/tst-4-add-contact-form");
    expect(gh.state.renames).toContainEqual([d.inputs.branch, "feature/tst-4-add-contact-form"]);
    const pr = gh.state.pulls.find((x) => x.head.ref === "feature/tst-4-add-contact-form")!;
    expect(pr.title).toBe("[TST-4] Add contact form");
    expect(pr.body).toContain("- Style the form");
    expect(pr.body).not.toMatch(/claude|generated/i);
    const thread = await call(`/delivery/projects/${projectId}/agent/runs/${run.id}?repo=acme/app`);
    expect(thread.json.messages.at(-1).body).toBe("Dodao sam formu.");
    expect(thread.json.messages.at(-1).meta.commits).toEqual(["Add contact form", "Style the form"]);
  });

  it("a follow-up keeps working on the open PR's branch and never renames it (renaming would close the PR)", async () => {
    const start = await call(`/delivery/projects/${projectId}/agent/runs?repo=acme/app`, { prompt: "TST-5: promeni boju dugmeta" });
    gh.finishLast({ commits: ["Change button color"] });
    await runs();
    const renamesBefore = gh.state.renames.length;
    const reply = await call(`/delivery/projects/${projectId}/agent/runs/${start.json.id}/reply?repo=acme/app`, { text: "malo tamnije" });
    expect(reply.status).toBe(200);
    expect(gh.state.dispatches.at(-1)!.inputs.branch).toBe("feature/tst-5-change-button-color");
    // dok radi, nova poruka se odbija
    expect((await call(`/delivery/projects/${projectId}/agent/runs/${start.json.id}/reply?repo=acme/app`, { text: "još" })).status).toBe(409);
    gh.finishLast({ commits: ["Darken button"] });
    const thread = await call(`/delivery/projects/${projectId}/agent/runs/${start.json.id}?repo=acme/app`);
    expect(gh.state.renames.length).toBe(renamesBefore);
    expect(thread.json.pr.state).toBe("open");
    expect(gh.state.pulls.filter((x) => x.head.ref === "feature/tst-5-change-button-color")).toHaveLength(1);
  });

  it("a question without changes opens no PR", async () => {
    const r = await call(`/delivery/projects/${projectId}/agent/runs?repo=acme/app`, { prompt: "gde je logika za login?" });
    gh.finishLast({ commits: [], text: "U src/auth/login.ts." });
    const thread = await call(`/delivery/projects/${projectId}/agent/runs/${r.json.id}?repo=acme/app`);
    expect(thread.json.pr).toBeNull();
    expect(thread.json.run.status).toBe("replied");
  });
});

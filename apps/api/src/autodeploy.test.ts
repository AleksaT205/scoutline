import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Lažni GitHub (commit + CI) i lažni Coolify (deploy) — auto-deploy sme da pokrene Redeploy samo kad CI prođe
const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("auto-deploy", () => {
  let server: Server;
  let db: import("@radar/db").Db;
  let tick: (db: import("@radar/db").Db) => Promise<void>;
  const S = { sha: "abc1234def", checks: [] as Array<{ name: string; status: string; conclusion: string | null }>, deploys: 0, date: new Date(Date.now() - 3600_000).toISOString() };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const p = new URL(req.url ?? "/", "http://x").pathname;
      const send = (code: number, data: unknown) => (res.writeHead(code, { "Content-Type": "application/json" }), res.end(JSON.stringify(data)));
      if (p === "/repos/acme/scoutline/commits/main") return send(200, { sha: S.sha, commit: { message: "Add feature\n\nbody", committer: { date: S.date } } });
      if (p === `/repos/acme/scoutline/commits/${S.sha}/check-runs`) return send(200, { check_runs: S.checks });
      if (p === "/api/v1/deploy") {
        S.deploys++;
        return send(200, { deployments: [{ message: "queued" }] });
      }
      send(404, { message: "Not Found" });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    Object.assign(process.env, { GITHUB_API_URL: url, GITHUB_TOKEN: "fake", COOLIFY_API_URL: url, COOLIFY_API_TOKEN: "t", COOLIFY_RESOURCE_UUID: "u1", DEPLOY_REPO: "acme/scoutline", SOURCE_COMMIT: "old0000" });
    const { createDb } = await import("@radar/db");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    db = createDb(TEST_DB);
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)) });
    tick = (await import("./autodeploy.js")).autodeployTick;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
  beforeEach(async () => {
    const { settings } = await import("@radar/db");
    const { eq } = await import("drizzle-orm");
    await db.delete(settings).where(eq(settings.key, "autodeploy"));
    S.deploys = 0;
  });

  it("waits while CI is running", async () => {
    S.checks = [{ name: "check", status: "in_progress", conclusion: null }];
    await tick(db);
    expect(S.deploys).toBe(0);
  });
  it("does not deploy when CI failed", async () => {
    S.checks = [{ name: "check", status: "completed", conclusion: "failure" }];
    await tick(db);
    expect(S.deploys).toBe(0);
  });
  it("deploys once when CI passed", async () => {
    S.checks = [{ name: "check", status: "completed", conclusion: "success" }];
    await tick(db);
    await tick(db);
    expect(S.deploys).toBe(1);
  });
  it("does nothing when that commit is already running", async () => {
    S.checks = [{ name: "check", status: "completed", conclusion: "success" }];
    process.env.SOURCE_COMMIT = S.sha;
    await tick(db);
    expect(S.deploys).toBe(0);
    process.env.SOURCE_COMMIT = "old0000";
  });
});

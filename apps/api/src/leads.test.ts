import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// Jedan lead po ID-ju i linkovi u obaveštenjima koji vode baš na taj lead (TEST_DATABASE_URL; u CI-ju je uključeno)
const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("lead by id + notification links", () => {
  const TOKEN = "test-team-token";
  const stamp = randomUUID().slice(0, 8);
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let freshId = "";
  let followId = "";
  const get = async (path: string, auth = true) => {
    const r = await app.request(path, { headers: auth ? { Authorization: `Bearer ${TOKEN}` } : {} });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };

  beforeAll(async () => {
    Object.assign(process.env, { API_TOKEN: TOKEN, DATABASE_URL: TEST_DB });
    const { createDb, leads, rawItems, sources, migrateLocked } = await import("@radar/db");
    const db = createDb(TEST_DB);
    await migrateLocked(db, fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)), TEST_DB);
    const sourceId = `test-leads-${stamp}`;
    await db.insert(sources).values({ id: sourceId, name: "Test source", kind: "api" });
    const raw = async (title: string) => {
      const url = `https://example.test/${stamp}/${encodeURIComponent(title)}`;
      const [r] = await db.insert(rawItems).values({ sourceId, url, urlHash: `${stamp}-${title}`, title, companyName: "Test Co", postedAt: new Date() }).returning();
      return r!.id;
    };
    const [fresh] = await db
      .insert(leads)
      .values({ rawItemId: await raw(`Fresh tender ${stamp}`), score: 100, aiScore: 100, leadType: "tender", status: "new" })
      .returning();
    const [follow] = await db
      .insert(leads)
      .values({ rawItemId: await raw(`Follow up ${stamp}`), score: 40, aiScore: 40, leadType: "project", status: "contacted", followUpAt: new Date(Date.now() - 1000) })
      .returning();
    freshId = fresh!.id;
    followId = follow!.id;
    const { createApp } = await import("./app.js");
    app = createApp(() => db);
  });

  it("returns one lead by id", async () => {
    const r = await get(`/leads/${freshId}`);
    expect(r.status).toBe(200);
    expect((r.body.lead as { id: string; title: string }).id).toBe(freshId);
    expect((r.body.lead as { title: string }).title).toBe(`Fresh tender ${stamp}`);
  });
  it("answers 404 for an unknown or malformed id", async () => {
    expect((await get(`/leads/${randomUUID()}`)).status).toBe(404);
    expect((await get("/leads/not-an-id")).status).toBe(404);
  });
  it("keeps the other lead routes working", async () => {
    expect((await get(`/leads/${freshId}/events`)).status).toBe(200);
  });
  it("links lead and follow-up notifications to that lead", async () => {
    const r = await get("/notifications");
    expect(r.status).toBe(200);
    const items = r.body.items as Array<{ id: string; kind: string; href: string }>;
    expect(items.find((n) => n.id === `lead:${freshId}`)?.href).toBe(`#/?lead=${freshId}`);
    expect(items.find((n) => n.id === `follow:${followId}`)?.href).toBe(`#/?lead=${followId}`);
  });
});

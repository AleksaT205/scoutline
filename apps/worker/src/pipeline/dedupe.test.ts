import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Connector, RawItem } from "../connectors/types.js";

// Isti tender iz dva izvora → drugi lead je sakriven i povezan sa prvim (TEST_DATABASE_URL; u CI-ju je uključeno)
const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("duplicates across sources", () => {
  let db: import("@radar/db").Db;
  const stamp = Date.now();
  const item = (url: string, title: string): RawItem => ({ externalId: url, url, title, body: "Development of an online booking platform for municipal sports centres, web and mobile.", companyName: "City of Testville", location: "Ireland", salaryText: null, postedAt: new Date(), leadType: "tender", country: "IE" });
  const conn = (id: string, items: RawItem[]): Connector => ({ id, name: id, kind: "api", intervalMinutes: 60, defaultType: "tender", curated: true, fetch: async () => items }) as Connector;

  beforeAll(async () => {
    const { createDb } = await import("@radar/db");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    db = createDb(TEST_DB);
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url)) });
  });

  it("hides the second copy and links it to the first", async () => {
    const { ingest, registerSources } = await import("./run.js");
    const { leads, rawItems } = await import("@radar/db");
    const { eq } = await import("drizzle-orm");
    const a = conn(`test-a-${stamp}`, [item(`https://a.example/${stamp}`, `Ireland – Booking platform for municipal sports centres ${stamp}`)]);
    const b = conn(`test-b-${stamp}`, [item(`https://b.example/${stamp}`, `IRELAND - Booking Platform for Municipal Sports Centres ${stamp} – 2026/S 221-712345`)]);
    await registerSources(db, [a, b]);
    await ingest(db, a);
    await ingest(db, b);
    const first = (await db.select({ id: leads.id, status: leads.status, dup: leads.duplicateOf }).from(leads).innerJoin(rawItems, eq(leads.rawItemId, rawItems.id)).where(eq(rawItems.url, `https://a.example/${stamp}`)))[0]!;
    const second = (await db.select({ id: leads.id, status: leads.status, dup: leads.duplicateOf }).from(leads).innerJoin(rawItems, eq(leads.rawItemId, rawItems.id)).where(eq(rawItems.url, `https://b.example/${stamp}`)))[0]!;
    expect(first.status).toBe("new");
    expect(first.dup).toBeNull();
    expect(second.status).toBe("hidden");
    expect(second.dup).toBe(first.id);
  });
});

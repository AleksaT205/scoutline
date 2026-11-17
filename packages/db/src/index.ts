import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export * from "./integrations.js";
export { schema };

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL nije podešen");
  const client = postgres(url, { max: 5 });
  return drizzle(client, { schema });
}
export type Db = ReturnType<typeof createDb>;

/**
 * Migracije pod zaključavanjem (pg advisory lock): kad više procesa krene istovremeno (testovi API-ja i worker-a
 * u CI-ju, ili api + worker pri startu), samo jedan primenjuje migracije, ostali sačekaju.
 */
export async function migrateLocked(db: Db, migrationsFolder: string, url = process.env.DATABASE_URL) {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const lock = postgres(url!, { max: 1, onnotice: () => undefined });
  try {
    await lock`select pg_advisory_lock(727272)`;
    await migrate(db, { migrationsFolder });
  } finally {
    await lock`select pg_advisory_unlock(727272)`.catch(() => undefined);
    await lock.end();
  }
}
export * from "./github.js";

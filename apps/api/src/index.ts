import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@radar/db";
import { createApp } from "./app.js";
import { startWatchdog } from "./monitor.js";
import { startAgentPoller } from "./agents.js";
import { refreshRuntime } from "./runtime.js";
import { ensureEnvOwner } from "./auth.js";

// Migracije baze se pokreću pri svakom startu (bezbedno — primenjuje samo nove).
// src/ i dist/ su na istoj dubini, pa ista relativna putanja radi u razvoju i posle build-a.
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

const db = createDb();
await migrate(db, { migrationsFolder });
console.log("baza: migracije primenjene");
// Owner nalog iz env-a (OWNER_EMAIL / OWNER_PASSWORD), ako je podešen
await ensureEnvOwner(db).catch((e) => console.warn("[owner]", (e as Error).message));

// Integracije (Settings → Integrations, inače env) — osvežavaju se na minut
await refreshRuntime(db).catch((e) => console.warn("[integrations]", (e as Error).message));
setInterval(() => void refreshRuntime(db).catch(() => undefined), 60_000);

const app = createApp(() => db);
startWatchdog(() => db);
startAgentPoller(() => db);
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`radar-api na http://localhost:${port}`));

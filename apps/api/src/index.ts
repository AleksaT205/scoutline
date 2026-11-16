import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@radar/db";
import { createApp } from "./app.js";

// Migracije baze se pokreću pri svakom startu (bezbedno — primenjuje samo nove).
// src/ i dist/ su na istoj dubini, pa ista relativna putanja radi u razvoju i posle build-a.
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

const db = createDb();
await migrate(db, { migrationsFolder });
console.log("baza: migracije primenjene");

const app = createApp(() => db);
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`radar-api na http://localhost:${port}`));

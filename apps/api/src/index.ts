import { serve } from "@hono/node-server";
import { createDb, type Db } from "@radar/db";
import { createApp } from "./app.js";

let db: Db | undefined;
const app = createApp(() => (db ??= createDb()));
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`radar-api na http://localhost:${port}`));

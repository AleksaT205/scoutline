import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { clients, type Db } from "@radar/db";

/**
 * AI Router — Faza 2.
 *  - /llm/v1/*         javni, OpenAI/Anthropic-kompatibilan endpoint za aplikacije klijenata (ključ klijenta)
 *  - /router/*         upravljanje klijentima i statistika (timska lozinka)
 * Ključeve, budžete i beleženje potrošnje radi LiteLLM; mi čitamo njegove tabele iz iste baze.
 */

const LITELLM_URL = process.env.LITELLM_URL ?? "http://localhost:4000";
const LITELLM_MASTER = process.env.LITELLM_KEY ?? "";
// Cena "premium" modela za poređenje (USD po 1M tokena, nivo GPT-4o/Claude Sonnet klase)
const BASE_IN = Number(process.env.BASELINE_INPUT_PER_M ?? 2.5);
const BASE_OUT = Number(process.env.BASELINE_OUTPUT_PER_M ?? 10);
const MODES = ["auto", "fast", "smart"] as const;
type Mode = (typeof MODES)[number];

/** "auto" → kratki, jednostavni zahtevi idu na brzi/jeftini model, ostalo na pametniji. */
export function pickModel(body: { messages?: Array<{ content?: unknown }>; system?: unknown; tools?: unknown[] }): "fast" | "smart" {
  const text = [body.system, ...(body.messages ?? []).map((m) => m.content)]
    .map((c) => (typeof c === "string" ? c : JSON.stringify(c ?? "")))
    .join("\n");
  const heavy =
    text.length > 4000 ||
    (body.tools?.length ?? 0) > 0 ||
    /```|\b(refactor|debug|stack trace|architecture|analy[sz]e|step by step|prove|contract|legal)\b/i.test(text);
  return heavy ? "smart" : "fast";
}

async function litellm<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${LITELLM_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM_MASTER}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } | string };
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(`LiteLLM ${path}: ${msg ?? `HTTP ${res.status}`}`);
  }
  return data;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
export const baseline = (pin: number, pout: number) => (pin / 1e6) * BASE_IN + (pout / 1e6) * BASE_OUT;

/** Javni proxy: /llm/v1/chat/completions, /llm/v1/messages, /llm/v1/models … */
export function llmProxy() {
  const app = new Hono();
  app.all("/v1/*", async (c) => {
    const path = c.req.path.replace(/^\/llm/, "");
    const headers = new Headers();
    for (const h of ["authorization", "x-api-key", "content-type", "anthropic-version", "anthropic-beta"]) {
      const v = c.req.header(h);
      if (v) headers.set(h, v);
    }
    // Anthropic SDK šalje ključ u x-api-key — LiteLLM ga prima kao Bearer
    if (!headers.has("authorization") && headers.has("x-api-key")) headers.set("authorization", `Bearer ${headers.get("x-api-key")}`);

    let body: string | undefined;
    let routedTo: string | null = null;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      body = await c.req.text();
      if (/\/(chat\/completions|messages|completions)$/.test(path)) {
        try {
          const json = JSON.parse(body) as { model?: string };
          if (!json.model || json.model === "auto") {
            routedTo = pickModel(json as Parameters<typeof pickModel>[0]);
            json.model = routedTo;
            body = JSON.stringify(json);
          }
        } catch {
          /* nije JSON — prosledi kako jeste */
        }
      }
    }
    const res = await fetch(`${LITELLM_URL}${path}${new URL(c.req.url).search}`, { method: c.req.method, headers, body });
    const out = new Headers();
    for (const h of ["content-type", "cache-control", "x-litellm-response-cost", "x-litellm-model-id"]) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    if (routedTo) out.set("x-scoutline-routed-to", routedTo);
    return new Response(res.body, { status: res.status, headers: out });
  });
  return app;
}

/** Upravljanje klijentima i statistika — zaštićeno timskom lozinkom (proverava se u app.ts). */
export function routerAdmin(getDb: () => Db) {
  const app = new Hono();

  // Statistika po klijentu: tekući mesec (potrošnja, zahtevi, tokeni, ušteda)
  app.get("/overview", async (c) => {
    const db = getDb();
    const rows = await db.select().from(clients).orderBy(desc(clients.createdAt));
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const usage = rows.length
      ? await db.execute<{ api_key: string; requests: number; spend: number; pin: number; pout: number; fast: number; smart: number }>(sql`
          select api_key, count(*)::int as requests, coalesce(sum(spend),0)::float as spend,
                 coalesce(sum(prompt_tokens),0)::float as pin, coalesce(sum(completion_tokens),0)::float as pout,
                 count(*) filter (where model_group = 'fast')::int as fast,
                 count(*) filter (where model_group = 'smart')::int as smart
          from "LiteLLM_SpendLogs"
          where "startTime" >= ${month.toISOString()}::timestamptz and api_key in (${sql.join(rows.map((r) => sql`${r.keyToken}`), sql`, `)})
          group by api_key`)
      : [];
    const byKey = new Map([...usage].map((u) => [u.api_key, u]));
    const items = rows.map((r) => {
      const u = byKey.get(r.keyToken);
      const spend = n(u?.spend);
      const base = baseline(n(u?.pin), n(u?.pout));
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        keyPreview: r.keyPreview,
        monthlyBudgetUsd: r.monthlyBudgetUsd,
        defaultMode: r.defaultMode,
        status: r.status,
        createdAt: r.createdAt,
        spendUsd: spend,
        requests: n(u?.requests),
        tokens: n(u?.pin) + n(u?.pout),
        baselineUsd: base,
        savingsUsd: Math.max(0, base - spend),
        split: { fast: n(u?.fast), smart: n(u?.smart) },
      };
    });
    const sum = (k: "spendUsd" | "requests" | "baselineUsd" | "savingsUsd") => items.reduce((a, i) => a + i[k], 0);
    return c.json({
      items,
      totals: { spendUsd: sum("spendUsd"), requests: sum("requests"), baselineUsd: sum("baselineUsd"), savingsUsd: sum("savingsUsd"), activeClients: items.filter((i) => i.status === "active").length },
      baseline: { inputPerM: BASE_IN, outputPerM: BASE_OUT },
    });
  });

  // Novi klijent → novi LiteLLM ključ sa mesečnim budžetom. Pravi ključ se prikazuje samo jednom.
  app.post("/clients", async (c) => {
    const input = await c.req.json<{ name?: string; email?: string; monthlyBudgetUsd?: number; defaultMode?: Mode }>().catch(() => null);
    const name = input?.name?.trim();
    const budget = Number(input?.monthlyBudgetUsd);
    if (!name) return c.json({ error: "Client name is required." }, 400);
    if (!Number.isFinite(budget) || budget <= 0 || budget > 10_000) return c.json({ error: "Monthly budget must be between $1 and $10,000." }, 400);
    const mode: Mode = MODES.includes(input?.defaultMode as Mode) ? (input!.defaultMode as Mode) : "auto";
    const alias = `client-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}-${randomBytes(3).toString("hex")}`;
    try {
      const key = await litellm<{ key: string; token: string }>("/key/generate", {
        key_alias: alias,
        models: ["fast", "smart"],
        max_budget: budget,
        budget_duration: "30d",
        metadata: { scoutline_client: name },
      });
      const [row] = await getDb()
        .insert(clients)
        .values({
          name,
          email: input?.email?.trim() || null,
          keyToken: key.token,
          keyAlias: alias,
          keyPreview: `${key.key.slice(0, 3)}…${key.key.slice(-4)}`,
          monthlyBudgetUsd: budget,
          defaultMode: mode,
        })
        .returning();
      return c.json({ client: row, apiKey: key.key }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Izmena budžeta / imena
  app.patch("/clients/:id", async (c) => {
    const input = await c.req.json<{ monthlyBudgetUsd?: number; name?: string; defaultMode?: Mode }>().catch(() => null);
    const [row] = await getDb().select().from(clients).where(eq(clients.id, c.req.param("id"))).limit(1);
    if (!row) return c.json({ error: "Client not found." }, 404);
    const budget = input?.monthlyBudgetUsd !== undefined ? Number(input.monthlyBudgetUsd) : row.monthlyBudgetUsd;
    if (!Number.isFinite(budget) || budget <= 0 || budget > 10_000) return c.json({ error: "Monthly budget must be between $1 and $10,000." }, 400);
    try {
      if (budget !== row.monthlyBudgetUsd) await litellm("/key/update", { key: row.keyToken, max_budget: budget });
      const [updated] = await getDb()
        .update(clients)
        .set({
          monthlyBudgetUsd: budget,
          name: input?.name?.trim() || row.name,
          defaultMode: MODES.includes(input?.defaultMode as Mode) ? (input!.defaultMode as Mode) : row.defaultMode,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, row.id))
        .returning();
      return c.json({ client: updated });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Opoziv ključa (klijent odmah gubi pristup; istorija ostaje)
  app.post("/clients/:id/revoke", async (c) => {
    const [row] = await getDb().select().from(clients).where(eq(clients.id, c.req.param("id"))).limit(1);
    if (!row) return c.json({ error: "Client not found." }, 404);
    try {
      if (row.status === "active") await litellm("/key/delete", { keys: [row.keyToken] });
      const [updated] = await getDb().update(clients).set({ status: "revoked", updatedAt: new Date() }).where(eq(clients.id, row.id)).returning();
      return c.json({ client: updated });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Dnevna potrošnja (30 dana) + poslednji zahtevi
  app.get("/clients/:id/usage", async (c) => {
    const db = getDb();
    const [row] = await db.select().from(clients).where(eq(clients.id, c.req.param("id"))).limit(1);
    if (!row) return c.json({ error: "Client not found." }, 404);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const daily = await db.execute<{ day: string; requests: number; spend: number; pin: number; pout: number }>(sql`
      select to_char(date_trunc('day', "startTime"), 'YYYY-MM-DD') as day, count(*)::int as requests,
             coalesce(sum(spend),0)::float as spend, coalesce(sum(prompt_tokens),0)::float as pin, coalesce(sum(completion_tokens),0)::float as pout
      from "LiteLLM_SpendLogs" where api_key = ${row.keyToken} and "startTime" >= ${since.toISOString()}::timestamptz
      group by 1 order by 1`);
    const recent = await db.execute<{ at: string; model_group: string; model: string; pin: number; pout: number; spend: number; status: string | null }>(sql`
      select "startTime" as at, model_group, model, prompt_tokens::float as pin, completion_tokens::float as pout, spend::float as spend, status
      from "LiteLLM_SpendLogs" where api_key = ${row.keyToken}
      order by "startTime" desc limit 20`);
    return c.json({
      daily: [...daily].map((d) => ({ day: d.day, requests: n(d.requests), spendUsd: n(d.spend), baselineUsd: baseline(n(d.pin), n(d.pout)) })),
      recent: [...recent].map((r) => ({ at: r.at, mode: r.model_group, model: r.model, tokens: n(r.pin) + n(r.pout), spendUsd: n(r.spend), baselineUsd: baseline(n(r.pin), n(r.pout)), status: r.status })),
    });
  });

  return app;
}

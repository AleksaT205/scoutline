import { randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { and, desc, eq, gte, inArray, max, sql } from "drizzle-orm";
import { clients, projects, routerAudit, routerDecisions, routerMembers, routerRules, type Db } from "@radar/db";
import {
  FREE_GROUPS,
  PRICES_AS_OF,
  PRIVATE_GROUPS,
  ROUTER_GROUPS,
  allowedGroupsFor,
  costAt,
  isRouterGroup,
  priceFor,
  requestFeatures,
  validateRule,
  type RouterGroup,
} from "@radar/shared";
import { BASE_IN, BASE_OUT, MODES, activeRules, baseline, decide, ensureDefaultRules, invalidateKeys, invalidateRules, litellm, num as n, type Mode } from "./router.js";
import { appendAudit, verifyAudit } from "./router-audit.js";

/** Upravljanje AI Router-om (zaštićeno ulogom member u app.ts). */

type ClientRow = typeof clients.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const actorOf = (c: Context) => {
  const a = c.get("actor" as never) as { email?: string; name?: string } | undefined;
  return a?.email || a?.name || "team";
};
// Bezbedno čitanje broja iz LiteLLM metadata (tekst → broj, inače 0)
const numFromJson = (expr: ReturnType<typeof sql.raw>) => sql`case when (${expr}) ~ '^[0-9]+(\\.[0-9]+)?$' then (${expr})::float else 0 end`;
const CACHE_READ = numFromJson(sql.raw(`coalesce(s.metadata->'additional_usage_values'->>'cache_read_input_tokens', s.metadata->'usage_object'->>'cache_read_input_tokens')`));

/** Šta bi koštalo bez rutiranja: imenovan model → njegova cena; "auto" → premium (BASELINE_*); eksplicitna grupa → isto kao sad. */
function baselineCost(requested: string, tokens: { pin: number; pout: number; cacheRead: number }, spend: number) {
  if (isRouterGroup(requested)) return spend;
  if (!requested || requested === "auto") return baseline(tokens.pin, tokens.pout);
  return costAt(priceFor(requested, { input: BASE_IN, output: BASE_OUT }), { input: tokens.pin, output: tokens.pout, cacheRead: tokens.cacheRead });
}

/** Dozvoljene grupe → LiteLLM (ključ klijenta, ključevi inženjera, tim). */
async function syncModels(db: Db, client: ClientRow) {
  const models = allowedGroupsFor(client);
  await litellm("/key/update", { key: client.keyToken, models });
  const members = await db.select().from(routerMembers).where(and(eq(routerMembers.clientId, client.id), eq(routerMembers.status, "active")));
  for (const m of members) await litellm("/key/update", { key: m.keyToken, models });
  if (client.teamId) await litellm("/team/update", { team_id: client.teamId, models });
}

/** LiteLLM tim za klijenta (budžet klijenta pokriva ključ aplikacije i ključeve inženjera). */
async function ensureTeam(db: Db, client: ClientRow): Promise<string> {
  if (client.teamId) return client.teamId;
  const t = await litellm<{ team_id: string }>("/team/new", {
    team_alias: client.keyAlias,
    max_budget: client.monthlyBudgetUsd,
    budget_duration: "30d",
    models: allowedGroupsFor(client),
    metadata: { scoutline_client: client.name },
  });
  // Ključ aplikacije ulazi u tim, da budžet tima važi za sve ključeve klijenta
  await litellm("/key/update", { key: client.keyToken, team_id: t.team_id }).catch(() => undefined);
  await db.update(clients).set({ teamId: t.team_id, updatedAt: new Date() }).where(eq(clients.id, client.id));
  return t.team_id;
}

async function spendByKey(db: Db, keys: string[], since: Date) {
  if (!keys.length) return new Map<string, { requests: number; spend: number; pin: number; pout: number; fast: number; smart: number; local: number }>();
  try {
    const rows = await db.execute<{ api_key: string; requests: number; spend: number; pin: number; pout: number; fast: number; smart: number; local: number }>(sql`
      select api_key, count(*)::int as requests, coalesce(sum(spend),0)::float as spend,
             coalesce(sum(prompt_tokens),0)::float as pin, coalesce(sum(completion_tokens),0)::float as pout,
             count(*) filter (where model_group = 'fast')::int as fast,
             count(*) filter (where model_group = 'smart')::int as smart,
             count(*) filter (where model_group = 'local')::int as local
      from "LiteLLM_SpendLogs"
      where "startTime" >= ${since.toISOString()}::timestamptz and api_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
      group by api_key`);
    return new Map([...rows].map((r) => [r.api_key, r]));
  } catch {
    return new Map(); // LiteLLM tabele ne postoje (lokalni test)
  }
}

type JoinRow = {
  client_id: string | null;
  member_id: string | null;
  cls: string;
  model: string;
  requested: string;
  applied: string;
  day?: string;
  requests: number;
  logged: number;
  pin: number;
  pout: number;
  spend: number;
  cache_hits: number;
  cache_read: number;
  errors: number;
};

/** Odluke + LiteLLM evidencija (tokeni, trošak, keš) — spajanje po litellm_call_id. */
async function joinedUsage(db: Db, since: Date, opts: { clientId?: string; byDay?: boolean; until?: Date } = {}): Promise<JoinRow[]> {
  const where = sql`d.at >= ${since.toISOString()}::timestamptz and d.blocked is null ${opts.until ? sql`and d.at < ${opts.until.toISOString()}::timestamptz` : sql``} ${opts.clientId ? sql`and d.client_id = ${opts.clientId}` : sql``}`;
  const day = opts.byDay ? sql`, to_char(date_trunc('day', d.at), 'YYYY-MM-DD') as day` : sql``;
  const groupBy = opts.byDay ? sql`group by 1,2,3,4,5,6,7` : sql`group by 1,2,3,4,5,6`;
  try {
    return [
      ...(await db.execute<JoinRow>(sql`
        select d.client_id, d.member_id, coalesce(d.request_class,'') as cls, coalesce(nullif(s.model,''), d.applied, '') as model,
               coalesce(d.requested,'') as requested, coalesce(d.applied,'') as applied ${day},
               count(*)::int as requests, count(s.request_id)::int as logged,
               coalesce(sum(s.prompt_tokens),0)::float as pin, coalesce(sum(s.completion_tokens),0)::float as pout,
               coalesce(sum(s.spend),0)::float as spend,
               count(*) filter (where s.cache_hit = 'True')::int as cache_hits,
               coalesce(sum(${CACHE_READ}),0)::float as cache_read,
               count(*) filter (where d.status >= 400)::int as errors
        from router_decisions d left join "LiteLLM_SpendLogs" s on s.litellm_call_id = d.call_id
        where ${where} ${groupBy}`)),
    ];
  } catch {
    // Bez LiteLLM tabela: samo brojevi iz naših odluka
    return [
      ...(await db.execute<JoinRow>(sql`
        select d.client_id, d.member_id, coalesce(d.request_class,'') as cls, coalesce(d.applied,'') as model,
               coalesce(d.requested,'') as requested, coalesce(d.applied,'') as applied ${day},
               count(*)::int as requests, 0 as logged, 0::float as pin, 0::float as pout, 0::float as spend, 0 as cache_hits, 0::float as cache_read,
               count(*) filter (where d.status >= 400)::int as errors
        from router_decisions d where ${where} ${groupBy}`)),
    ];
  }
}

function sumRows(rows: JoinRow[]) {
  let requests = 0,
    logged = 0,
    pin = 0,
    pout = 0,
    spend = 0,
    base = 0,
    cacheHits = 0,
    cacheRead = 0,
    errors = 0;
  for (const r of rows) {
    const t = { pin: n(r.pin), pout: n(r.pout), cacheRead: n(r.cache_read) };
    requests += n(r.requests);
    logged += n(r.logged);
    pin += t.pin;
    pout += t.pout;
    spend += n(r.spend);
    base += baselineCost(r.requested, t, n(r.spend));
    cacheHits += n(r.cache_hits);
    cacheRead += t.cacheRead;
    errors += n(r.errors);
  }
  return { requests, tokens: pin + pout, inputTokens: pin, outputTokens: pout, spendUsd: spend, baselineUsd: base, savingsUsd: Math.max(0, base - spend), cacheHits, cacheHitRate: logged ? cacheHits / logged : null, cacheReadTokens: cacheRead, errors };
}

function groupRows(rows: JoinRow[], key: (r: JoinRow) => string) {
  const m = new Map<string, JoinRow[]>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.entries()].map(([k, list]) => ({ key: k, ...sumRows(list) })).sort((a, b) => b.requests - a.requests);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function parseGroups(v: unknown): RouterGroup[] | null {
  if (v === undefined) return null;
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isRouterGroup))];
}

export function routerAdmin(getDb: () => Db) {
  const app = new Hono();

  // ── Pregled (tekući mesec) ──
  app.get("/overview", async (c) => {
    const db = getDb();
    const rows = await db.select().from(clients).orderBy(desc(clients.createdAt));
    const members = rows.length ? await db.select().from(routerMembers).where(inArray(routerMembers.clientId, rows.map((r) => r.id))) : [];
    const since = monthStart();
    const byKey = await spendByKey(db, [...rows.map((r) => r.keyToken), ...members.map((m) => m.keyToken)], since);
    const joined = await joinedUsage(db, since).catch(() => [] as JoinRow[]);
    const items = rows.map((r) => {
      const keys = [r.keyToken, ...members.filter((m) => m.clientId === r.id).map((m) => m.keyToken)];
      const u = keys.map((k) => byKey.get(k)).filter(Boolean);
      const spend = u.reduce((a, x) => a + n(x!.spend), 0);
      const pin = u.reduce((a, x) => a + n(x!.pin), 0);
      const pout = u.reduce((a, x) => a + n(x!.pout), 0);
      const requests = u.reduce((a, x) => a + n(x!.requests), 0);
      // Ušteda: zahtevi sa odlukom po ceni traženog modela, ostali (stari) po premium ceni
      const mine = joined.filter((j) => j.client_id === r.id);
      const s = sumRows(mine);
      const restIn = Math.max(0, pin - s.inputTokens);
      const restOut = Math.max(0, pout - s.outputTokens);
      const base = s.baselineUsd + baseline(restIn, restOut) + Math.max(0, spend - s.spendUsd);
      const allowed = allowedGroupsFor(r);
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        keyPreview: r.keyPreview,
        monthlyBudgetUsd: r.monthlyBudgetUsd,
        defaultMode: r.defaultMode,
        status: r.status,
        createdAt: r.createdAt,
        confidential: r.confidential,
        allowedGroups: r.allowedGroups,
        effectiveGroups: allowed,
        shadow: r.shadow,
        maskSecrets: r.maskSecrets,
        projectId: r.projectId,
        members: members.filter((m) => m.clientId === r.id && m.status === "active").length,
        spendUsd: spend,
        requests,
        tokens: pin + pout,
        baselineUsd: base,
        savingsUsd: Math.max(0, base - spend),
        cacheHitRate: s.cacheHitRate,
        split: { fast: u.reduce((a, x) => a + n(x!.fast), 0), smart: u.reduce((a, x) => a + n(x!.smart), 0), local: u.reduce((a, x) => a + n(x!.local), 0) },
      };
    });
    const sum = (k: "spendUsd" | "requests" | "baselineUsd" | "savingsUsd") => items.reduce((a, i) => a + i[k], 0);
    return c.json({
      items,
      totals: { spendUsd: sum("spendUsd"), requests: sum("requests"), baselineUsd: sum("baselineUsd"), savingsUsd: sum("savingsUsd"), activeClients: items.filter((i) => i.status === "active").length },
      baseline: { inputPerM: BASE_IN, outputPerM: BASE_OUT, pricesAsOf: PRICES_AS_OF },
      groups: { all: ROUTER_GROUPS, free: FREE_GROUPS, private: PRIVATE_GROUPS },
    });
  });

  // ── Klijenti ──
  // Novi klijent → novi LiteLLM ključ sa mesečnim budžetom. Pravi ključ se prikazuje samo jednom.
  app.post("/clients", async (c) => {
    const input = await c.req.json<{ name?: string; email?: string; monthlyBudgetUsd?: number; defaultMode?: Mode; confidential?: boolean; allowedGroups?: string[] }>().catch(() => null);
    const name = input?.name?.trim();
    const budget = Number(input?.monthlyBudgetUsd);
    if (!name) return c.json({ error: "Client name is required." }, 400);
    if (!Number.isFinite(budget) || budget <= 0 || budget > 10_000) return c.json({ error: "Monthly budget must be between $1 and $10,000." }, 400);
    const mode: Mode = MODES.includes(input?.defaultMode as Mode) ? (input!.defaultMode as Mode) : "auto";
    const confidential = input?.confidential === true;
    const groups = parseGroups(input?.allowedGroups) ?? (confidential ? ["local"] : ["fast", "smart"]);
    const models = allowedGroupsFor({ confidential, allowedGroups: groups });
    if (!models.length) return c.json({ error: confidential ? "Confidential clients need the local group (data never goes to free cloud tiers)." : "Pick at least one model group." }, 400);
    const alias = `client-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}-${randomBytes(3).toString("hex")}`;
    try {
      const key = await litellm<{ key: string; token: string }>("/key/generate", { key_alias: alias, models, max_budget: budget, budget_duration: "30d", metadata: { scoutline_client: name } });
      const [row] = await getDb()
        .insert(clients)
        .values({ name, email: input?.email?.trim() || null, keyToken: key.token, keyAlias: alias, keyPreview: `${key.key.slice(0, 3)}…${key.key.slice(-4)}`, monthlyBudgetUsd: budget, defaultMode: mode, confidential, allowedGroups: groups })
        .returning();
      await appendAudit(getDb(), { actor: actorOf(c), action: "client.create", entity: `client:${row!.id}`, data: { name, budget, confidential, allowedGroups: groups } });
      return c.json({ client: row, apiKey: key.key }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Izmena: budžet, ime, režim, poverljivost, dozvoljene grupe, shadow, maskiranje
  app.patch("/clients/:id", async (c) => {
    const db = getDb();
    const input = await c.req
      .json<{ monthlyBudgetUsd?: number; name?: string; defaultMode?: Mode; confidential?: boolean; allowedGroups?: string[]; shadow?: boolean; maskSecrets?: boolean }>()
      .catch(() => null);
    const [row] = await db.select().from(clients).where(eq(clients.id, c.req.param("id"))).limit(1);
    if (!row) return c.json({ error: "Client not found." }, 404);
    const budget = input?.monthlyBudgetUsd !== undefined ? Number(input.monthlyBudgetUsd) : row.monthlyBudgetUsd;
    if (!Number.isFinite(budget) || budget <= 0 || budget > 10_000) return c.json({ error: "Monthly budget must be between $1 and $10,000." }, 400);
    const confidential = typeof input?.confidential === "boolean" ? input.confidential : row.confidential;
    let groups = parseGroups(input?.allowedGroups) ?? row.allowedGroups;
    if (confidential && !row.confidential && input?.allowedGroups === undefined) groups = ["local"]; // uključena poverljivost → samo privatne grupe
    const effective = allowedGroupsFor({ confidential, allowedGroups: groups });
    if (!effective.length) return c.json({ error: confidential ? "Confidential clients need the local group (data never goes to free cloud tiers)." : "Pick at least one model group." }, 400);
    const groupsChanged = effective.join() !== allowedGroupsFor(row).join();
    const patch = {
      monthlyBudgetUsd: budget,
      name: input?.name?.trim() || row.name,
      defaultMode: MODES.includes(input?.defaultMode as Mode) ? (input!.defaultMode as Mode) : row.defaultMode,
      confidential,
      allowedGroups: groups,
      shadow: typeof input?.shadow === "boolean" ? input.shadow : row.shadow,
      maskSecrets: typeof input?.maskSecrets === "boolean" ? input.maskSecrets : row.maskSecrets,
    };
    try {
      if (row.status === "active") {
        if (budget !== row.monthlyBudgetUsd) {
          await litellm("/key/update", { key: row.keyToken, max_budget: budget });
          if (row.teamId) await litellm("/team/update", { team_id: row.teamId, max_budget: budget });
        }
        if (groupsChanged) await syncModels(db, { ...row, ...patch });
      }
      const [updated] = await db.update(clients).set({ ...patch, updatedAt: new Date() }).where(eq(clients.id, row.id)).returning();
      invalidateKeys();
      const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(row[k as keyof ClientRow])));
      if (Object.keys(changed).length) await appendAudit(db, { actor: actorOf(c), action: "client.update", entity: `client:${row.id}`, data: changed });
      return c.json({ client: updated });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Opoziv ključa (klijent i svi njegovi inženjeri odmah gube pristup; istorija ostaje)
  app.post("/clients/:id/revoke", async (c) => {
    const db = getDb();
    const [row] = await db.select().from(clients).where(eq(clients.id, c.req.param("id"))).limit(1);
    if (!row) return c.json({ error: "Client not found." }, 404);
    try {
      const members = await db.select().from(routerMembers).where(and(eq(routerMembers.clientId, row.id), eq(routerMembers.status, "active")));
      if (row.status === "active") await litellm("/key/delete", { keys: [row.keyToken, ...members.map((m) => m.keyToken)] });
      await db.update(routerMembers).set({ status: "revoked", updatedAt: new Date() }).where(eq(routerMembers.clientId, row.id));
      const [updated] = await db.update(clients).set({ status: "revoked", updatedAt: new Date() }).where(eq(clients.id, row.id)).returning();
      invalidateKeys();
      await appendAudit(db, { actor: actorOf(c), action: "client.revoke", entity: `client:${row.id}`, data: { members: members.length } });
      return c.json({ client: updated });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Dnevna potrošnja (30 dana) + poslednji zahtevi (sa pravilom i brzinom)
  app.get("/clients/:id/usage", async (c) => {
    const db = getDb();
    const [row] = await db.select().from(clients).where(eq(clients.id, c.req.param("id"))).limit(1);
    if (!row) return c.json({ error: "Client not found." }, 404);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const keys = [row.keyToken, ...(await db.select({ k: routerMembers.keyToken }).from(routerMembers).where(eq(routerMembers.clientId, row.id))).map((m) => m.k)];
    let daily: Array<{ day: string; requests: number; spendUsd: number; baselineUsd: number }> = [];
    try {
      const rows = await db.execute<{ day: string; requests: number; spend: number; pin: number; pout: number }>(sql`
        select to_char(date_trunc('day', "startTime"), 'YYYY-MM-DD') as day, count(*)::int as requests,
               coalesce(sum(spend),0)::float as spend, coalesce(sum(prompt_tokens),0)::float as pin, coalesce(sum(completion_tokens),0)::float as pout
        from "LiteLLM_SpendLogs" where api_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) and "startTime" >= ${since.toISOString()}::timestamptz
        group by 1 order by 1`);
      daily = [...rows].map((d) => ({ day: d.day, requests: n(d.requests), spendUsd: n(d.spend), baselineUsd: baseline(n(d.pin), n(d.pout)) }));
    } catch {
      /* LiteLLM tabele ne postoje */
    }
    const ruleNames = new Map((await db.select({ id: routerRules.id, name: routerRules.name }).from(routerRules)).map((r) => [r.id, r.name]));
    const recent = await db.select().from(routerDecisions).where(eq(routerDecisions.clientId, row.id)).orderBy(desc(routerDecisions.at)).limit(25);
    return c.json({
      daily,
      recent: recent.map((r) => ({
        at: r.at,
        requested: r.requested,
        chosen: r.chosen,
        applied: r.applied,
        rule: r.ruleId ? (ruleNames.get(r.ruleId) ?? "deleted rule") : null,
        requestClass: r.requestClass,
        sticky: r.sticky,
        shadow: r.shadow,
        masked: r.masked,
        status: r.status,
        blocked: r.blocked,
        ttfbMs: r.ttfbMs,
        totalMs: r.totalMs,
        fallback: r.fallback,
      })),
    });
  });

  // Mesečni izveštaj po klijentu (CSV): dan × model
  app.get("/clients/:id/report.csv", async (c) => {
    const db = getDb();
    const [row] = await db.select().from(clients).where(eq(clients.id, c.req.param("id"))).limit(1);
    if (!row) return c.json({ error: "Client not found." }, 404);
    const m = /^(\d{4})-(\d{2})$/.exec(c.req.query("month") ?? "");
    const from = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : monthStart();
    const until = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const rows = await joinedUsage(db, from, { clientId: row.id, byDay: true, until });
    const days = new Map<string, JoinRow[]>();
    for (const r of rows) {
      const k = `${r.day}|${r.model}`;
      days.set(k, [...(days.get(k) ?? []), r]);
    }
    const lines = [["date", "model", "requests", "input_tokens", "output_tokens", "cost_usd", "without_routing_usd", "saved_usd", "cache_hits", "errors"].join(",")];
    for (const [k, list] of [...days.entries()].sort()) {
      const [day, model] = k.split("|");
      const s = sumRows(list);
      lines.push([day, model, s.requests, s.inputTokens, s.outputTokens, s.spendUsd.toFixed(6), s.baselineUsd.toFixed(6), s.savingsUsd.toFixed(6), s.cacheHits, s.errors].map(csvCell).join(","));
    }
    const t = sumRows(rows);
    lines.push(["total", "", t.requests, t.inputTokens, t.outputTokens, t.spendUsd.toFixed(6), t.baselineUsd.toFixed(6), t.savingsUsd.toFixed(6), t.cacheHits, t.errors].map(csvCell).join(","));
    const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    return new Response(lines.join("\n") + "\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ai-usage-${slug}-${from.toISOString().slice(0, 7)}.csv"` },
    });
  });

  // ── Inženjeri (ključ po osobi, budžet po osobi, u timu klijenta) ──
  app.get("/clients/:id/members", async (c) => {
    const db = getDb();
    const list = await db.select().from(routerMembers).where(eq(routerMembers.clientId, c.req.param("id"))).orderBy(desc(routerMembers.createdAt));
    const byKey = await spendByKey(db, list.map((m) => m.keyToken), monthStart());
    return c.json({
      members: list.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        keyPreview: m.keyPreview,
        monthlyBudgetUsd: m.monthlyBudgetUsd,
        status: m.status,
        createdAt: m.createdAt,
        spendUsd: n(byKey.get(m.keyToken)?.spend),
        requests: n(byKey.get(m.keyToken)?.requests),
      })),
    });
  });

  app.post("/clients/:id/members", async (c) => {
    const db = getDb();
    const [client] = await db.select().from(clients).where(eq(clients.id, c.req.param("id"))).limit(1);
    if (!client) return c.json({ error: "Client not found." }, 404);
    if (client.status !== "active") return c.json({ error: "This client is revoked." }, 400);
    const input = await c.req.json<{ name?: string; email?: string; monthlyBudgetUsd?: number }>().catch(() => null);
    const name = input?.name?.trim();
    const budget = Number(input?.monthlyBudgetUsd);
    if (!name) return c.json({ error: "Name is required." }, 400);
    if (!Number.isFinite(budget) || budget <= 0 || budget > client.monthlyBudgetUsd) return c.json({ error: `Budget must be between $1 and the client budget ($${client.monthlyBudgetUsd}).` }, 400);
    try {
      const teamId = await ensureTeam(db, client);
      const alias = `${client.keyAlias}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-${randomBytes(2).toString("hex")}`;
      const key = await litellm<{ key: string; token: string }>("/key/generate", {
        key_alias: alias,
        team_id: teamId,
        user_id: alias,
        models: allowedGroupsFor(client),
        max_budget: budget,
        budget_duration: "30d",
        metadata: { scoutline_client: client.name, scoutline_member: name },
      });
      const [row] = await db
        .insert(routerMembers)
        .values({ clientId: client.id, name, email: input?.email?.trim() || null, keyToken: key.token, keyAlias: alias, keyPreview: `${key.key.slice(0, 3)}…${key.key.slice(-4)}`, monthlyBudgetUsd: budget })
        .returning();
      await appendAudit(db, { actor: actorOf(c), action: "member.create", entity: `member:${row!.id}`, data: { clientId: client.id, name, budget } });
      return c.json({ member: row, apiKey: key.key }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.patch("/members/:id", async (c) => {
    const db = getDb();
    const [m] = await db.select().from(routerMembers).where(eq(routerMembers.id, c.req.param("id"))).limit(1);
    if (!m) return c.json({ error: "Not found." }, 404);
    const [client] = await db.select().from(clients).where(eq(clients.id, m.clientId)).limit(1);
    const input = await c.req.json<{ name?: string; monthlyBudgetUsd?: number }>().catch(() => null);
    const budget = input?.monthlyBudgetUsd !== undefined ? Number(input.monthlyBudgetUsd) : m.monthlyBudgetUsd;
    if (!Number.isFinite(budget) || budget <= 0 || budget > (client?.monthlyBudgetUsd ?? 10_000)) return c.json({ error: "Budget must be positive and within the client budget." }, 400);
    try {
      if (budget !== m.monthlyBudgetUsd && m.status === "active") await litellm("/key/update", { key: m.keyToken, max_budget: budget });
      const [updated] = await db
        .update(routerMembers)
        .set({ monthlyBudgetUsd: budget, name: input?.name?.trim() || m.name, updatedAt: new Date() })
        .where(eq(routerMembers.id, m.id))
        .returning();
      await appendAudit(db, { actor: actorOf(c), action: "member.update", entity: `member:${m.id}`, data: { budget } });
      return c.json({ member: updated });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.post("/members/:id/revoke", async (c) => {
    const db = getDb();
    const [m] = await db.select().from(routerMembers).where(eq(routerMembers.id, c.req.param("id"))).limit(1);
    if (!m) return c.json({ error: "Not found." }, 404);
    try {
      if (m.status === "active") await litellm("/key/delete", { keys: [m.keyToken] });
      const [updated] = await db.update(routerMembers).set({ status: "revoked", updatedAt: new Date() }).where(eq(routerMembers.id, m.id)).returning();
      invalidateKeys();
      await appendAudit(db, { actor: actorOf(c), action: "member.revoke", entity: `member:${m.id}`, data: {} });
      return c.json({ member: updated });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // ── Pravila ──
  app.get("/rules", async (c) => {
    const db = getDb();
    await ensureDefaultRules(db).catch(() => undefined);
    const rows = await db.select().from(routerRules).orderBy(routerRules.priority, desc(routerRules.version));
    const since = new Date(Date.now() - 7 * 86_400_000);
    const stats = await db.execute<{ rule_id: string; requests: number; failed: number; last_at: string }>(sql`
      select rule_id::text, count(*)::int as requests, count(*) filter (where status >= 400 or fallback)::int as failed, max(at)::text as last_at
      from router_decisions where at >= ${since.toISOString()}::timestamptz and rule_id is not null group by 1`);
    const byRule = new Map([...stats].map((s) => [s.rule_id, s]));
    const names = new Map((await db.select({ id: clients.id, name: clients.name }).from(clients)).map((x) => [x.id, x.name]));
    return c.json({
      rules: rows.map((r) => ({
        ...r,
        clientName: r.clientId ? (names.get(r.clientId) ?? "Deleted client") : null,
        stats: byRule.has(r.id) ? { requests: n(byRule.get(r.id)!.requests), failed: n(byRule.get(r.id)!.failed), lastAt: byRule.get(r.id)!.last_at } : { requests: 0, failed: 0, lastAt: null },
      })),
      groups: ROUTER_GROUPS,
    });
  });

  app.post("/rules", async (c) => {
    const db = getDb();
    const b = await c.req.json<{ clientId?: string | null; name?: string; condition?: unknown; target?: string; priority?: number }>().catch(() => null);
    const err = validateRule(b ?? {});
    if (err) return c.json({ error: err }, 400);
    if (b!.clientId && !isUuid(b!.clientId)) return c.json({ error: "Unknown client." }, 400);
    const id = randomUUID();
    const [row] = await db
      .insert(routerRules)
      .values({ id, lineage: id, clientId: b!.clientId || null, name: b!.name!.trim(), condition: b!.condition as never, target: b!.target!, priority: Number(b!.priority), status: "active", createdBy: actorOf(c) })
      .returning();
    invalidateRules();
    await appendAudit(db, { actor: actorOf(c), action: "rule.create", entity: `rule:${id}`, data: { name: row!.name, condition: row!.condition, target: row!.target, priority: row!.priority, clientId: row!.clientId } });
    return c.json({ rule: row }, 201);
  });

  /** Nova verzija pravila (stara ide u arhivu — može da se vrati). */
  async function newVersion(db: Db, from: typeof routerRules.$inferSelect, patch: { name: string; condition: unknown; target: string; priority: number }, actor: string, action: string, reason?: string | null) {
    return db.transaction(async (tx) => {
      const [{ v } = { v: 0 }] = await tx.select({ v: max(routerRules.version) }).from(routerRules).where(eq(routerRules.lineage, from.lineage));
      await tx
        .update(routerRules)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(eq(routerRules.lineage, from.lineage), eq(routerRules.status, "active")));
      const [row] = await tx
        .insert(routerRules)
        .values({
          lineage: from.lineage,
          version: (v ?? 0) + 1,
          clientId: from.clientId,
          key: from.key,
          name: patch.name,
          condition: patch.condition as never,
          target: patch.target,
          priority: patch.priority,
          status: "active",
          reason: reason ?? null,
          createdBy: actor,
          decidedBy: actor,
          decidedAt: new Date(),
        })
        .returning();
      await appendAudit(tx, { actor, action, entity: `rule:${from.lineage}`, data: { from: from.id, to: row!.id, version: row!.version, name: patch.name, condition: patch.condition, target: patch.target, priority: patch.priority } });
      return row!;
    });
  }

  app.patch("/rules/:id", async (c) => {
    const db = getDb();
    const [cur] = await db.select().from(routerRules).where(eq(routerRules.id, c.req.param("id"))).limit(1);
    if (!cur) return c.json({ error: "Rule not found." }, 404);
    if (cur.status !== "active") return c.json({ error: "Only active rules can be edited." }, 400);
    const b = (await c.req.json<{ name?: string; condition?: unknown; target?: string; priority?: number }>().catch(() => null)) ?? {};
    const next = { name: (b.name ?? cur.name).trim(), condition: b.condition ?? cur.condition, target: b.target ?? cur.target, priority: b.priority ?? cur.priority };
    const err = validateRule(next);
    if (err) return c.json({ error: err }, 400);
    const row = await newVersion(db, cur, next, actorOf(c), "rule.update");
    invalidateRules();
    return c.json({ rule: row });
  });

  app.post("/rules/:id/archive", async (c) => {
    const db = getDb();
    const [cur] = await db.select().from(routerRules).where(eq(routerRules.id, c.req.param("id"))).limit(1);
    if (!cur || cur.status !== "active") return c.json({ error: "Active rule not found." }, 404);
    await db.update(routerRules).set({ status: "archived", decidedBy: actorOf(c), decidedAt: new Date(), updatedAt: new Date() }).where(eq(routerRules.id, cur.id));
    invalidateRules();
    await appendAudit(db, { actor: actorOf(c), action: "rule.archive", entity: `rule:${cur.lineage}`, data: { id: cur.id, version: cur.version } });
    return c.json({ ok: true });
  });

  // Predlog iz statistike → aktivna verzija
  app.post("/rules/:id/approve", async (c) => {
    const db = getDb();
    const [p] = await db.select().from(routerRules).where(eq(routerRules.id, c.req.param("id"))).limit(1);
    if (!p || p.status !== "proposed") return c.json({ error: "Proposal not found." }, 404);
    const row = await db.transaction(async (tx) => {
      const [{ v } = { v: 0 }] = await tx.select({ v: max(routerRules.version) }).from(routerRules).where(and(eq(routerRules.lineage, p.lineage), sql`${routerRules.status} <> 'proposed'`));
      await tx
        .update(routerRules)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(eq(routerRules.lineage, p.lineage), eq(routerRules.status, "active")));
      const [r] = await tx
        .update(routerRules)
        .set({ status: "active", version: (v ?? 0) + 1, decidedBy: actorOf(c), decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(routerRules.id, p.id))
        .returning();
      await appendAudit(tx, { actor: actorOf(c), action: "rule.approve", entity: `rule:${p.lineage}`, data: { id: p.id, version: r!.version, target: p.target, reason: p.reason } });
      return r!;
    });
    invalidateRules();
    return c.json({ rule: row });
  });

  app.post("/rules/:id/reject", async (c) => {
    const db = getDb();
    const [p] = await db.select().from(routerRules).where(eq(routerRules.id, c.req.param("id"))).limit(1);
    if (!p || p.status !== "proposed") return c.json({ error: "Proposal not found." }, 404);
    await db.update(routerRules).set({ status: "rejected", decidedBy: actorOf(c), decidedAt: new Date(), updatedAt: new Date() }).where(eq(routerRules.id, p.id));
    await appendAudit(db, { actor: actorOf(c), action: "rule.reject", entity: `rule:${p.lineage}`, data: { id: p.id, target: p.target } });
    return c.json({ ok: true });
  });

  // Vrati staru verziju (kopira se kao nova verzija — istorija ostaje cela)
  app.post("/rules/:id/restore", async (c) => {
    const db = getDb();
    const [old] = await db.select().from(routerRules).where(eq(routerRules.id, c.req.param("id"))).limit(1);
    if (!old || old.status !== "archived") return c.json({ error: "Archived version not found." }, 404);
    const row = await newVersion(db, old, { name: old.name, condition: old.condition, target: old.target, priority: old.priority }, actorOf(c), "rule.restore");
    invalidateRules();
    return c.json({ rule: row });
  });

  // Probni zahtev: koje pravilo bi važilo (bez slanja modelu)
  app.post("/rules/test", async (c) => {
    const db = getDb();
    const b = (await c.req.json<{ model?: string; text?: string; tools?: boolean; requestClass?: string; agent?: boolean; clientId?: string }>().catch(() => null)) ?? {};
    const features = requestFeatures(
      { model: b.model ?? "auto", messages: [{ content: String(b.text ?? "") }], tools: b.tools ? [{}] : [] },
      { requestClass: b.requestClass || null, sessionId: b.agent ? "test-session-0000" : null, userAgent: null },
    );
    const [client] = isUuid(b.clientId) ? await db.select().from(clients).where(eq(clients.id, b.clientId)).limit(1) : [];
    const d = decide({ rules: await activeRules(db), features, client: client ?? null, stickyGroup: null });
    return c.json({ chosen: d.chosen, applied: d.applied, rule: d.rule ? { id: d.rule.id, name: d.rule.name } : null, blocked: d.blocked, features: { chars: features.chars, agent: features.agent, requestClass: features.requestClass } });
  });

  // ── Analitika ──
  app.get("/analytics", async (c) => {
    const db = getDb();
    const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30) || 30));
    const clientId = isUuid(c.req.query("clientId")) ? c.req.query("clientId")! : undefined;
    const since = new Date(Date.now() - days * 86_400_000);
    const filter = sql`at >= ${since.toISOString()}::timestamptz ${clientId ? sql`and client_id = ${clientId}` : sql``}`;
    const [rows, perf, shadowRows, blocked, repeats, daily] = await Promise.all([
      joinedUsage(db, since, { clientId }),
      db.execute<{ grp: string; requests: number; errors: number; fallbacks: number; p50_ttfb: number | null; p95_ttfb: number | null; p50_total: number | null; p95_total: number | null }>(sql`
        select applied as grp, count(*)::int as requests,
               count(*) filter (where status >= 400)::int as errors, count(*) filter (where fallback)::int as fallbacks,
               percentile_cont(0.5) within group (order by ttfb_ms) as p50_ttfb, percentile_cont(0.95) within group (order by ttfb_ms) as p95_ttfb,
               percentile_cont(0.5) within group (order by total_ms) as p50_total, percentile_cont(0.95) within group (order by total_ms) as p95_total
        from router_decisions where ${filter} and applied is not null group by 1 order by 2 desc`),
      db.execute<{ chosen: string; applied: string; requests: number }>(sql`
        select chosen, applied, count(*)::int as requests from router_decisions where ${filter} and shadow group by 1,2`),
      db.execute<{ blocked: string; requests: number }>(sql`select blocked, count(*)::int as requests from router_decisions where ${filter} and blocked is not null group by 1 order by 2 desc limit 10`),
      db.execute<{ repeated: number; extra: number }>(sql`
        select count(*)::int as repeated, coalesce(sum(c - 1),0)::int as extra from (select prompt_hash, count(*) as c from router_decisions where ${filter} and prompt_hash is not null group by 1 having count(*) > 1) x`),
      db.execute<{ day: string; requests: number; errors: number }>(sql`
        select to_char(date_trunc('day', at), 'YYYY-MM-DD') as day, count(*)::int as requests, count(*) filter (where status >= 400)::int as errors
        from router_decisions where ${filter} group by 1 order by 1`),
    ]);
    // Model po stvarnom modelu (latencija iz LiteLLM evidencije, ako postoji)
    let models: Array<{ model: string; requests: number; p50: number | null; p95: number | null; failures: number }> = [];
    try {
      models = [
        ...(await db.execute<{ model: string; requests: number; p50: number | null; p95: number | null; failures: number }>(sql`
          select s.model, count(*)::int as requests, percentile_cont(0.5) within group (order by s.request_duration_ms) as p50,
                 percentile_cont(0.95) within group (order by s.request_duration_ms) as p95, count(*) filter (where s.status = 'failure')::int as failures
          from router_decisions d join "LiteLLM_SpendLogs" s on s.litellm_call_id = d.call_id
          where d.at >= ${since.toISOString()}::timestamptz ${clientId ? sql`and d.client_id = ${clientId}` : sql``}
          group by 1 order by 2 desc limit 20`)),
      ];
    } catch {
      /* LiteLLM tabele ne postoje */
    }
    const cl = await db.select({ id: clients.id, name: clients.name, projectId: clients.projectId }).from(clients);
    const pr = await db.select({ id: projects.id, name: projects.name }).from(projects);
    const mem = await db.select({ id: routerMembers.id, name: routerMembers.name }).from(routerMembers);
    const cName = new Map(cl.map((x) => [x.id, x.name]));
    const cProject = new Map(cl.map((x) => [x.id, x.projectId]));
    const pName = new Map(pr.map((x) => [x.id, x.name]));
    const mName = new Map(mem.map((x) => [x.id, x.name]));
    const label = (list: ReturnType<typeof groupRows>, f: (k: string) => string) => list.map((x) => ({ ...x, label: f(x.key) }));
    return c.json({
      days,
      totals: sumRows(rows),
      byClient: label(groupRows(rows, (r) => r.client_id ?? ""), (k) => (k ? (cName.get(k) ?? "Deleted client") : "Unknown key")),
      byProject: label(groupRows(rows, (r) => (r.client_id ? (cProject.get(r.client_id) ?? "") : "")), (k) => (k ? (pName.get(k) ?? "Deleted project") : "No project")),
      byMember: label(groupRows(rows.filter((r) => r.member_id), (r) => r.member_id!), (k) => mName.get(k) ?? "Deleted member"),
      byModel: label(groupRows(rows, (r) => r.model || "unknown"), (k) => k),
      byClass: label(groupRows(rows, (r) => r.cls || "app"), (k) => k),
      perf: [...perf].map((p) => ({ group: p.grp, requests: n(p.requests), errors: n(p.errors), fallbacks: n(p.fallbacks), p50TtfbMs: p.p50_ttfb, p95TtfbMs: p.p95_ttfb, p50TotalMs: p.p50_total, p95TotalMs: p.p95_total })),
      models: models.map((m) => ({ ...m, requests: n(m.requests), failures: n(m.failures) })),
      shadow: [...shadowRows].map((s) => ({ chosen: s.chosen, applied: s.applied, requests: n(s.requests) })),
      blocked: [...blocked].map((b) => ({ reason: b.blocked, requests: n(b.requests) })),
      repeats: { prompts: n([...repeats][0]?.repeated), extraRequests: n([...repeats][0]?.extra) },
      daily: [...daily].map((d) => ({ day: d.day, requests: n(d.requests), errors: n(d.errors) })),
      pricesAsOf: PRICES_AS_OF,
    });
  });

  // ── Zapis (lanac heševa) ──
  app.get("/audit", async (c) => {
    const rows = await getDb().select().from(routerAudit).orderBy(desc(routerAudit.id)).limit(Math.min(200, Number(c.req.query("limit") ?? 100) || 100));
    return c.json({ entries: rows });
  });
  app.get("/audit/verify", async (c) => c.json(await verifyAudit(getDb())));

  // Odluke poslednjih sati (za proveru rada)
  app.get("/decisions", async (c) => {
    const since = new Date(Date.now() - 24 * 3600_000);
    const rows = await getDb().select().from(routerDecisions).where(gte(routerDecisions.at, since)).orderBy(desc(routerDecisions.at)).limit(100);
    return c.json({ decisions: rows });
  });

  return app;
}

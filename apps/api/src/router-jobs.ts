import { and, eq, inArray, sql } from "drizzle-orm";
import { clients, routerMembers, settings, type Db } from "@radar/db";
import { sendTelegramText } from "@radar/scoring";
import { purgeDecisions, sealDecisions } from "./router-audit.js";
import { ensureDefaultRules } from "./router.js";

/**
 * Pozadinski poslovi AI Router-a (API): upozorenja na budžet (75% / 95%), pečat odluka u lanac, rok čuvanja.
 * „Učenje“ (predlozi pravila) radi worker jednom dnevno.
 */

export const BUDGET_KEY = "router_budget_alerts";
const THRESHOLDS = [95, 75] as const;

export interface BudgetAlert {
  id: string; // npr. client:<id>:2026-11:75
  at: string;
  level: number;
  kind: "client" | "member";
  name: string;
  clientName: string;
  spendUsd: number;
  budgetUsd: number;
}

export const money = (v: number) => (v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Potrošnja ovog meseca po ključu (LiteLLM_SpendLogs). */
async function monthSpend(db: Db, keys: string[]) {
  if (!keys.length) return new Map<string, number>();
  const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const rows = await db.execute<{ api_key: string; spend: number }>(sql`
    select api_key, coalesce(sum(spend),0)::float as spend from "LiteLLM_SpendLogs"
    where "startTime" >= ${month.toISOString()}::timestamptz and api_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) group by api_key`);
  return new Map([...rows].map((r) => [r.api_key, Number(r.spend) || 0]));
}

/**
 * Proveri budžete klijenata (zbir ključa aplikacije i ključeva inženjera) i inženjera.
 * Svaki prag se javlja jednom mesečno; ako se odmah pređe 95%, 75% se ne šalje posebno.
 */
export async function checkBudgets(db: Db, send: (text: string) => Promise<boolean> = sendTelegramText): Promise<BudgetAlert[]> {
  const cl = await db.select().from(clients).where(eq(clients.status, "active"));
  if (!cl.length) return [];
  const mem = await db
    .select()
    .from(routerMembers)
    .where(and(eq(routerMembers.status, "active"), inArray(routerMembers.clientId, cl.map((c) => c.id))));
  let spend: Map<string, number>;
  try {
    spend = await monthSpend(db, [...cl.map((c) => c.keyToken), ...mem.map((m) => m.keyToken)]);
  } catch {
    return []; // LiteLLM tabele ne postoje
  }
  const ym = new Date().toISOString().slice(0, 7);
  const [row] = await db.select().from(settings).where(eq(settings.key, BUDGET_KEY)).limit(1);
  const state = ((row?.value as { sent?: Record<string, string>; alerts?: BudgetAlert[] } | undefined) ?? {}) as { sent?: Record<string, string>; alerts?: BudgetAlert[] };
  const sent = Object.fromEntries(Object.entries(state.sent ?? {}).filter(([k]) => k.includes(`:${ym}:`))); // stari meseci se brišu
  const alerts = (state.alerts ?? []).filter((a) => Date.now() - Date.parse(a.at) < 31 * 86_400_000);
  const fresh: BudgetAlert[] = [];
  const entities = [
    ...cl.map((c) => ({ kind: "client" as const, id: c.id, name: c.name, clientName: c.name, budget: c.monthlyBudgetUsd, spend: [c.keyToken, ...mem.filter((m) => m.clientId === c.id).map((m) => m.keyToken)].reduce((a, k) => a + (spend.get(k) ?? 0), 0) })),
    ...mem.map((m) => ({ kind: "member" as const, id: m.id, name: m.name, clientName: cl.find((c) => c.id === m.clientId)?.name ?? "", budget: m.monthlyBudgetUsd, spend: spend.get(m.keyToken) ?? 0 })),
  ];
  for (const e of entities) {
    if (!(e.budget > 0)) continue;
    const pct = (e.spend / e.budget) * 100;
    const level = THRESHOLDS.find((t) => pct >= t);
    if (!level || sent[`${e.kind}:${e.id}:${ym}:${level}`]) continue;
    const at = new Date().toISOString();
    for (const t of THRESHOLDS) if (t <= level) sent[`${e.kind}:${e.id}:${ym}:${t}`] = at;
    const a: BudgetAlert = { id: `${e.kind}:${e.id}:${ym}:${level}`, at, level, kind: e.kind, name: e.name, clientName: e.clientName, spendUsd: e.spend, budgetUsd: e.budget };
    fresh.push(a);
    const who = e.kind === "client" ? `Client <b>${esc(e.name)}</b>` : `Engineer <b>${esc(e.name)}</b> (${esc(e.clientName)})`;
    await send(`${level >= 95 ? "🚨" : "⚠️"} <b>AI budget ${level}%</b>\n${who}: ${money(e.spend)} of ${money(e.budget)} this month.${level >= 95 ? "\nRequests stop when the budget runs out." : ""}`).catch(() => false);
  }
  const value = { sent, alerts: [...fresh, ...alerts].slice(0, 50) };
  await db.insert(settings).values({ key: BUDGET_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  return fresh;
}

export function startRouterJobs(getDb: () => Db) {
  const db = getDb();
  void ensureDefaultRules(db).catch((e) => console.warn("[router] pravila:", (e as Error).message));
  let purgedAt = 0;
  const tick = async () => {
    await checkBudgets(db).catch((e) => console.warn("[router] budžeti:", (e as Error).message));
    await sealDecisions(db).catch((e) => console.warn("[router] pečat:", (e as Error).message));
    if (Date.now() - purgedAt > 24 * 3600_000) {
      purgedAt = Date.now();
      await purgeDecisions(db, Number(process.env.ROUTER_DECISIONS_DAYS ?? 90)).catch((e) => console.warn("[router] rok čuvanja:", (e as Error).message));
    }
  };
  setTimeout(() => void tick(), 30_000);
  setInterval(() => void tick(), 15 * 60_000);
}

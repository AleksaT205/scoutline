import { and, eq, gte, sql } from "drizzle-orm";
import { routerRules, settings, type Db } from "@radar/db";
import { isRouterGroup, proposeRuleChanges, type GroupStats, type RuleStats } from "@radar/shared";

/**
 * AI Router „učenje“ bez tokena (T9): jednom dnevno SQL nad odlukama rutera (poslednjih 7 dana) →
 * predlozi izmene pravila sa obrazloženjem u brojkama. Ništa se ne menja samo — predlog odobrava čovek u RouterPage.
 */

const KEY = "router_learn_at";
const DAY = 24 * 3600_000;

export async function learnRouterRules(db: Db): Promise<number> {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const rules = await db.select().from(routerRules).where(eq(routerRules.status, "active"));
  if (!rules.length) return 0;
  const ruleRows = await db.execute<{ rule_id: string; requests: number; failed: number; median_chars: number | null }>(sql`
    select rule_id::text, count(*)::int as requests, count(*) filter (where status >= 400 or fallback)::int as failed,
           percentile_cont(0.5) within group (order by chars) as median_chars
    from router_decisions where at >= ${since}::timestamptz and rule_id is not null and blocked is null and not shadow
    group by 1`);
  const groupRows = await db.execute<{ grp: string; requests: number; failed: number; p95: number | null }>(sql`
    select applied as grp, count(*)::int as requests, count(*) filter (where status >= 400 or fallback)::int as failed,
           percentile_cont(0.95) within group (order by ttfb_ms) as p95
    from router_decisions where at >= ${since}::timestamptz and applied is not null and blocked is null
    group by 1`);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const ruleStats: RuleStats[] = [...ruleRows]
    .filter((r) => byId.has(r.rule_id) && isRouterGroup(byId.get(r.rule_id)!.target))
    .map((r) => ({ ruleId: r.rule_id, name: byId.get(r.rule_id)!.name, target: byId.get(r.rule_id)!.target as RuleStats["target"], requests: Number(r.requests), failed: Number(r.failed), medianChars: r.median_chars === null ? null : Math.round(Number(r.median_chars)) }));
  const groupStats: GroupStats[] = [...groupRows].filter((g) => isRouterGroup(g.grp)).map((g) => ({ group: g.grp as GroupStats["group"], requests: Number(g.requests), failed: Number(g.failed), p95Ms: g.p95 === null ? null : Number(g.p95) }));
  const proposals = proposeRuleChanges(ruleStats, groupStats);
  let added = 0;
  for (const p of proposals) {
    const rule = byId.get(p.ruleId)!;
    // Već postoji predlog za ovo pravilo, ili je isti odbijen u poslednje 2 nedelje → preskoči
    const open = await db
      .select({ id: routerRules.id, status: routerRules.status, target: routerRules.target, decidedAt: routerRules.decidedAt })
      .from(routerRules)
      .where(and(eq(routerRules.lineage, rule.lineage), gte(routerRules.createdAt, new Date(Date.now() - 14 * DAY))));
    if (open.some((o) => o.status === "proposed" || (o.status === "rejected" && o.target === p.target))) continue;
    await db.insert(routerRules).values({
      lineage: rule.lineage,
      version: rule.version,
      clientId: rule.clientId,
      key: rule.key,
      name: rule.name,
      condition: rule.condition,
      target: p.target,
      priority: rule.priority,
      status: "proposed",
      reason: p.reason,
      createdBy: "router-learn",
    });
    added++;
  }
  return added;
}

/** Pokreće se iz worker tick-a; radi najviše jednom dnevno (vreme poslednjeg rada je u settings). */
export async function maybeLearnRouterRules(db: Db) {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  const last = Date.parse((row?.value as { at?: string } | undefined)?.at ?? "") || 0;
  if (Date.now() - last < DAY) return;
  const value = { at: new Date().toISOString(), proposals: 0 };
  try {
    value.proposals = await learnRouterRules(db);
    if (value.proposals) console.log(`[worker] AI Router: ${value.proposals} predlog(a) izmene pravila`);
  } catch (e) {
    console.warn("[worker] AI Router učenje:", (e as Error).message);
  }
  await db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

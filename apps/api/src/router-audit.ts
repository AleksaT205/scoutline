import { createHash } from "node:crypto";
import { asc, desc, eq, gt, and, lte, sql } from "drizzle-orm";
import { routerAudit, routerDecisions, type Db } from "@radar/db";

/**
 * Zapis otporan na izmene (T10): svaki red nosi heš prethodnog, pa izmena ili brisanje bilo kog reda kvari lanac.
 * Odluke rutera se ne upisuju pojedinačno u lanac (svaki zahtev bi čekao zaključavanje), nego se na 15 min
 * „pečate“: jedan red u lancu sa hešom svih novih odluka (decisions.seal).
 */

export const GENESIS = "0".repeat(64);
const LOCK = 727273;

/** JSON sa sortiranim ključevima — isti heš i posle čuvanja u jsonb (Postgres menja redosled ključeva). */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function auditHash(prev: string, e: { at: Date; actor: string | null; action: string; entity: string | null; data: unknown }): string {
  return sha(`${prev}\n${canonical({ at: e.at.toISOString(), actor: e.actor, action: e.action, entity: e.entity, data: e.data })}`);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Dodaj red u lanac (pod zaključavanjem, da dva upisa ne dobiju isti prethodni heš). */
export async function appendAudit(db: Db | Tx, e: { actor?: string | null; action: string; entity?: string | null; data?: Record<string, unknown> }) {
  const run = async (tx: Db | Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    const [last] = await tx.select({ hash: routerAudit.hash }).from(routerAudit).orderBy(desc(routerAudit.id)).limit(1);
    const prev = last?.hash ?? GENESIS;
    const at = new Date();
    const row = { at, actor: e.actor ?? null, action: e.action, entity: e.entity ?? null, data: e.data ?? {} };
    await tx.insert(routerAudit).values({ ...row, prevHash: prev, hash: auditHash(prev, row) });
  };
  return "transaction" in db ? (db as Db).transaction(run) : run(db);
}

/** Heš skupa odluka (redom po id-ju) — polja koja određuju šta je ruter uradio. */
export function decisionsDigest(rows: Array<Record<string, unknown>>): string {
  const h = createHash("sha256");
  for (const r of rows)
    h.update(
      `${canonical({ id: r.id, at: r.at instanceof Date ? r.at.toISOString() : r.at, clientId: r.clientId, requested: r.requested, chosen: r.chosen, applied: r.applied, ruleId: r.ruleId, shadow: r.shadow, status: r.status, blocked: r.blocked, callId: r.callId })}\n`,
    );
  return h.digest("hex");
}

const decisionCols = {
  id: routerDecisions.id,
  at: routerDecisions.at,
  clientId: routerDecisions.clientId,
  requested: routerDecisions.requested,
  chosen: routerDecisions.chosen,
  applied: routerDecisions.applied,
  ruleId: routerDecisions.ruleId,
  shadow: routerDecisions.shadow,
  status: routerDecisions.status,
  blocked: routerDecisions.blocked,
  callId: routerDecisions.callId,
};

/** Zapečati nove odluke (starije od 1 min, da se ne seče usred upisa). */
export async function sealDecisions(db: Db): Promise<number> {
  const [last] = await db
    .select({ data: routerAudit.data })
    .from(routerAudit)
    .where(eq(routerAudit.action, "decisions.seal"))
    .orderBy(desc(routerAudit.id))
    .limit(1);
  const fromId = Number((last?.data as { toId?: number } | undefined)?.toId ?? 0);
  const rows = await db
    .select(decisionCols)
    .from(routerDecisions)
    .where(and(gt(routerDecisions.id, fromId), lte(routerDecisions.at, new Date(Date.now() - 60_000))))
    .orderBy(asc(routerDecisions.id))
    .limit(50_000);
  if (!rows.length) return 0;
  const toId = rows[rows.length - 1]!.id;
  await appendAudit(db, { actor: "system", action: "decisions.seal", entity: "router_decisions", data: { fromId, toId, count: rows.length, digest: decisionsDigest(rows) } });
  return rows.length;
}

export interface AuditCheck {
  ok: boolean;
  entries: number;
  sealedDecisions: number;
  prunedSeals: number;
  brokenAt?: number;
  problem?: string;
}

/** Proveri ceo lanac i pečate odluka. */
export async function verifyAudit(db: Db): Promise<AuditCheck> {
  const rows = await db.select().from(routerAudit).orderBy(asc(routerAudit.id));
  let prev = GENESIS;
  let sealed = 0;
  let pruned = 0;
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false, entries: rows.length, sealedDecisions: sealed, prunedSeals: pruned, brokenAt: r.id, problem: "Previous hash does not match (a row was changed, removed or inserted)." };
    const h = auditHash(prev, { at: r.at, actor: r.actor, action: r.action, entity: r.entity, data: r.data });
    if (h !== r.hash) return { ok: false, entries: rows.length, sealedDecisions: sealed, prunedSeals: pruned, brokenAt: r.id, problem: "Row content does not match its hash (the row was edited)." };
    if (r.action === "decisions.seal") {
      const d = r.data as { fromId: number; toId: number; count: number; digest: string };
      const got = await db
        .select(decisionCols)
        .from(routerDecisions)
        .where(and(gt(routerDecisions.id, d.fromId), lte(routerDecisions.id, d.toId)))
        .orderBy(asc(routerDecisions.id));
      if (got.length === 0) pruned++; // obrisano po roku čuvanja — očekivano
      else if (got.length !== d.count || decisionsDigest(got) !== d.digest)
        return { ok: false, entries: rows.length, sealedDecisions: sealed, prunedSeals: pruned, brokenAt: r.id, problem: `Sealed router decisions ${d.fromId + 1}–${d.toId} were changed or removed.` };
      else sealed += got.length;
    }
    prev = r.hash;
  }
  return { ok: true, entries: rows.length, sealedDecisions: sealed, prunedSeals: pruned };
}

/** Rok čuvanja odluka: briše samo cele zapečaćene opsege starije od `days` (da provera lanca ostane ispravna). */
export async function purgeDecisions(db: Db, days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const [m] = await db.execute<{ id: string | null }>(sql`select max(id)::text as id from router_decisions where at < ${cutoff.toISOString()}::timestamptz`);
  const maxOld = Number(m?.id ?? 0);
  if (!maxOld) return 0;
  const [s] = await db.execute<{ to_id: string | null }>(
    sql`select max((data->>'toId')::bigint)::text as to_id from router_audit where action = 'decisions.seal' and (data->>'toId')::bigint <= ${maxOld}`,
  );
  const upTo = Number(s?.to_id ?? 0);
  if (!upTo) return 0;
  const del = await db.delete(routerDecisions).where(lte(routerDecisions.id, upTo)).returning({ id: routerDecisions.id });
  return del.length;
}

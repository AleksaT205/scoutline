import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, isNull } from "drizzle-orm";
import { clients, routerDecisions, routerMembers, routerRules, type Db } from "@radar/db";
import {
  DEFAULT_RULES,
  FREE_GROUPS,
  ROUTER_GROUPS,
  allowedGroupsFor,
  baselineGroup,
  isRouterGroup,
  nearestAllowed,
  requestFeatures,
  routeRequest,
  type RouteInput,
  type RouterGroup,
  type RouterRuleLike,
} from "@radar/shared";
import { maskSecrets } from "./router-mask.js";

/**
 * AI Router 2.0.
 *  - /llm/v1/*   javni, OpenAI/Anthropic-kompatibilan endpoint za aplikacije i agente klijenata (ključ klijenta ili inženjera)
 *  - /router/*   upravljanje (router-admin.ts)
 * Odluka = pravila iz baze (router_rules), bez poziva modela. Ključeve, budžete, keš i fallback radi LiteLLM.
 * Sadržaj promptova i ključevi se nikad ne beleže — u router_decisions ide samo odluka i heš tela.
 */

export const LITELLM_URL = process.env.LITELLM_URL ?? "http://localhost:4000";
const LITELLM_MASTER = process.env.LITELLM_KEY ?? "";
// Cena "premium" modela za poređenje kad traženi model nije poznat (USD po 1M tokena)
export const BASE_IN = Number(process.env.BASELINE_INPUT_PER_M ?? 2.5);
export const BASE_OUT = Number(process.env.BASELINE_OUTPUT_PER_M ?? 10);
export const MODES = ["auto", "fast", "smart"] as const;
export type Mode = (typeof MODES)[number];

const n = (v: unknown) => Number(v ?? 0) || 0;
export const baseline = (pin: number, pout: number) => (pin / 1e6) * BASE_IN + (pout / 1e6) * BASE_OUT;
export { n as num };

/** Stara funkcija (podrazumevana pravila, bez baze) — za kompatibilnost. */
export function pickModel(body: { messages?: Array<{ content?: unknown }>; system?: unknown; tools?: unknown[] }): "fast" | "smart" {
  const t = routeRequest(FALLBACK_RULES, requestFeatures(body)).target;
  return t === "smart" ? "smart" : "fast";
}

export async function litellm<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${LITELLM_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM_MASTER}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } | string; detail?: unknown };
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : (data.error?.message ?? (typeof data.detail === "string" ? data.detail : undefined));
    throw new Error(`LiteLLM ${path}: ${msg ?? `HTTP ${res.status}`}`);
  }
  return data;
}

// ── Pravila (keš 30 s) ───────────────────────────────────────────────────────
const FALLBACK_RULES: RouterRuleLike[] = DEFAULT_RULES.map((r) => ({ id: `default:${r.key}`, clientId: null, name: r.name, condition: r.condition, target: r.target, priority: r.priority }));
let rulesCache: { at: number; rules: RouterRuleLike[] } | null = null;
export const invalidateRules = () => {
  rulesCache = null;
};

export async function activeRules(db: Db): Promise<RouterRuleLike[]> {
  if (rulesCache && Date.now() - rulesCache.at < 30_000) return rulesCache.rules;
  try {
    const rows = await db.select().from(routerRules).where(eq(routerRules.status, "active"));
    const rules = rows
      .filter((r) => isRouterGroup(r.target))
      .map((r) => ({ id: r.id, clientId: r.clientId, name: r.name, condition: r.condition, target: r.target as RouterGroup, priority: r.priority }));
    rulesCache = { at: Date.now(), rules };
    return rules;
  } catch {
    // Baza nedostupna → podrazumevana pravila (ruter i dalje radi)
    return rulesCache?.rules ?? FALLBACK_RULES;
  }
}

/** Upiše podrazumevana globalna pravila koja još ne postoje (po `key`). Poziva se pri startu API-ja. */
export async function ensureDefaultRules(db: Db) {
  const existing = await db.select({ key: routerRules.key }).from(routerRules).where(isNull(routerRules.clientId));
  const have = new Set(existing.map((e) => e.key));
  const missing = DEFAULT_RULES.filter((d) => !have.has(d.key));
  if (!missing.length) return 0;
  await db.insert(routerRules).values(
    missing.map((d) => {
      const id = randomUUID();
      return { id, lineage: id, key: d.key, name: d.name, condition: d.condition, target: d.target, priority: d.priority, status: "active" as const, createdBy: "system" };
    }),
  );
  invalidateRules();
  return missing.length;
}

// ── Ko šalje zahtev (heš ključa kao u LiteLLM-u: sha256 hex) ────────────────
type ClientRow = typeof clients.$inferSelect;
type MemberRow = typeof routerMembers.$inferSelect;
interface Identity {
  client: ClientRow | null;
  member: MemberRow | null;
}
const keyCache = new Map<string, { at: number; v: Identity }>();
export const invalidateKeys = () => keyCache.clear();
export const hashKey = (raw: string) => createHash("sha256").update(raw).digest("hex");

async function identify(db: Db, raw: string | null): Promise<Identity> {
  if (!raw) return { client: null, member: null };
  const token = hashKey(raw);
  const hit = keyCache.get(token);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let [client] = await db.select().from(clients).where(eq(clients.keyToken, token)).limit(1);
  let member: MemberRow | null = null;
  if (!client) {
    const [m] = await db.select().from(routerMembers).where(eq(routerMembers.keyToken, token)).limit(1);
    member = m ?? null;
    if (member) [client] = await db.select().from(clients).where(eq(clients.id, member.clientId)).limit(1);
  }
  const v = { client: client ?? null, member: member ?? null };
  if (keyCache.size > 5000) keyCache.clear();
  keyCache.set(token, { at: Date.now(), v });
  return v;
}

// ── Lepljivost sesije agenta (isti model za glavni tok; promena usred sesije gubi keš) ──
const sticky = new Map<string, { group: RouterGroup; at: number }>();
const STICKY_MS = 2 * 3600_000;
function stickyGet(k: string): RouterGroup | null {
  const s = sticky.get(k);
  if (!s) return null;
  sticky.delete(k);
  if (Date.now() - s.at > STICKY_MS) return null;
  sticky.set(k, { group: s.group, at: Date.now() });
  return s.group;
}
function stickySet(k: string, group: RouterGroup) {
  sticky.delete(k);
  sticky.set(k, { group, at: Date.now() });
  if (sticky.size > 20_000) sticky.delete(sticky.keys().next().value!);
}

// ── Odluka ───────────────────────────────────────────────────────────────────
export interface Decision {
  chosen: RouterGroup | null;
  applied: RouterGroup | null;
  rule: RouterRuleLike | null;
  sticky: boolean;
  mainFlow: boolean;
  blocked: string | null;
}

/**
 * Šta ide gde. Redosled: eksplicitna grupa (fast/smart/local) → pravila → lepljivost sesije → dozvole klijenta → shadow.
 * Eksplicitno tražena nedozvoljena grupa se odbija; izbor rutera se pomera na najbližu dozvoljenu.
 */
export function decide(x: {
  rules: RouterRuleLike[];
  features: RouteInput;
  client: Pick<ClientRow, "id" | "confidential" | "allowedGroups" | "shadow" | "defaultMode"> | null;
  stickyGroup: RouterGroup | null;
}): Decision {
  const { features: f, client } = x;
  const allowed = client ? allowedGroupsFor(client) : [...ROUTER_GROUPS];
  const mainFlow = f.agent && (!f.requestClass || f.requestClass === "main");
  const base = { rule: null, sticky: false, mainFlow };
  if (client && !allowed.length)
    return { ...base, chosen: null, applied: null, blocked: "This client is confidential and has no private model group allowed. In AI Router → client settings, allow the local group (or the client's own key group)." };
  if (isRouterGroup(f.model)) {
    if (!allowed.includes(f.model)) return { ...base, chosen: f.model, applied: null, blocked: `Model group "${f.model}" is not allowed for this key (allowed: ${allowed.join(", ")}).` };
    return { ...base, chosen: f.model, applied: f.model, blocked: null };
  }
  const r = routeRequest(x.rules, f, client?.id ?? null);
  let chosen = r.target;
  let isSticky = false;
  if (mainFlow && x.stickyGroup && x.stickyGroup !== chosen && !(x.stickyGroup === "fast" && chosen === "smart")) {
    chosen = x.stickyGroup; // nadogradnja fast → smart je dozvoljena (razgovor je narastao), sve ostalo ostaje isto
    isSticky = true;
  }
  const ok = nearestAllowed(chosen, allowed);
  if (!ok) return { ...base, rule: r.rule, chosen, applied: null, blocked: `No allowed model group for this request (wanted "${chosen}", allowed: ${allowed.join(", ")}).` };
  let applied = ok;
  if (client?.shadow) applied = nearestAllowed(baselineGroup(f.model, client.defaultMode), allowed) ?? ok;
  return { ...base, rule: r.rule, chosen: ok, applied, sticky: isSticky, blocked: null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^[A-Za-z0-9_-]{8,128}$/;
const tag = (s: string) => s.toLowerCase().replace(/[^a-z0-9:._-]+/g, "-").slice(0, 60);

async function record(db: Db, row: typeof routerDecisions.$inferInsert) {
  try {
    await db.insert(routerDecisions).values(row);
  } catch (e) {
    console.warn("[router] odluka nije upisana:", (e as Error).message);
  }
}

/** Greška u formatu koji klijent očekuje (Anthropic ili OpenAI). */
function errorBody(anthropic: boolean, message: string) {
  return anthropic ? { type: "error", error: { type: "permission_error", message } } : { error: { message, type: "permission_denied", code: 403 } };
}

const ROUTABLE = /\/(chat\/completions|completions|responses|messages|messages\/count_tokens)$/;
const FORWARD_REQ = ["authorization", "x-api-key", "content-type", "anthropic-version", "anthropic-beta", "user-agent"];
const FORWARD_RES = ["content-type", "cache-control", "retry-after", "x-should-retry", "x-litellm-response-cost", "x-litellm-model-id", "x-litellm-call-id", "x-litellm-attempted-fallbacks", "request-id"];

/** Javni proxy: /llm/v1/chat/completions, /llm/v1/messages, /llm/v1/models … */
export function llmProxy(getDb: () => Db) {
  const app = new Hono();
  app.all("/v1/*", async (c) => {
    const t0 = Date.now();
    const path = c.req.path.replace(/^\/llm/, "");
    const hdr = (h: string) => c.req.header(h) ?? null;
    const headers = new Headers();
    for (const h of FORWARD_REQ) {
      const v = hdr(h);
      if (v) headers.set(h, v);
    }
    // Zaglavlja Claude Code-a (sesija, agent, klasa zahteva) idu dalje do LiteLLM-a (session_id u SpendLogs)
    c.req.raw.headers.forEach((v, k) => {
      if (k.toLowerCase().startsWith("x-claude-code-")) headers.set(k, v);
    });
    // Anthropic SDK šalje ključ u x-api-key — LiteLLM ga prima kao Bearer
    if (!headers.has("authorization") && headers.has("x-api-key")) headers.set("authorization", `Bearer ${headers.get("x-api-key")}`);
    const rawKey = (hdr("authorization")?.replace(/^Bearer\s+/i, "") || hdr("x-api-key") || "").trim() || null;

    let body: string | undefined;
    let ctx: (typeof routerDecisions.$inferInsert & { _countOnly: boolean }) | null = null;
    let db: Db | null = null;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      body = await c.req.text();
      if (ROUTABLE.test(path)) {
        let json: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(body) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
        } catch {
          /* nije JSON — prosledi kako jeste */
        }
        if (json) {
          db = getDb();
          const who = await identify(db, rawKey).catch(() => ({ client: null, member: null }) as Identity);
          const h = { requestClass: hdr("x-claude-code-request-class"), sessionId: hdr("x-claude-code-session-id"), agentId: hdr("x-claude-code-agent-id"), userAgent: hdr("user-agent") };
          const features = requestFeatures(json as Parameters<typeof requestFeatures>[0], h);
          const sessionKey = h.sessionId && SESSION.test(h.sessionId) ? `${who.client?.id ?? hashKey(rawKey ?? "").slice(0, 12)}:${h.sessionId}` : null;
          const countOnly = path.endsWith("/count_tokens");
          const d = decide({ rules: await activeRules(db), features, client: who.client, stickyGroup: sessionKey ? stickyGet(sessionKey) : null });
          const anthropic = /\/messages(\/count_tokens)?$/.test(path);
          const base = {
            clientId: who.client?.id ?? null,
            memberId: who.member?.id ?? null,
            requested: features.model || null,
            chosen: d.chosen,
            ruleId: d.rule && UUID.test(d.rule.id) ? d.rule.id : null,
            sticky: d.sticky,
            shadow: !!who.client?.shadow,
            requestClass: features.requestClass,
            sessionId: sessionKey ? h.sessionId : null,
            chars: features.chars,
            tools: features.hasTools,
            stream: json.stream === true,
            promptHash: createHash("sha256").update(body).digest("hex"),
          };
          if (d.blocked || !d.applied) {
            if (!countOnly) void record(db, { ...base, applied: null, status: 403, blocked: d.blocked, totalMs: Date.now() - t0 });
            return c.json(errorBody(anthropic, d.blocked ?? "Request blocked."), 403);
          }
          if (d.mainFlow && sessionKey && !countOnly) stickySet(sessionKey, d.chosen!);
          json.model = d.applied;
          let masked = 0;
          if ((who.client?.maskSecrets ?? true) && FREE_GROUPS.includes(d.applied)) {
            const m = maskSecrets(json);
            json = m.value;
            masked = m.count;
          }
          // Keš identičnih zahteva (LiteLLM, cache_params.mode: default_off → uključuje se po zahtevu):
          // samo OpenAI format, odvojen po klijentu (namespace), poverljivi klijenti se nikad ne keširaju
          if (!anthropic && who.client) {
            const userCache = json.cache && typeof json.cache === "object" ? (json.cache as Record<string, unknown>) : {};
            json.cache = who.client.confidential ? { "no-cache": true, "no-store": true } : { ...userCache, "use-cache": true, namespace: `scoutline-${who.client.id}` };
          }
          body = JSON.stringify(json);
          const tags = ["scoutline", `group:${d.applied}`, d.rule ? `rule:${tag(d.rule.name)}` : "rule:none", features.requestClass ? `class:${features.requestClass}` : "", who.client?.shadow ? `shadow:${d.chosen}` : "", d.sticky ? "sticky" : ""].filter(Boolean);
          headers.set("x-litellm-tags", tags.join(","));
          if (sessionKey) headers.set("x-litellm-session-id", h.sessionId!);
          ctx = { ...base, applied: d.applied, masked, _countOnly: countOnly };
        }
      }
    }

    let res: Response;
    try {
      res = await fetch(`${LITELLM_URL}${path}${new URL(c.req.url).search}`, { method: c.req.method, headers, body, signal: c.req.raw.signal });
    } catch (e) {
      if (ctx && db && !ctx._countOnly) {
        const { _countOnly, ...row } = ctx;
        void record(db, { ...row, status: 502, totalMs: Date.now() - t0 });
      }
      if ((e as Error).name === "AbortError") return new Response(null, { status: 499 });
      return c.json({ error: { message: "AI gateway is unreachable. Try again in a moment.", type: "api_error" } }, 502);
    }
    const ttfb = Date.now() - t0;
    const out = new Headers();
    res.headers.forEach((v, k) => {
      const key = k.toLowerCase();
      if (FORWARD_RES.includes(key) || key.startsWith("anthropic-ratelimit-") || key.startsWith("x-ratelimit-")) out.set(k, v);
    });
    if (ctx) {
      out.set("x-scoutline-routed-to", ctx.applied!);
      if (ctx.shadow && ctx.chosen !== ctx.applied) out.set("x-scoutline-shadow-choice", ctx.chosen!);
    }
    if (!ctx || ctx._countOnly || !db || !res.body) return new Response(res.body, { status: res.status, headers: out });

    // Merenje: vreme do prvog bajta i do kraja (i kod streaming-a) — tok prolazi bez baferovanja
    const { _countOnly, ...row } = ctx;
    const callId = res.headers.get("x-litellm-call-id");
    const fallback = n(res.headers.get("x-litellm-attempted-fallbacks")) > 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      void record(db!, { ...row, callId, fallback, status: res.status, ttfbMs: ttfb, totalMs: Date.now() - t0 });
    };
    c.req.raw.signal.addEventListener("abort", finish, { once: true });
    const stream = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          ctrl.enqueue(chunk);
        },
        flush: finish,
      }),
    );
    return new Response(stream, { status: res.status, headers: out });
  });
  return app;
}

export { routerAdmin } from "./router-admin.js";

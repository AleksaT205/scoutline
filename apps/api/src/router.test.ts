import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RULES, requestFeatures, type RouterRuleLike } from "@radar/shared";
import { decide } from "./router.js";

// ── Odluka rutera (bez baze) ─────────────────────────────────────────────────
const rules: RouterRuleLike[] = DEFAULT_RULES.map((r, i) => ({ ...r, id: `r${i}`, clientId: null }));
const client = (over: Partial<{ confidential: boolean; allowedGroups: string[]; shadow: boolean; defaultMode: "auto" | "fast" | "smart" }> = {}) => ({
  id: "c1",
  confidential: false,
  allowedGroups: ["fast", "smart"],
  shadow: false,
  defaultMode: "auto" as const,
  ...over,
});
const f = (body: Parameters<typeof requestFeatures>[0], h: Parameters<typeof requestFeatures>[1] = {}) => requestFeatures(body, h);
const msg = (t: string) => ({ messages: [{ content: t }] });

describe("odluka rutera", () => {
  it("poverljiv klijent bez privatne grupe se odbija", () => {
    const d = decide({ rules, features: f({ model: "auto", ...msg("hi") }), client: client({ confidential: true, allowedGroups: ["fast"] }), stickyGroup: null });
    expect(d.blocked).toMatch(/confidential/);
    expect(d.applied).toBeNull();
  });
  it("poverljiv klijent ide na local i kad pravilo kaže smart", () => {
    const d = decide({ rules, features: f({ model: "auto", ...msg("x".repeat(5000)) }), client: client({ confidential: true, allowedGroups: ["local"] }), stickyGroup: null });
    expect(d.applied).toBe("local");
  });
  it("eksplicitno tražena nedozvoljena grupa → jasna poruka", () => {
    const d = decide({ rules, features: f({ model: "smart", ...msg("hi") }), client: client({ allowedGroups: ["fast"] }), stickyGroup: null });
    expect(d.blocked).toMatch(/"smart" is not allowed/);
  });
  it("izbor rutera se pomera na najbližu dozvoljenu grupu", () => {
    const d = decide({ rules, features: f({ model: "auto", ...msg("x".repeat(5000)) }), client: client({ allowedGroups: ["fast"] }), stickyGroup: null });
    expect(d.chosen).toBe("fast");
    expect(d.blocked).toBeNull();
  });
  it("shadow: šalje bez rutiranja, a beleži izbor rutera", () => {
    const d = decide({ rules, features: f({ model: "auto", ...msg("hi") }), client: client({ shadow: true }), stickyGroup: null });
    expect(d.chosen).toBe("fast");
    expect(d.applied).toBe("smart");
    const named = decide({ rules, features: f({ model: "claude-haiku-5-5", ...msg("x".repeat(9000)) }), client: client({ shadow: true }), stickyGroup: null });
    expect(named.chosen).toBe("fast");
    expect(named.applied).toBe("fast");
  });
  it("lepljivost sesije: zadrži model, ali dozvoli nadogradnju fast → smart", () => {
    const h = { sessionId: "sess-12345678" };
    const keep = decide({ rules, features: f({ model: "auto", ...msg("short") }, h), client: client(), stickyGroup: "smart" });
    expect(keep.applied).toBe("smart");
    expect(keep.sticky).toBe(true);
    const up = decide({ rules, features: f({ model: "auto", ...msg("x".repeat(5000)) }, h), client: client(), stickyGroup: "fast" });
    expect(up.applied).toBe("smart");
    expect(up.sticky).toBe(false);
    const sub = decide({ rules, features: f({ model: "claude-sonnet-5-5", ...msg("hi") }, { ...h, agentId: "a1" }), client: client(), stickyGroup: "smart" });
    expect(sub.applied).toBe("fast"); // subagent nije glavni tok
  });
  it("bez klijenta (nepoznat ključ) radi sa svim grupama — LiteLLM ionako proverava ključ", () => {
    expect(decide({ rules, features: f({ model: "local", ...msg("hi") }), client: null, stickyGroup: null }).applied).toBe("local");
  });
});

// ── Sa bazom (TEST_DATABASE_URL; u CI-ju je uključeno) ───────────────────────
const TEST_DB = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("AI Router sa bazom", () => {
  const TOKEN = "test-team-token";
  const stamp = randomUUID().slice(0, 8);
  const fakeKey = `sk-test-${stamp}-confidential`;
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let db: Awaited<ReturnType<typeof import("@radar/db")["createDb"]>>;
  let clientId = "";
  const api = async (path: string, init: RequestInit = {}) => {
    const r = await app.request(path, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };

  beforeAll(async () => {
    Object.assign(process.env, { API_TOKEN: TOKEN, DATABASE_URL: TEST_DB, LITELLM_URL: "http://127.0.0.1:9" });
    const m = await import("@radar/db");
    db = m.createDb(TEST_DB);
    await m.migrateLocked(db, fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)), TEST_DB);
    const [c] = await db
      .insert(m.clients)
      .values({ name: `Secret ${stamp}`, keyToken: createHash("sha256").update(fakeKey).digest("hex"), keyAlias: `secret-${stamp}`, keyPreview: "sk-…test", monthlyBudgetUsd: 10, confidential: true, allowedGroups: ["local"] })
      .returning();
    clientId = c!.id;
    const { createApp } = await import("./app.js");
    app = createApp(() => db);
  });

  it("upiše podrazumevana pravila jednom", async () => {
    const { ensureDefaultRules } = await import("./router.js");
    await ensureDefaultRules(db);
    expect(await ensureDefaultRules(db)).toBe(0);
    const r = await api("/router/rules");
    const keys = (r.body.rules as Array<{ key: string | null; status: string; clientId: string | null }>).filter((x) => x.status === "active" && !x.clientId).map((x) => x.key);
    for (const d of DEFAULT_RULES) expect(keys).toContain(d.key);
  });

  it("odbija neispravno pravilo, prima ispravno i pravi verzije", async () => {
    expect((await api("/router/rules", { method: "POST", body: JSON.stringify({ name: "bad", condition: { keywords: "(" }, target: "smart", priority: 1 }) })).status).toBe(400);
    const created = await api("/router/rules", { method: "POST", body: JSON.stringify({ clientId, name: `Rule ${stamp}`, condition: { minChars: 10 }, target: "local", priority: 5 }) });
    expect(created.status).toBe(201);
    const id = (created.body.rule as { id: string }).id;
    const v2 = await api(`/router/rules/${id}`, { method: "PATCH", body: JSON.stringify({ priority: 6 }) });
    expect((v2.body.rule as { version: number }).version).toBe(2);
    const restored = await api(`/router/rules/${id}/restore`, { method: "POST" });
    expect((restored.body.rule as { version: number; priority: number }).version).toBe(3);
    expect((restored.body.rule as { priority: number }).priority).toBe(5);
  });

  it("poverljiv klijent: smart se odbija pre LiteLLM-a, odluka se beleži", async () => {
    const r = await app.request("/llm/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${fakeKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "smart", messages: [{ role: "user", content: "hi" }] }) });
    expect(r.status).toBe(403);
    expect(JSON.stringify(await r.json())).toMatch(/not allowed/);
    const anthropic = await app.request("/llm/v1/messages", { method: "POST", headers: { "x-api-key": fakeKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: "fast", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
    expect(anthropic.status).toBe(403);
    expect(((await anthropic.json()) as { type: string }).type).toBe("error");
    await new Promise((res) => setTimeout(res, 200));
    const d = await api("/router/decisions");
    expect((d.body.decisions as Array<{ clientId: string; blocked: string | null }>).some((x) => x.clientId === clientId && x.blocked)).toBe(true);
  });

  it("lanac zapisa: ispravan, pa otkriva izmenu", async () => {
    const { appendAudit, verifyAudit } = await import("./router-audit.js");
    const { routerAudit } = await import("@radar/db");
    const { eq } = await import("drizzle-orm");
    await appendAudit(db, { actor: "test", action: "test.entry", entity: stamp, data: { b: 2, a: { z: 1, y: [1, "x"] } } });
    expect((await verifyAudit(db)).ok).toBe(true);
    const [row] = await db.select().from(routerAudit).where(eq(routerAudit.entity, stamp));
    await db.update(routerAudit).set({ data: { b: 3 } }).where(eq(routerAudit.id, row!.id));
    const broken = await verifyAudit(db);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBe(row!.id);
    await db.update(routerAudit).set({ data: row!.data }).where(eq(routerAudit.id, row!.id));
    expect((await verifyAudit(db)).ok).toBe(true);
  });

  it("budžet: upozorenje na 95% jednom mesečno", async () => {
    const { sql } = await import("drizzle-orm");
    const { checkBudgets } = await import("./router-jobs.js");
    const m = await import("@radar/db");
    // U test bazi nema LiteLLM-a: dovoljna je mala tabela sa kolonama koje čitamo
    await db.execute(sql`create table if not exists "LiteLLM_SpendLogs" (request_id text primary key, api_key text, spend double precision, prompt_tokens int, completion_tokens int, "startTime" timestamptz, model_group text)`);
    const key = `sk-budget-${stamp}`;
    const token = createHash("sha256").update(key).digest("hex");
    await db.insert(m.clients).values({ name: `Budget ${stamp}`, keyToken: token, keyAlias: `budget-${stamp}`, keyPreview: "sk-…b", monthlyBudgetUsd: 1 });
    await db.execute(sql`insert into "LiteLLM_SpendLogs" (request_id, api_key, spend, prompt_tokens, completion_tokens, "startTime") values (${`r-${stamp}`}, ${token}, 0.96, 10, 10, now())`);
    const sent: string[] = [];
    const first = await checkBudgets(db, async (t) => (sent.push(t), true));
    expect(first.find((a) => a.name === `Budget ${stamp}`)?.level).toBe(95);
    expect(sent.some((t) => t.includes(`Budget ${stamp}`) && t.includes("95%"))).toBe(true);
    const again = await checkBudgets(db, async (t) => (sent.push(t), true));
    expect(again.find((a) => a.name === `Budget ${stamp}`)).toBeUndefined();
  });
});

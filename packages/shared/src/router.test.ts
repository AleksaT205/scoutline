import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  allowedGroupsFor,
  baselineGroup,
  costAt,
  nearestAllowed,
  priceFor,
  proposeRuleChanges,
  requestFeatures,
  routeRequest,
  validateRule,
  type RouterRuleLike,
} from "./router.js";

const rules: RouterRuleLike[] = DEFAULT_RULES.map((r, i) => ({ ...r, id: `r${i}`, clientId: null }));
const route = (body: Parameters<typeof requestFeatures>[0], headers: Parameters<typeof requestFeatures>[1] = {}, list = rules, clientId: string | null = null) =>
  routeRequest(list, requestFeatures(body, headers), clientId);
const msg = (content: string) => ({ messages: [{ content }] });

describe("podrazumevana pravila (stari pickModel)", () => {
  it("kratak običan zahtev → fast, bez pravila", () => {
    const r = route({ model: "auto", ...msg("Translate 'hello' to German") });
    expect(r.target).toBe("fast");
    expect(r.rule).toBeNull();
  });
  it("dug prompt (> 4000 znakova) → smart", () => {
    expect(route(msg("x".repeat(4001))).rule?.name).toBe("Long prompts");
    expect(route(msg("x".repeat(4001))).target).toBe("smart");
  });
  it("alati u aplikaciji → smart", () => {
    expect(route({ ...msg("weather?"), tools: [{ name: "get_weather" }] }).target).toBe("smart");
  });
  it("kod i analiza → smart", () => {
    expect(route(msg("Please refactor this function")).target).toBe("smart");
    expect(route(msg("```js\nlet a\n```")).target).toBe("smart");
  });
});

describe("agenti (Claude Code)", () => {
  const cc = { sessionId: "3f6c1c1e-aaaa-bbbb-cccc-1234567890ab" };
  it("alati kod agenta ne znače automatski smart", () => {
    expect(route({ model: "auto", ...msg("ls"), tools: [{ name: "Bash" }] }, cc).target).toBe("fast");
  });
  it("ključne reči ne važe za agente (sistemski prompt ih uvek ima)", () => {
    expect(route({ model: "auto", ...msg("debug architecture refactor") }, cc).target).toBe("fast");
  });
  it("pozadinski zahtevi i kompakcija → fast, čak i kad traže Sonnet", () => {
    expect(route({ model: "claude-sonnet-5-5", ...msg("title") }, { ...cc, requestClass: "auxiliary" }).target).toBe("fast");
    expect(route({ model: "claude-opus-5-5", ...msg("x".repeat(9000)) }, { ...cc, requestClass: "Compaction" }).target).toBe("fast");
  });
  it("subagent → fast (podesivo pravilom)", () => {
    expect(route({ model: "claude-sonnet-5-5", ...msg("search") }, { ...cc, requestClass: "subagent" }).target).toBe("fast");
  });
  it("glavni tok poštuje traženi model", () => {
    expect(route({ model: "claude-sonnet-5-5", ...msg("hi") }, { ...cc, requestClass: "main" }).target).toBe("smart");
    expect(route({ model: "claude-haiku-5-5", ...msg("hi") }, { ...cc, requestClass: "main" }).target).toBe("fast");
  });
  it("bez hint zaglavlja: agent-id znači subagent", () => {
    expect(requestFeatures(msg("hi"), { agentId: "a1" }).requestClass).toBe("subagent");
    expect(route({ model: "claude-sonnet-5-5", ...msg("hi") }, { ...cc, agentId: "a1" }).target).toBe("fast");
  });
  it("prepozna agenta po User-Agent-u", () => {
    expect(requestFeatures(msg("hi"), { userAgent: "claude-cli/2.1.0 (external, cli)" }).agent).toBe(true);
    expect(requestFeatures(msg("hi"), { userAgent: "python-requests/2.32" }).agent).toBe(false);
  });
});

describe("konkretan model → grupa", () => {
  it("mali modeli po imenu → fast, veliki → smart", () => {
    expect(route({ model: "gpt-5-mini", ...msg("hi") }).target).toBe("fast");
    expect(route({ model: "gemini-3.8-flash", ...msg("hi") }).target).toBe("fast");
    expect(route({ model: "gpt-5", ...msg("hi") }).target).toBe("smart");
    expect(route({ model: "gemini-3-pro", ...msg("hi") }).target).toBe("smart");
  });
});

describe("pravila klijenta i prioritet", () => {
  it("pravilo klijenta ide pre globalnog, tuđe pravilo se ne primenjuje", () => {
    const mine: RouterRuleLike = { id: "c1", clientId: "A", name: "A: everything local", condition: {}, target: "local", priority: 999 };
    const list = [...rules, mine];
    expect(route(msg("x".repeat(5000)), {}, list, "A").target).toBe("local");
    expect(route(msg("x".repeat(5000)), {}, list, "B").target).toBe("smart");
  });
  it("neispravan regex u bazi ne obara ruter (pravilo samo ne važi)", () => {
    const bad: RouterRuleLike = { id: "x", clientId: null, name: "bad", condition: { keywords: "(" }, target: "smart", priority: 1 };
    expect(route(msg("hi"), {}, [bad]).target).toBe("fast");
  });
});

describe("validacija pravila", () => {
  it("prihvata ispravno, odbija loše", () => {
    expect(validateRule({ name: "ok", condition: { minChars: 10, model: "opus" }, target: "smart", priority: 5 })).toBeNull();
    expect(validateRule({ name: "", condition: {}, target: "smart", priority: 5 })).toMatch(/name/);
    expect(validateRule({ name: "a", condition: {}, target: "gpt", priority: 5 })).toMatch(/Target/);
    expect(validateRule({ name: "a", condition: { keywords: "(" }, target: "fast", priority: 5 })).toMatch(/regular expression/);
    expect(validateRule({ name: "a", condition: { foo: 1 }, target: "fast", priority: 5 })).toMatch(/Unknown/);
    expect(validateRule({ name: "a", condition: { minChars: -1 }, target: "fast", priority: 5 })).toMatch(/minChars/);
  });
});

describe("dozvole i poverljivi klijenti", () => {
  it("poverljiv klijent dobija samo privatne grupe", () => {
    expect(allowedGroupsFor({ confidential: true, allowedGroups: ["fast", "smart", "local"] })).toEqual(["local"]);
    expect(allowedGroupsFor({ confidential: true, allowedGroups: ["fast"] })).toEqual([]);
    expect(allowedGroupsFor({ confidential: false, allowedGroups: null })).toEqual(["fast", "smart", "local"]);
  });
  it("najbliža dozvoljena grupa", () => {
    expect(nearestAllowed("smart", ["fast"])).toBe("fast");
    expect(nearestAllowed("fast", ["local"])).toBe("local");
    expect(nearestAllowed("local", ["fast", "smart"])).toBeNull();
  });
});

describe("ušteda", () => {
  it("bez rutiranja: grupa po imenu ili podrazumevani režim", () => {
    expect(baselineGroup("claude-haiku-5-5")).toBe("fast");
    expect(baselineGroup("claude-opus-5-5")).toBe("smart");
    expect(baselineGroup("auto", "fast")).toBe("fast");
    expect(baselineGroup("", "auto")).toBe("smart");
    expect(baselineGroup("local")).toBe("local");
  });
  it("cena po modelu i keš", () => {
    const opus = priceFor("claude-opus-5-5", { input: 2.5, output: 10 });
    expect(opus.input).toBe(4);
    expect(costAt(opus, { input: 1_000_000, output: 100_000 })).toBeCloseTo(6);
    expect(costAt(opus, { input: 1_000_000, output: 0, cacheRead: 1_000_000 })).toBeCloseTo(0.2);
    expect(priceFor("some-model", { input: 2.5, output: 10 }).input).toBe(2.5);
  });
});

describe("predlozi pravila (bez tokena)", () => {
  it("fast često pada → predlog smart, sa brojkama", () => {
    const p = proposeRuleChanges(
      [{ ruleId: "r1", name: "Subagents", target: "fast", requests: 100, failed: 30, medianChars: 800 }],
      [
        { group: "fast", requests: 400, failed: 90, p95Ms: 900 },
        { group: "smart", requests: 200, failed: 4, p95Ms: 3000 },
      ],
    );
    expect(p).toHaveLength(1);
    expect(p[0]!.target).toBe("smart");
    expect(p[0]!.reason).toMatch(/30 of 100 requests \(30%\)/);
  });
  it("kratki zahtevi na smart, fast pouzdan i brži → predlog fast", () => {
    const p = proposeRuleChanges(
      [{ ruleId: "r2", name: "Tools", target: "smart", requests: 80, failed: 1, medianChars: 600 }],
      [
        { group: "fast", requests: 300, failed: 3, p95Ms: 800 },
        { group: "smart", requests: 200, failed: 2, p95Ms: 4000 },
      ],
    );
    expect(p.map((x) => x.target)).toEqual(["fast"]);
  });
  it("premalo podataka → bez predloga", () => {
    expect(proposeRuleChanges([{ ruleId: "r", name: "x", target: "fast", requests: 5, failed: 5, medianChars: 10 }], [{ group: "smart", requests: 50, failed: 0, p95Ms: 1 }])).toEqual([]);
  });
});

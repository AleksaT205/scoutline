/**
 * AI Router — pravila rutiranja (deli ih API, worker i web).
 * Bez poziva modela: odluka je čisto pravilo nad osobinama zahteva (dužina, alati, klasa zahteva, traženi model, ključne reči).
 */

/** Grupe modela u LiteLLM-u (infra/litellm.config.yaml). */
export const ROUTER_GROUPS = ["fast", "smart", "local"] as const;
export type RouterGroup = (typeof ROUTER_GROUPS)[number];

/** Besplatni cloud nivoi — podaci mogu da se koriste za treniranje (docs/COSTS.md). Poverljivi klijenti ih nikad ne dobijaju. */
export const FREE_GROUPS: readonly RouterGroup[] = ["fast", "smart"];
/** Privatne grupe: lokalni Ollama (podaci ne izlaze sa servera). */
export const PRIVATE_GROUPS: readonly RouterGroup[] = ["local"];

export const isRouterGroup = (v: unknown): v is RouterGroup => typeof v === "string" && (ROUTER_GROUPS as readonly string[]).includes(v);

/**
 * Klasa zahteva iz zaglavlja agenta: Claude Code šalje x-claude-code-request-class tek uz
 * CLAUDE_CODE_GATEWAY_HINT_HEADERS=1 (code.claude.com/docs/en/llm-gateway-protocol). Bez toga: x-claude-code-agent-id → subagent.
 */
export const REQUEST_CLASSES = ["main", "subagent", "workflow", "compaction", "auxiliary"] as const;

/** Uslov pravila — sva navedena polja moraju da važe (I). Prazan uslov važi uvek. */
export interface RuleCondition {
  /** Najmanje znakova u promptu (sistem + poruke). */
  minChars?: number;
  /** Najviše znakova u promptu. */
  maxChars?: number;
  /** true = zahtev ima alate, false = nema. */
  tools?: boolean;
  /** true = zahtev agenta (Claude Code, Codex…), false = obična aplikacija. */
  agent?: boolean;
  /** Klasa zahteva agenta, npr. ["auxiliary", "compaction"]. */
  requestClass?: string[];
  /** Regex nad imenom traženog modela (npr. "haiku|mini"). */
  model?: string;
  /** Regex nad tekstom prompta (bez razlikovanja velikih i malih slova). */
  keywords?: string;
}

export interface RouterRuleLike {
  id: string;
  clientId: string | null;
  name: string;
  condition: RuleCondition;
  target: RouterGroup;
  priority: number;
}

/** Osobine zahteva — računaju se jednom po zahtevu (requestFeatures). */
export interface RouteInput {
  chars: number;
  hasTools: boolean;
  agent: boolean;
  requestClass: string | null;
  /** Traženi model (prazno ili "auto" = bez želje). */
  model: string;
  /** Tekst za ključne reči (skraćen). */
  text: string;
}

const KEYWORD_TEXT_LIMIT = 20_000;

/** Tekst svih poruka i sistema, kao kod starog pickModel-a. */
export function promptText(body: { messages?: Array<{ content?: unknown }>; system?: unknown; input?: unknown }): string {
  const parts = [body.system, ...(body.messages ?? []).map((m) => m?.content), body.input];
  return parts
    .filter((c) => c !== undefined && c !== null)
    .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
    .join("\n");
}

/** Osobine zahteva iz tela i zaglavlja. */
export function requestFeatures(
  body: { model?: unknown; messages?: Array<{ content?: unknown }>; system?: unknown; tools?: unknown[]; input?: unknown },
  headers: { requestClass?: string | null; sessionId?: string | null; agentId?: string | null; userAgent?: string | null } = {},
): RouteInput {
  const text = promptText(body);
  const ua = headers.userAgent ?? "";
  const agent = !!(headers.requestClass || headers.sessionId || headers.agentId) || /claude-cli|claude-code|codex/i.test(ua);
  // Bez hint zaglavlja: zahtev sa agent-id je subagent (Claude Code ga šalje uvek)
  const requestClass = headers.requestClass?.trim().toLowerCase() || (headers.agentId ? "subagent" : null);
  return {
    chars: text.length,
    hasTools: Array.isArray(body.tools) && body.tools.length > 0,
    agent,
    requestClass,
    model: typeof body.model === "string" ? body.model.trim() : "",
    text: text.length > KEYWORD_TEXT_LIMIT ? text.slice(-KEYWORD_TEXT_LIMIT) : text,
  };
}

const regexCache = new Map<string, RegExp | null>();
function re(src: string): RegExp | null {
  if (!regexCache.has(src)) {
    let r: RegExp | null = null;
    try {
      r = new RegExp(src, "i");
    } catch {
      r = null;
    }
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(src, r);
  }
  return regexCache.get(src)!;
}

export function matchRule(c: RuleCondition, x: RouteInput): boolean {
  if (c.minChars !== undefined && x.chars < c.minChars) return false;
  if (c.maxChars !== undefined && x.chars > c.maxChars) return false;
  if (c.tools !== undefined && x.hasTools !== c.tools) return false;
  if (c.agent !== undefined && x.agent !== c.agent) return false;
  if (c.requestClass?.length && !(x.requestClass && c.requestClass.map((s) => s.toLowerCase()).includes(x.requestClass))) return false;
  if (c.model) {
    const r = re(c.model);
    if (!r || !x.model || !r.test(x.model)) return false;
  }
  if (c.keywords) {
    const r = re(c.keywords);
    if (!r || !r.test(x.text)) return false;
  }
  return true;
}

/** Redosled: prvo pravila klijenta, pa globalna; u okviru grupe manji prioritet ide prvi. */
export function sortRules<T extends RouterRuleLike>(rules: T[], clientId: string | null): T[] {
  return rules
    .filter((r) => r.clientId === null || (clientId !== null && r.clientId === clientId))
    .sort((a, b) => (a.clientId === b.clientId ? a.priority - b.priority : a.clientId ? -1 : 1));
}

export const DEFAULT_TARGET: RouterGroup = "fast";

/** Prvo pravilo koje važi; bez pogotka → fast. */
export function routeRequest<T extends RouterRuleLike>(rules: T[], input: RouteInput, clientId: string | null = null): { target: RouterGroup; rule: T | null } {
  for (const r of sortRules(rules, clientId)) if (matchRule(r.condition, input)) return { target: r.target, rule: r };
  return { target: DEFAULT_TARGET, rule: null };
}

/** Podrazumevana globalna pravila (stara pickModel logika + agenti). `key` služi za prvo upisivanje u bazu. */
export const DEFAULT_RULES: Array<Omit<RouterRuleLike, "id" | "clientId"> & { key: string }> = [
  { key: "agent-background", name: "Agent background work (titles, summaries, compaction)", condition: { requestClass: ["auxiliary", "compaction"] }, target: "fast", priority: 10 },
  { key: "agent-subagent", name: "Agent subagents and workflows", condition: { requestClass: ["subagent", "workflow"] }, target: "fast", priority: 20 },
  { key: "model-small", name: "Small models by name", condition: { model: "haiku|[-_]mini|nano|flash|lite" }, target: "fast", priority: 30 },
  { key: "model-large", name: "Large models by name", condition: { model: "opus|sonnet|fable|gpt-[45]|\\bo[34]\\b|pro|large" }, target: "smart", priority: 40 },
  { key: "long-prompt", name: "Long prompts", condition: { minChars: 4000 }, target: "smart", priority: 50 },
  { key: "tools-apps", name: "Tool use (apps, not agents)", condition: { tools: true, agent: false }, target: "smart", priority: 60 },
  {
    key: "code-words",
    name: "Code and analysis words (apps)",
    condition: { agent: false, keywords: "```|\\b(refactor|debug|stack trace|architecture|analy[sz]e|step by step|prove|contract|legal)\\b" },
    target: "smart",
    priority: 70,
  },
];

/**
 * Šta bi išlo BEZ rutiranja (za shadow režim i uštedu): grupa po imenu modela,
 * a za "auto"/nepoznato podrazumevani režim klijenta (auto → smart, tj. jači model).
 */
export function baselineGroup(model: string, defaultMode: "auto" | "fast" | "smart" = "auto"): RouterGroup {
  if (isRouterGroup(model)) return model;
  if (model && model !== "auto") return /haiku|[-_]mini|nano|flash|lite/i.test(model) ? "fast" : "smart";
  return defaultMode === "fast" ? "fast" : "smart";
}

/** Čitljiv opis uslova (UI i obrazloženja). */
export function describeCondition(c: RuleCondition): string {
  const p: string[] = [];
  if (c.requestClass?.length) p.push(`request class is ${c.requestClass.join(" or ")}`);
  if (c.model) p.push(`model matches /${c.model}/`);
  if (c.minChars !== undefined) p.push(`prompt ≥ ${c.minChars.toLocaleString("en-US")} chars`);
  if (c.maxChars !== undefined) p.push(`prompt ≤ ${c.maxChars.toLocaleString("en-US")} chars`);
  if (c.tools !== undefined) p.push(c.tools ? "has tools" : "no tools");
  if (c.agent !== undefined) p.push(c.agent ? "from an agent" : "not from an agent");
  if (c.keywords) p.push(`text matches /${c.keywords}/`);
  return p.length ? p.join(" · ") : "always";
}

/** Provera pravila pre upisa — vraća poruku greške ili null. */
export function validateRule(r: { name?: unknown; condition?: unknown; target?: unknown; priority?: unknown }): string | null {
  if (typeof r.name !== "string" || !r.name.trim()) return "Rule name is required.";
  if (r.name.length > 120) return "Rule name is too long.";
  if (!isRouterGroup(r.target)) return `Target must be one of: ${ROUTER_GROUPS.join(", ")}.`;
  const pr = Number(r.priority);
  if (!Number.isInteger(pr) || pr < 0 || pr > 10_000) return "Priority must be a whole number between 0 and 10000.";
  const c = r.condition;
  if (!c || typeof c !== "object" || Array.isArray(c)) return "Condition must be an object.";
  const cond = c as Record<string, unknown>;
  const allowed = ["minChars", "maxChars", "tools", "agent", "requestClass", "model", "keywords"];
  const extra = Object.keys(cond).filter((k) => !allowed.includes(k));
  if (extra.length) return `Unknown condition field: ${extra.join(", ")}.`;
  for (const k of ["minChars", "maxChars"]) {
    if (cond[k] !== undefined && !(Number.isInteger(cond[k]) && (cond[k] as number) >= 0 && (cond[k] as number) <= 10_000_000)) return `${k} must be a whole number ≥ 0.`;
  }
  for (const k of ["tools", "agent"]) if (cond[k] !== undefined && typeof cond[k] !== "boolean") return `${k} must be true or false.`;
  if (cond.requestClass !== undefined && !(Array.isArray(cond.requestClass) && cond.requestClass.every((s) => typeof s === "string" && s.length <= 40))) return "requestClass must be a list of names.";
  for (const k of ["model", "keywords"]) {
    const v = cond[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || !v || v.length > 500) return `${k} must be a regular expression (up to 500 characters).`;
    try {
      new RegExp(v, "i");
    } catch {
      return `${k} is not a valid regular expression.`;
    }
  }
  return null;
}

/** Klijent sme samo u dozvoljene grupe; poverljiv samo u privatne. */
export function allowedGroupsFor(client: { confidential: boolean; allowedGroups: string[] | null }): RouterGroup[] {
  const list = (client.allowedGroups?.length ? client.allowedGroups : [...FREE_GROUPS, ...PRIVATE_GROUPS]).filter(isRouterGroup);
  return client.confidential ? list.filter((g) => PRIVATE_GROUPS.includes(g)) : list;
}

/** Ako ruter izabere nedozvoljenu grupu: najbliža dozvoljena (smart ↔ fast, pa local), inače null. */
export function nearestAllowed(target: RouterGroup, allowed: RouterGroup[]): RouterGroup | null {
  if (allowed.includes(target)) return target;
  const order: Record<RouterGroup, RouterGroup[]> = { fast: ["smart", "local"], smart: ["fast", "local"], local: [] };
  return order[target].find((g) => allowed.includes(g)) ?? null;
}

// ── Cene (za uštedu, T7) ─────────────────────────────────────────────────────
/** USD po 1M tokena. Proveriti pri promeni cenovnika; datum piše u PRICES_AS_OF. */
export const PRICES_AS_OF = "2026-11-18";
export interface ModelPrice {
  match: string;
  label: string;
  input: number;
  output: number;
  cacheRead?: number;
}
/** Zvanične cene Anthropic modela (Claude API). Ostalo → BASELINE_* iz env-a (premium klasa). */
export const MODEL_PRICES: ModelPrice[] = [
  { match: "fable", label: "Claude Fable 5.2", input: 8, output: 40, cacheRead: 0.2 },
  { match: "opus", label: "Claude Opus 5.5", input: 4, output: 20, cacheRead: 0.2 },
  { match: "sonnet", label: "Claude Sonnet 5.5", input: 2, output: 10, cacheRead: 0.1 },
  { match: "haiku", label: "Claude Haiku 5.5", input: 0.1, output: 0.5 },
];
export function priceFor(model: string, fallback: { input: number; output: number }): ModelPrice {
  const m = MODEL_PRICES.find((p) => model.toLowerCase().includes(p.match));
  return m ?? { match: "", label: "Premium model (baseline)", input: fallback.input, output: fallback.output };
}
/** Trošak istih tokena po ceni modela (keširani ulaz po ceni čitanja iz keša, ako je poznata). */
export function costAt(p: ModelPrice, tokens: { input: number; output: number; cacheRead?: number }): number {
  const cached = Math.min(tokens.cacheRead ?? 0, tokens.input);
  return ((tokens.input - cached) / 1e6) * p.input + (cached / 1e6) * (p.cacheRead ?? p.input) + (tokens.output / 1e6) * p.output;
}

// ── „Učenje“ bez tokena (T9): predlozi iz statistike ─────────────────────────
export interface GroupStats {
  group: RouterGroup;
  requests: number;
  failed: number; // greške + fallback
  p95Ms: number | null;
}
export interface RuleStats {
  ruleId: string;
  name: string;
  target: RouterGroup;
  requests: number;
  failed: number;
  medianChars: number | null;
}
export interface RuleProposal {
  ruleId: string;
  target: RouterGroup;
  reason: string;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/**
 * Pravila: (1) cilj pravila često pada, a druga grupa radi → predlog druge grupe;
 * (2) pravilo šalje na smart kratke zahteve, a fast je pouzdan i brži → predlog fast.
 * Samo predlozi — čovek odobrava u RouterPage.
 */
export function proposeRuleChanges(rules: RuleStats[], groups: GroupStats[], minRequests = 30): RuleProposal[] {
  const g = new Map(groups.map((x) => [x.group, x]));
  const rate = (x?: GroupStats) => (x && x.requests ? x.failed / x.requests : 1);
  const out: RuleProposal[] = [];
  for (const r of rules) {
    if (r.requests < minRequests) continue;
    const ruleFail = r.failed / r.requests;
    if (r.target === "fast" && ruleFail >= 0.15) {
      const smart = g.get("smart");
      if (smart && smart.requests >= 10 && rate(smart) < ruleFail / 2)
        out.push({
          ruleId: r.ruleId,
          target: "smart",
          reason: `"${r.name}": ${r.failed} of ${r.requests} requests (${pct(r.failed, r.requests)}%) on fast failed or fell back in 7 days; smart failed ${pct(smart.failed, smart.requests)}% of ${smart.requests}.`,
        });
      continue;
    }
    if (r.target === "smart") {
      const fast = g.get("fast");
      const smart = g.get("smart");
      if (
        fast &&
        smart &&
        fast.requests >= minRequests &&
        rate(fast) <= 0.03 &&
        ruleFail <= 0.05 &&
        r.medianChars !== null &&
        r.medianChars < 1500 &&
        fast.p95Ms !== null &&
        smart.p95Ms !== null &&
        fast.p95Ms * 1.5 < smart.p95Ms
      )
        out.push({
          ruleId: r.ruleId,
          target: "fast",
          reason: `"${r.name}": ${r.requests} requests in 7 days, median ${r.medianChars} chars. fast p95 ${Math.round(fast.p95Ms)} ms vs smart ${Math.round(smart.p95Ms)} ms, fast failed ${pct(fast.failed, fast.requests)}%. Short prompts may not need smart — check answer quality before approving.`,
        });
    }
  }
  return out;
}

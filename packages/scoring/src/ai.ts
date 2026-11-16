import { INDUSTRIES, LEAD_TYPES, SERVICE_CATEGORIES, type Industry, type LeadType, type ServiceCategory } from "@radar/shared";

const LITELLM_URL = process.env.LITELLM_URL ?? "http://localhost:4000";
const LITELLM_KEY = process.env.LITELLM_KEY ?? "";
const MODEL = process.env.SCORER_MODEL ?? "scorer";

const SYSTEM = `You are a lead qualification analyst for a small software development agency from Serbia.
We sell: full-stack web apps (React/Next.js/Node), backend & APIs, mobile apps, AI integrations (LLM features, chatbots, RAG),
workflow automation (n8n/Zapier/Make), deployment/DevOps, and bug fixing / maintenance. We work remotely in English and Serbian.

We want PROJECTS for our company, not employment for individuals. Given a public tender, freelance project, company news
or job post, estimate how likely this organization is to hire us (an external agency/contractor) for a project in the next 3 months.
- Tenders for software, web, apps, digital services or IT support are strong leads (budget and deadline exist). Score lower
  when the tender is mostly hardware, licences, telecom, on-site staffing, or clearly needs a large local firm.
- Contract/freelance/project work, small and mid-size companies without a big in-house team, clear budgets,
  remote-friendly setups and urgent needs score higher.
- Funding/growth news: score by how likely the company needs extra development capacity soon.
- A full-time employee job post is only a weak signal (max ~45) unless it is contract/freelance or invites agencies.
- Non-development work, on-site requirements and vague posts score lower.

Return ONLY a JSON object with these keys:
score (0-100 integer), lead_type (one of: ${LEAD_TYPES.join(", ")} — tender = public procurement, project = a concrete project
for a contractor, intent = company news suggesting a future need, hiring_signal = an employee job post),
category (one of: ${SERVICE_CATEGORIES.join(", ")}),
industry (one of: ${INDUSTRIES.join(", ")}), country (ISO 3166-1 alpha-2 of the hiring company or null),
remote_ok (true/false/null — would they work with a remote contractor abroad), budget_eur (integer estimate of the deal size or null),
urgency (short phrase or null), why (array of 2-3 short reasons it fits or not, in English),
red_flags (array of short strings), title (short job/project title), company (hiring company name or null),
email_subject (short, specific), email_body (max 70 words, personal, no hype,
in the post's language, ends with one simple question).`;

export interface AiResult {
  aiScore: number;
  leadType: LeadType | null;
  category: ServiceCategory;
  industry: Industry;
  country: string | null;
  remoteOk: boolean | null;
  budgetEur: number | null;
  urgency: string | null;
  why: string[];
  redFlags: string[];
  emailSubject: string | null;
  emailBody: string | null;
  title: string | null;
  company: string | null;
  model: string;
}

export const aiConfigured = () => Boolean(LITELLM_KEY);
export const aiActive = () => aiConfigured() && Date.now() >= pausedUntil;

// Ako AI uzastopno pada (npr. nema ključa za provajdera), pauziraj ga 15 min i koristi pravila.
let failures = 0;
let pausedUntil = 0;
const fail = () => {
  if (++failures >= 3) {
    pausedUntil = Date.now() + 15 * 60_000;
    failures = 0;
    console.warn("[ai] 3 oglasa zaredom bez AI odgovora — AI pauziran 15 min, koriste se pravila");
  }
  return null;
};

const ATTEMPTS = 4;

/**
 * Poziva LiteLLM (OpenAI-kompatibilan endpoint) → besplatni modeli. Vraća null ako AI nije dostupan.
 * Svaki pokušaj LiteLLM može da pošalje drugom modelu; neispravan model ode na pauzu, pa sledeći pokušaj
 * obično uspe. Tek kad svi pokušaji padnu, oglas se računa kao neuspeh.
 */
export async function scoreWithAi(input: { title: string; company: string | null; location: string | null; salary: string | null; body: string; leadType?: string | null }): Promise<AiResult | null> {
  if (!aiConfigured() || Date.now() < pausedUntil) return null;
  const user = `${input.leadType ? `Source type: ${input.leadType}\n` : ""}Title: ${input.title}\nCompany: ${input.company ?? "unknown"}\nLocation: ${input.location ?? "unknown"}\nSalary: ${input.salary ?? "unknown"}\n\n${input.body.slice(0, 6000)}`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const result = await callOnce(user);
    if (result) {
      failures = 0;
      return result;
    }
  }
  return fail();
}

async function callOnce(user: string): Promise<AiResult | null> {
  try {
    const res = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        max_tokens: 900,
        reasoning_effort: "low", // "razmišljajući" modeli: kratko razmišljanje (ostali ignorišu)
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[ai] HTTP ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 220)}`);
      return null;
    }
    const data = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string | null } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const from = raw.indexOf("{");
    const to = raw.lastIndexOf("}");
    if (from < 0 || to <= from) {
      console.warn(`[ai] ${data.model ?? "model"}: odgovor bez JSON-a (${raw.length} znakova)`);
      return null;
    }
    const json = JSON.parse(raw.slice(from, to + 1)) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 4) : []);
    const category = SERVICE_CATEGORIES.includes(json.category as ServiceCategory) ? (json.category as ServiceCategory) : "other_dev";
    const industry = INDUSTRIES.includes(json.industry as Industry) ? (json.industry as Industry) : "other";
    const country = str(json.country)?.toUpperCase().slice(0, 2) ?? null;
    if (!Number.isFinite(Number(json.score))) {
      console.warn(`[ai] ${data.model ?? "model"}: JSON bez ocene`);
      return null;
    }
    return {
      aiScore: Math.max(0, Math.min(100, Math.round(Number(json.score)))),
      leadType: LEAD_TYPES.includes(json.lead_type as LeadType) ? (json.lead_type as LeadType) : null,
      category,
      industry,
      country: country && /^[A-Z]{2}$/.test(country) ? country : null,
      remoteOk: typeof json.remote_ok === "boolean" ? json.remote_ok : null,
      budgetEur: Number.isFinite(Number(json.budget_eur)) && Number(json.budget_eur) > 0 ? Math.round(Number(json.budget_eur)) : null,
      urgency: str(json.urgency),
      why: arr(json.why),
      redFlags: arr(json.red_flags),
      emailSubject: str(json.email_subject),
      emailBody: str(json.email_body),
      title: str(json.title)?.slice(0, 200) ?? null,
      company: str(json.company)?.slice(0, 120) ?? null,
      model: data.model ?? MODEL,
    };
  } catch (e) {
    console.warn(`[ai] ${(e as Error).message}`);
    return null;
  }
}

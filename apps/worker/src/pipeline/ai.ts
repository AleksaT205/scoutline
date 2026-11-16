import { INDUSTRIES, SERVICE_CATEGORIES, type Industry, type ServiceCategory } from "@radar/shared";

const LITELLM_URL = process.env.LITELLM_URL ?? "http://localhost:4000";
const LITELLM_KEY = process.env.LITELLM_KEY ?? "";
const MODEL = process.env.SCORER_MODEL ?? "scorer";

const SYSTEM = `You are a lead qualification analyst for a small software development agency from Serbia.
We sell: full-stack web apps (React/Next.js/Node), backend & APIs, mobile apps, AI integrations (LLM features, chatbots, RAG),
workflow automation (n8n/Zapier/Make), deployment/DevOps, and bug fixing / maintenance. We work remotely in English and Serbian.

Given a job post, freelance project or tender, estimate how likely this organization is to hire us (an external agency/contractor)
in the next 3 months. Contract/freelance/project work, small and mid-size companies without a big in-house team, clear budgets,
remote-friendly setups and urgent needs score higher. Full-time-only senior roles at large companies, on-site requirements,
non-development roles and vague posts score lower.

Return ONLY a JSON object with these keys:
score (0-100 integer), category (one of: ${SERVICE_CATEGORIES.join(", ")}),
industry (one of: ${INDUSTRIES.join(", ")}), country (ISO 3166-1 alpha-2 of the hiring company or null),
remote_ok (true/false/null — would they work with a remote contractor abroad), budget_eur (integer estimate of the deal size or null),
urgency (short phrase or null), why (array of 2-3 short reasons it fits or not, in English),
red_flags (array of short strings), email_subject (short, specific), email_body (max 70 words, personal, no hype,
in the post's language, ends with one simple question).`;

export interface AiResult {
  aiScore: number;
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
    console.warn("[ai] 3 greške zaredom — AI pauziran 15 min, koriste se pravila");
  }
  return null;
};

/** Poziva LiteLLM (OpenAI-kompatibilan endpoint) → besplatni modeli. Vraća null ako AI nije dostupan. */
export async function scoreWithAi(input: { title: string; company: string | null; location: string | null; salary: string | null; body: string }): Promise<AiResult | null> {
  if (!aiConfigured() || Date.now() < pausedUntil) return null;
  const user = `Title: ${input.title}\nCompany: ${input.company ?? "unknown"}\nLocation: ${input.location ?? "unknown"}\nSalary: ${input.salary ?? "unknown"}\n\n${input.body.slice(0, 6000)}`;
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
        max_tokens: 700,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`[ai] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return fail();
    }
    const data = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 4) : []);
    const category = SERVICE_CATEGORIES.includes(json.category as ServiceCategory) ? (json.category as ServiceCategory) : "other_dev";
    const industry = INDUSTRIES.includes(json.industry as Industry) ? (json.industry as Industry) : "other";
    const country = str(json.country)?.toUpperCase().slice(0, 2) ?? null;
    failures = 0;
    return {
      aiScore: Math.max(0, Math.min(100, Math.round(Number(json.score) || 0))),
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
      model: data.model ?? MODEL,
    };
  } catch (e) {
    console.warn(`[ai] ${(e as Error).message}`);
    return fail();
  }
}

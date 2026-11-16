import { finalScore, tierOf, type Industry, type LeadStatus, type ServiceCategory, type Tier } from "@radar/shared";
import { scoreWithAi } from "./ai.js";
import { budgetFromSalary, scoreByRules } from "./rules.js";

const CATEGORY_TEXT: Record<string, string> = {
  fullstack_app: "full-stack web apps",
  web_frontend: "modern web frontends",
  backend_api: "backends and APIs",
  mobile: "mobile apps",
  ai_integration: "AI features and integrations",
  automation: "workflow automation",
  devops_deploy: "deployment and DevOps",
  bugfix_maintenance: "bug fixing and maintenance",
  other_dev: "software projects",
};

export interface ScoreInput {
  title: string;
  company: string | null;
  location: string | null;
  salaryText: string | null;
  body: string;
  /** Ono što je već poznato bez AI-a (iz lokacije/teksta). */
  prior?: { country: string | null; remoteOk: boolean | null };
  /** false = ne pokušavaj AI (npr. kad je pauziran) */
  useAi?: boolean;
}

export interface LeadScore {
  aiScore: number;
  score: number;
  category: ServiceCategory;
  industry: Industry;
  country: string | null;
  tier: Tier | null;
  remoteOk: boolean | null;
  budgetEur: number | null;
  urgency: string | null;
  why: string[];
  redFlags: string[];
  emailSubject: string;
  emailBody: string;
  scoredBy: string; // "ai:<model>" | "rules"
  status: LeadStatus;
  /** Samo AI: naziv pozicije i firme (korisno kod ručno dodatih leadova). */
  aiTitle: string | null;
  aiCompany: string | null;
}

/** Oceni jedan oglas: AI ako je dostupan, inače pravila. Isto se koristi u worker-u i API-ju. */
export async function scoreItem(input: ScoreInput): Promise<LeadScore> {
  const ai = input.useAi === false ? null : await scoreWithAi({ title: input.title, company: input.company, location: input.location, salary: input.salaryText, body: input.body });
  const rules = ai ? null : scoreByRules(input.title, input.body);

  const country = ai?.country ?? input.prior?.country ?? null;
  const tier = country ? tierOf(country) : null;
  const remoteOk = ai?.remoteOk ?? input.prior?.remoteOk ?? null;
  const budgetEur = ai?.budgetEur ?? budgetFromSalary(input.salaryText);
  const category = ai?.category ?? rules!.category;
  const aiScore = ai?.aiScore ?? rules!.aiScore;
  const score = category === "not_relevant" ? 0 : finalScore({ aiScore, tier: tier ?? "T2", remoteOk, budgetEur });
  const offer = CATEGORY_TEXT[category] ?? "software projects";
  const title = input.title.slice(0, 80);

  return {
    aiScore,
    score,
    category,
    industry: ai?.industry ?? rules!.industry,
    country,
    tier,
    remoteOk,
    budgetEur,
    urgency: ai?.urgency ?? null,
    why: ai?.why.length ? ai.why : [`Matches our ${offer} offer.`, remoteOk ? "Open to remote work." : "Remote setup not confirmed."],
    redFlags: ai?.redFlags ?? [],
    emailSubject: ai?.emailSubject ?? `${title.slice(0, 60)} — quick idea`,
    emailBody:
      ai?.emailBody ??
      `Hi, saw you're looking for help with "${title}". We're a small remote team focused on ${offer} and could share a short plan with timeline and cost. Would a 15-minute call next week be useful?`,
    scoredBy: ai ? `ai:${ai.model}` : "rules",
    status: category === "not_relevant" || score < 20 ? "hidden" : "new",
    aiTitle: ai?.title ?? null,
    aiCompany: ai?.company ?? null,
  };
}

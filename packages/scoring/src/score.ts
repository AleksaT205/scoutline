import { finalScore, tierOf, type Industry, type LeadStatus, type LeadType, type ServiceCategory, type Tier } from "@radar/shared";
import { scoreWithAi } from "./ai.js";
import { CONTRACT, budgetFromSalary, scoreByRules } from "./rules.js";

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
  /** Tip iz izvora (tender, project, intent, hiring_signal). */
  leadType?: LeadType | null;
  /** Vrednost iz izvora (npr. procenjena vrednost tendera) — ima prednost nad procenom. */
  budgetHintEur?: number | null;
  /** Rok za prijavu (tenderi). */
  deadline?: Date | null;
}

export interface LeadScore {
  aiScore: number;
  score: number;
  leadType: LeadType;
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
  const hint = input.leadType ?? null;
  const ai = input.useAi === false ? null : await scoreWithAi({ title: input.title, company: input.company, location: input.location, salary: input.salaryText, body: input.body, leadType: hint });
  const rules = ai ? null : scoreByRules(input.title, input.body, hint);
  // Tender i signal investicije ostaju kako ih je izvor označio; kod oglasa AI (ili tekst) odlučuje projekat ili zaposlenje.
  const leadType: LeadType =
    hint === "tender" || hint === "intent"
      ? hint
      : ai?.leadType === "project" || ai?.leadType === "hiring_signal"
        ? ai.leadType
        : (hint ?? (CONTRACT.test(`${input.title}\n${input.body.slice(0, 2000)}`) ? "project" : "hiring_signal"));

  const country = ai?.country ?? input.prior?.country ?? null;
  const tier = country ? tierOf(country) : null;
  const remoteOk = ai?.remoteOk ?? input.prior?.remoteOk ?? null;
  const budgetEur = input.budgetHintEur ?? ai?.budgetEur ?? budgetFromSalary(input.salaryText);
  const category = ai?.category ?? rules!.category;
  let aiScore = ai?.aiScore ?? rules!.aiScore;
  if (leadType === "hiring_signal") aiScore = Math.min(aiScore, 50); // zaposlenje je slab signal za agenciju
  const daysLeft = input.deadline ? (input.deadline.getTime() - Date.now()) / 86_400_000 : null;
  if (daysLeft !== null && daysLeft < 5) aiScore -= 15; // premalo vremena za ponudu
  // Ogroman tender (milioni) obično traži veliku firmu i reference — pravila to ne vide, pa spuštamo (AI to procenjuje sam)
  if (!ai && leadType === "tender" && budgetEur !== null && budgetEur > 2_000_000) aiScore -= 20;
  const expired = daysLeft !== null && daysLeft < 0;
  const score = category === "not_relevant" || expired ? 0 : finalScore({ aiScore, tier: tier ?? "T2", remoteOk: leadType === "tender" ? null : remoteOk, budgetEur, leadType });
  const offer = CATEGORY_TEXT[category] ?? "software projects";
  const title = input.title.slice(0, 80);

  return {
    aiScore,
    score,
    leadType,
    category,
    industry: ai?.industry ?? rules!.industry,
    country,
    tier,
    remoteOk,
    budgetEur,
    urgency: ai?.urgency ?? null,
    why: ai?.why.length
      ? ai.why
      : leadType === "tender"
        ? [`Public tender for ${offer}.`, daysLeft !== null ? `${Math.max(0, Math.round(daysLeft))} days left to submit.` : "Deadline not stated."]
        : [`Matches our ${offer} offer.`, remoteOk ? "Open to remote work." : "Remote setup not confirmed."],
    redFlags: ai?.redFlags ?? [],
    emailSubject: ai?.emailSubject ?? (leadType === "tender" ? `Bid: ${title.slice(0, 70)}` : `${title.slice(0, 60)} — quick idea`),
    emailBody:
      ai?.emailBody ??
      (leadType === "tender"
        ? `Next steps: open the notice, download the tender documents, check eligibility (non-EU suppliers, references, turnover) and the submission format. If it fits, ask the buyer a clarification question before the deadline and prepare the bid.`
        : null) ??
      `Hi, saw you're looking for help with "${title}". We're a small remote team focused on ${offer} and could share a short plan with timeline and cost. Would a 15-minute call next week be useful?`,
    scoredBy: ai ? `ai:${ai.model}` : "rules",
    status: category === "not_relevant" || expired || score < 20 ? "hidden" : "new",
    aiTitle: ai?.title ?? null,
    aiCompany: ai?.company ?? null,
  };
}

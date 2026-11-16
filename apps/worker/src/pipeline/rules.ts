import type { Industry, ServiceCategory } from "@radar/shared";

/** Brzi filter bez AI-a: da li je oglas uopšte vezan za razvoj softvera. Gleda se naziv pozicije. */
const DEV_TITLE = /\b(developer|engineer|engineering|full[- ]?stack|front[- ]?end|back[- ]?end|software|programmer|entwickler|programmierer|informatiker|d[ée]veloppeur|devops|sre|web|mobile|ios|android|react|node|python|java|php|ruby|golang|\.net|typescript|javascript|ai|ml|llm|data engineer|automation|mvp|programer|razvoj)\b/i;
const DEV_BODY = /\b(developer|engineer|full[- ]?stack|front[- ]?end|back[- ]?end|software|react|next\.?js|node(\.js)?|typescript|python|django|laravel|php|rails|golang|devops|kubernetes|llm|chatbot|automation|n8n|mvp|saas)\b/i;
const EXCLUDE = /\b(unpaid|volunteer|internship|intern|praktikum|werkstudent|commission[- ]only|equity[- ]only|no budget)\b/i;
const NON_SOFTWARE_TITLE = /\b(mechanical|electrical|civil|chemical|hardware|process|manufacturing|field service|sales|account executive|recruiter|marketing (manager|associate|specialist)|go-to-market|designer|bookkeep|accountant|buchhalt|customer success|nurse|physician|doctor|lawyer|attorney|tutor|writer|annotat\w*|rater|evaluator|ai trainer|put .* to the test|driver|warehouse|lager|pflege|operator|technician|technicien)\b/i;

/** Za izvore gde naslov često nije pozicija (HN "Multiple roles") dozvoljavamo proveru teksta. */
export function passesPrefilter(title: string, body: string, opts: { allowBody?: boolean } = {}): boolean {
  if (EXCLUDE.test(title) || EXCLUDE.test(body.slice(0, 2000))) return false;
  if (NON_SOFTWARE_TITLE.test(title)) return false;
  if (DEV_TITLE.test(title)) return true;
  return Boolean(opts.allowBody) && DEV_BODY.test(body.slice(0, 2000));
}

const CATEGORY_RULES: Array<[RegExp, ServiceCategory]> = [
  [/\b(ai|llm|gpt|openai|machine learning|ml engineer|chatbot|rag)\b/i, "ai_integration"],
  [/\b(n8n|zapier|make\.com|automation|workflow)\b/i, "automation"],
  [/\b(devops|sre|platform engineer|kubernetes|terraform|aws|infrastructure|ci\/cd)\b/i, "devops_deploy"],
  [/\b(ios|android|mobile|react native|flutter|swift|kotlin)\b/i, "mobile"],
  [/\b(full[- ]?stack|mvp|web app)\b/i, "fullstack_app"],
  [/\b(front[- ]?end|react|vue|angular|next\.?js|ui engineer)\b/i, "web_frontend"],
  [/\b(back[- ]?end|api|node|python|golang|java|php|ruby|\.net)\b/i, "backend_api"],
  [/\b(bug|fix|maintenance|support engineer)\b/i, "bugfix_maintenance"],
];

const INDUSTRY_RULES: Array<[RegExp, Industry]> = [
  [/\b(e-?commerce|shop|retail|shopify)\b/i, "ecommerce"],
  [/\b(fintech|bank|payments?|finance|crypto|trading)\b/i, "fintech"],
  [/\b(health|medical|clinic|patient|pharma)\b/i, "healthcare"],
  [/\b(real estate|property|proptech)\b/i, "real_estate"],
  [/\b(marketing|adtech|agency)\b/i, "marketing"],
  [/\b(education|edtech|learning|school)\b/i, "education"],
  [/\b(logistics|freight|shipping|supply chain)\b/i, "logistics"],
  [/\b(government|municipal|public sector)\b/i, "public_sector"],
  [/\b(saas|b2b software|platform)\b/i, "saas"],
];

const pick = <T>(rules: Array<[RegExp, T]>, text: string, fallback: T): T => rules.find(([re]) => re.test(text))?.[1] ?? fallback;

/** Rezervno ocenjivanje kad AI nije dostupan (nema ključa ili je pao). */
export function scoreByRules(title: string, body: string) {
  const text = `${title}\n${body.slice(0, 4000)}`;
  let s = 35;
  if (/\b(contract|contractor|freelance|freelancer|agency|project[- ]based|part[- ]time|consultant)\b/i.test(text)) s += 15;
  if (/\b(mvp|build (an?|our) (app|platform|product)|from scratch)\b/i.test(text)) s += 10;
  if (/\b(full[- ]?stack)\b/i.test(text)) s += 10;
  if (/\b(ai|llm|openai|gpt|chatbot|automation|n8n)\b/i.test(text)) s += 10;
  if (/\b(react|next\.?js|node|typescript)\b/i.test(text)) s += 6;
  if (/\b(staff|principal|director|head of|vp|manager)\b/i.test(title)) s -= 15;
  if (/\b(on-?site|in office|relocation required)\b/i.test(text)) s -= 10;
  return {
    aiScore: Math.max(0, Math.min(90, s)),
    // Kategorija prvo po nazivu pozicije (u tekstu se "AI" pominje skoro svuda), pa po tekstu.
    category: pick(CATEGORY_RULES, title, pick(CATEGORY_RULES, body.slice(0, 1500), "other_dev" as ServiceCategory)),
    industry: pick(INDUSTRY_RULES, text, "other" as Industry),
  };
}

/** Grubo izvlačenje budžeta u EUR iz teksta o plati (godišnja plata → mesečni ekvivalent projekta nije cilj; koristimo za poređenje). */
export function budgetFromSalary(salaryText: string | null): number | null {
  if (!salaryText) return null;
  const nums = [...salaryText.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k)?/gi)]
    .map((m) => Number(m[1]) * (m[2] ? 1000 : 1))
    .filter((n) => n >= 10);
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const eur = /£/.test(salaryText) ? avg * 1.15 : /\$/.test(salaryText) ? avg * 0.92 : avg;
  return Math.round(eur);
}

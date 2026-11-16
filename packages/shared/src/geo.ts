/** Tier-ovi tržišta (ISO 3166-1 alpha-2). Podesivo — vidi docs/PLAN.md §4. */
export type Tier = "T1" | "T2" | "T3" | "DOMESTIC";

const T1 = ["US", "CA", "GB", "IE", "DE", "AT", "CH", "NL", "BE", "LU", "DK", "SE", "NO", "FI", "IS", "AU", "NZ", "SG", "AE"];
const T2 = ["FR", "IT", "ES", "PT", "JP", "KR", "HK", "QA", "SA", "EE", "CZ", "SI", "MT", "CY"];
const DOMESTIC = ["RS", "HR", "BA", "ME", "MK"];

export const TIER_MULTIPLIER: Record<Tier, number> = { T1: 1, T2: 0.85, T3: 0.6, DOMESTIC: 1 };

export function tierOf(country: string | null | undefined): Tier {
  if (!country) return "T3";
  const c = country.toUpperCase();
  if (DOMESTIC.includes(c)) return "DOMESTIC";
  if (T1.includes(c)) return "T1";
  if (T2.includes(c)) return "T2";
  return "T3";
}

/** Ključne reči u tekstu lokacije → država. Redosled je bitan (specifičnije prvo). */
const LOCATION_HINTS: Array<[RegExp, string]> = [
  [/\b(usa|united states|u\.s\.|us only|us-based|new york|san francisco|austin|texas|california)\b/i, "US"],
  [/\b(canada|toronto|vancouver|montreal)\b/i, "CA"],
  [/\b(united kingdom|uk|london|england|manchester)\b/i, "GB"],
  [/\b(ireland|dublin)\b/i, "IE"],
  [/\b(germany|deutschland|berlin|munich|münchen|hamburg)\b/i, "DE"],
  [/\b(austria|österreich|vienna|wien)\b/i, "AT"],
  [/\b(switzerland|schweiz|zurich|zürich|geneva)\b/i, "CH"],
  [/\b(netherlands|amsterdam|rotterdam)\b/i, "NL"],
  [/\b(sweden|stockholm)\b/i, "SE"],
  [/\b(norway|oslo)\b/i, "NO"],
  [/\b(denmark|copenhagen)\b/i, "DK"],
  [/\b(finland|helsinki)\b/i, "FI"],
  [/\b(australia|sydney|melbourne)\b/i, "AU"],
  [/\b(singapore)\b/i, "SG"],
  [/\b(france|paris)\b/i, "FR"],
  [/\b(spain|madrid|barcelona)\b/i, "ES"],
  [/\b(serbia|srbija|beograd|belgrade|novi sad|niš)\b/i, "RS"],
];

export function detectCountry(input: { location?: string | null; salaryText?: string | null }): string | null {
  const text = `${input.location ?? ""}`;
  for (const [re, code] of LOCATION_HINTS) if (re.test(text)) return code;
  const salary = input.salaryText ?? "";
  if (/£/.test(salary)) return "GB";
  if (/\bCHF\b/.test(salary)) return "CH";
  if (/\bRSD\b|\bdin\b/i.test(salary)) return "RS";
  return null;
}

/** Da li bi angažovali agenciju van njihove zemlje. null = nepoznato. */
export function remoteFriendly(text: string): boolean | null {
  if (/\b(us citizens only|must be (located|based) in|on-?site only|security clearance|no agencies)\b/i.test(text)) return false;
  if (/\b(worldwide|anywhere|contractors? welcome|freelancers? welcome|remote \(global\)|cet|eu time ?zone)\b/i.test(text)) return true;
  return null;
}

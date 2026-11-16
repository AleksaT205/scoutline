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

/** Ključne reči u tekstu lokacije → država. Bira se ona koja se prva pojavi u tekstu. */
const LOCATION_HINTS: Array<[RegExp, string]> = [
  [/\b(US|USA|U\.S\.A?\.?)\b/, "US"], // velikim slovima, da "us" (engl. "nas") ne bi bilo pogođeno
  [/\b(united states|us only|us-based|remote \(us\)|new york|nyc|san francisco|sf bay|bay area|silicon valley|seattle|boston|chicago|los angeles|austin|denver|miami|atlanta|texas|california|washington,? dc)\b/i, "US"],
  [/\b(canada|toronto|vancouver|montreal|ottawa|calgary)\b/i, "CA"],
  [/\b(UK)\b/, "GB"],
  [/\b(united kingdom|london|england|scotland|manchester|edinburgh|bristol|cambridge, uk)\b/i, "GB"],
  [/\b(ireland|dublin)\b/i, "IE"],
  [/\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|köln|cologne|stuttgart|düsseldorf)\b/i, "DE"],
  [/\b(austria|österreich|vienna|wien|graz)\b/i, "AT"],
  [/\b(switzerland|schweiz|suisse|zurich|zürich|geneva|genève|basel|bern|lausanne)\b/i, "CH"],
  [/\b(netherlands|holland|amsterdam|rotterdam|utrecht|eindhoven)\b/i, "NL"],
  [/\b(belgium|brussels|antwerp)\b/i, "BE"],
  [/\b(luxembourg)\b/i, "LU"],
  [/\b(sweden|stockholm|gothenburg|malmö)\b/i, "SE"],
  [/\b(norway|oslo)\b/i, "NO"],
  [/\b(denmark|copenhagen)\b/i, "DK"],
  [/\b(finland|helsinki)\b/i, "FI"],
  [/\b(iceland|reykjavik)\b/i, "IS"],
  [/\b(australia|sydney|melbourne|brisbane|perth)\b/i, "AU"],
  [/\b(new zealand|auckland|wellington)\b/i, "NZ"],
  [/\b(singapore)\b/i, "SG"],
  [/\b(uae|united arab emirates|dubai|abu dhabi)\b/i, "AE"],
  [/\b(france|paris|lyon)\b/i, "FR"],
  [/\b(spain|madrid|barcelona|valencia|andaluc[ií]a)\b/i, "ES"],
  [/\b(portugal|lisbon|lisboa|porto)\b/i, "PT"],
  [/\b(italy|milan|milano|rome|roma|turin)\b/i, "IT"],
  [/\b(japan|tokyo|osaka)\b/i, "JP"],
  [/\b(estonia|tallinn)\b/i, "EE"],
  [/\b(czech|prague|praha|brno)\b/i, "CZ"],
  [/\b(slovenia|ljubljana)\b/i, "SI"],
  [/\b(poland|warsaw|krak[oó]w|wroc[lł]aw)\b/i, "PL"],
  [/\b(romania|bucharest|cluj)\b/i, "RO"],
  [/\b(hungary|budapest)\b/i, "HU"],
  [/\b(india|bangalore|bengaluru|hyderabad|pune|mumbai|delhi|chennai)\b/i, "IN"],
  [/\b(brazil|são paulo|sao paulo)\b/i, "BR"],
  [/\b(mexico|ciudad de méxico)\b/i, "MX"],
  [/\b(israel|tel aviv)\b/i, "IL"],
  [/\b(croatia|hrvatska|zagreb|split)\b/i, "HR"],
  [/\b(bosnia|sarajevo|banja luka)\b/i, "BA"],
  [/\b(montenegro|podgorica)\b/i, "ME"],
  [/\b(macedonia|skopje)\b/i, "MK"],
  [/\b(serbia|srbija|beograd|belgrade|novi sad|niš)\b/i, "RS"],
];

export function detectCountry(input: { location?: string | null; salaryText?: string | null }): string | null {
  const text = `${input.location ?? ""}`;
  let best: { code: string; at: number } | null = null;
  for (const [re, code] of LOCATION_HINTS) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.at)) best = { code, at: m.index };
  }
  if (best) return best.code;
  const salary = input.salaryText ?? "";
  if (/£/.test(salary)) return "GB";
  if (/\bCHF\b/.test(salary)) return "CH";
  if (/\bRSD\b|\bdin\b/i.test(salary)) return "RS";
  return null;
}

/** Da li bi angažovali agenciju van njihove zemlje. null = nepoznato. */
export function remoteFriendly(text: string): boolean | null {
  if (/\b(us citizens only|must be (located|based) in|on-?site only|security clearance|no agencies)\b/i.test(text)) return false;
  if (/\b(worldwide|anywhere|contractors? welcome|freelancers? welcome|remote \(global\)|cet|eu time ?zone|rad na daljinu|remote rad|od kuće|remote ok|remote-friendly|fully remote|100% remote)\b/i.test(text)) return true;
  return null;
}

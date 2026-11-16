export interface RawItem {
  externalId: string;
  url: string;
  title: string;
  body: string; // čist tekst, bez HTML-a
  companyName: string | null;
  location: string | null;
  salaryText: string | null;
  postedAt: Date | null;
  payload?: unknown;
  /** Tip leada kad ga izvor zna (tender, intent…); inače se određuje pri ocenjivanju */
  leadType?: "tender" | "project" | "intent" | "hiring_signal";
  deadline?: Date | null;
  budgetEur?: number | null;
  country?: string | null; // ISO alpha-2
}

export interface Connector {
  id: string; // ključ u tabeli sources
  name: string;
  kind: "api" | "rss";
  intervalMinutes: number;
  /** Podrazumevani tip leada za ovaj izvor (oglasi za posao → hiring_signal) */
  defaultType: "tender" | "project" | "intent" | "hiring_signal";
  fetch(): Promise<RawItem[]>;
}

export const USER_AGENT = "Mozilla/5.0 (compatible; ScoutlineBot/0.1; job-board aggregator)";

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

export { htmlToText } from "@radar/scoring";

/** Približni kursevi u EUR (za poređenje budžeta tendera; ne za računovodstvo). */
const EUR_RATE: Record<string, number> = { EUR: 1, GBP: 1.17, USD: 0.92, CAD: 0.67, AUD: 0.6, CHF: 1.05, SEK: 0.087, NOK: 0.085, DKK: 0.134, PLN: 0.23, CZK: 0.04, HUF: 0.0025, RON: 0.2, BGN: 0.51, RSD: 0.0085 };
export function toEur(amount: unknown, currency: unknown): number | null {
  const n = Number(amount);
  const rate = EUR_RATE[String(currency ?? "EUR").toUpperCase()];
  return Number.isFinite(n) && n > 0 && rate ? Math.round(n * rate) : null;
}

/** ISO3 → ISO2 za zemlje koje se javljaju u tenderima. */
const ISO3: Record<string, string> = {
  AUT: "AT", BEL: "BE", BGR: "BG", HRV: "HR", CYP: "CY", CZE: "CZ", DNK: "DK", EST: "EE", FIN: "FI", FRA: "FR", DEU: "DE", GRC: "GR", HUN: "HU", IRL: "IE",
  ITA: "IT", LVA: "LV", LTU: "LT", LUX: "LU", MLT: "MT", NLD: "NL", POL: "PL", PRT: "PT", ROU: "RO", SVK: "SK", SVN: "SI", ESP: "ES", SWE: "SE", NOR: "NO",
  ISL: "IS", CHE: "CH", GBR: "GB", SRB: "RS", BIH: "BA", MNE: "ME", MKD: "MK", ALB: "AL", UKR: "UA", MDA: "MD", USA: "US", CAN: "CA", AUS: "AU", NZL: "NZ",
};
export const iso2 = (code: unknown) => (typeof code === "string" ? (ISO3[code.toUpperCase()] ?? (code.length === 2 ? code.toUpperCase() : null)) : null);

/** IT/softverski posao u tenderu (po nazivu/opisu) — tenderi pokrivaju sve, nas zanima samo razvoj. */
export const IT_TENDER = /\b(software|web(site|\s?site|\s?app)?|application|app\b|portal|platform|digital|information (system|technology)|it services|ict|development|developer|api|cloud|data (platform|warehouse|analytics)|crm|erp|e-?commerce|mobile|automation|artificial intelligence|\bai\b|machine learning|cyber|saas|hosting|devops|integration|ux|ui design|licen[cs]e management|informacion|softver|aplikacij|digitaliz)/i;

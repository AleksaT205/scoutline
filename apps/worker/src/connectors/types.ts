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
}

export interface Connector {
  id: string; // ključ u tabeli sources
  name: string;
  kind: "api" | "rss";
  intervalMinutes: number;
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

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&#x2F;": "/", "&nbsp;": " " };

/** HTML → čitljiv tekst (dovoljno za ocenjivanje). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[#\w]+;/g, (e) => ENTITIES[e] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

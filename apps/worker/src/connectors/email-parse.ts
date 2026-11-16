import { createHash } from "node:crypto";
import { extractOpportunities, htmlToText } from "@radar/scoring";
import { toEur, type RawItem } from "./types.js";

/**
 * Email-in: platforme bez API-ja (Upwork, PeoplePerHour, Malt, Portal javnih nabavki…) šalju obaveštenja
 * za sačuvane pretrage. Ovde od jednog mejla pravimo jedan ili više oglasa.
 */
export interface Platform {
  id: string;
  name: string;
  domain: RegExp;
  type: NonNullable<RawItem["leadType"]>;
  country?: string;
}

export const PLATFORMS: Platform[] = [
  { id: "email-upwork", name: "Upwork (email)", domain: /(^|\.)upwork\.com$/i, type: "project" },
  { id: "email-pph", name: "PeoplePerHour (email)", domain: /(^|\.)peopleperhour\.com$/i, type: "project" },
  { id: "email-malt", name: "Malt (email)", domain: /(^|\.)malt\.(com|fr|de|es|nl|be|ch|co\.uk)$/i, type: "project" },
  { id: "email-freelancer", name: "Freelancer (email)", domain: /(^|\.)freelancer\.com$/i, type: "project" },
  { id: "email-guru", name: "Guru (email)", domain: /(^|\.)guru\.com$/i, type: "project" },
  { id: "email-contra", name: "Contra (email)", domain: /(^|\.)contra\.com$/i, type: "project" },
  { id: "email-jnportal", name: "Portal javnih nabavki (email)", domain: /(^|\.)ujn\.gov\.rs$/i, type: "tender", country: "RS" },
  { id: "email-ejn", name: "e-Nabavke BiH (email)", domain: /(^|\.)ejn\.gov\.ba$/i, type: "tender", country: "BA" },
  { id: "email-linkedin", name: "LinkedIn (email)", domain: /(^|\.)linkedin\.com$/i, type: "hiring_signal" },
];
export const INBOX: Platform = { id: "email-inbox", name: "Email inbox", domain: /$^/, type: "project" };

export interface MailInput {
  from: string; // adresa pošiljaoca
  subject: string;
  html: string | null;
  text: string | null;
  date: Date | null;
  messageId: string;
}

interface Link {
  id: string; // "L1"
  url: string;
  text: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const platformOfHost = (host: string) => PLATFORMS.find((p) => p.domain.test(host)) ?? null;

/** Koja platforma je poslala mejl: pošiljalac, pa „From:“ u prosleđenom mejlu, pa većina linkova. */
export function detectPlatform(mail: MailInput, links: Link[]): Platform {
  const fromHost = mail.from.split("@")[1]?.toLowerCase() ?? "";
  const direct = platformOfHost(fromHost);
  if (direct) return direct;
  const body = `${mail.text ?? ""}\n${htmlToText(mail.html)}`.slice(0, 4000);
  for (const m of body.matchAll(/(?:from|od|von|de)\s*:[^\n]*?@([\w.-]+)/gi)) {
    const p = platformOfHost(m[1]!.toLowerCase());
    if (p) return p;
  }
  const votes = new Map<Platform, number>();
  for (const l of links) {
    const p = platformOfHost(hostOf(l.url));
    if (p) votes.set(p, (votes.get(p) ?? 0) + 1);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : INBOX;
}

/** Linkovi iz HTML-a sa tekstom; tekst mejla u kome su linkovi zamenjeni oznakama [L1], [L2]… (manje tokena za AI). */
export function linkify(html: string): { text: string; links: Link[] } {
  const links: Link[] = [];
  const marked = html.replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const text = htmlToText(inner).replace(/\s+/g, " ").trim();
    const url = href.replace(/&amp;/g, "&").trim();
    if (!/^https?:\/\//i.test(url)) return ` ${text} `;
    const id = `L${links.length + 1}`;
    links.push({ id, url, text });
    return ` ${text} [${id}] `;
  });
  const text = htmlToText(marked.replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, " "));
  return { text, links };
}

/** Linkovi u običnom tekstu (kad mejl nema HTML). */
function linkifyText(text: string): { text: string; links: Link[] } {
  const links: Link[] = [];
  const marked = text.replace(/https?:\/\/[^\s<>()"']+/g, (url, offset: number) => {
    const id = `L${links.length + 1}`;
    // Tekst linka = prethodni neprazan red (u tekstualnim obaveštenjima naslov je red iznad linka)
    const before = text.slice(0, offset).split("\n").map((l) => l.trim());
    // Samo kad je link sam u redu; link usred rečenice nema naslov
    const prev = before[before.length - 1] ? "" : (before[before.length - 2] ?? "");
    links.push({ id, url, text: /https?:\/\//.test(prev) ? "" : prev.slice(0, 200) });
    return `[${id}]`;
  });
  return { text: marked, links };
}

// Šum: tekst linka (UI fraze — ne obične reči kao „support“, jer se javljaju i u naslovima poslova) i adrese linka
const TEXT_NOISE = /unsubscribe|odjav|preferences|notification settings|privacy policy|terms of (use|service)|help center|download the app|app store|google play|view (in|this|online)|in your browser|see all|view all|more jobs|manage (your )?(alerts|notifications|account|subscriptions|settings)|log ?in to|sign ?in to/i;
const URL_NOISE = /unsub|optout|opt-out|preferences|settings|privacy|terms|\/help\b|\/support\b|apps\.apple|play\.google|facebook\.com|twitter\.com|\/\/x\.com|instagram\.com|youtube\.com|linkedin\.com\/company/i;
const isNoise = (l: Link) => TEXT_NOISE.test(l.text) || URL_NOISE.test(l.url);
const BUDGET = /(?:[$€£]\s?\d[\d,.]*\s?k?(?:\s?[-–]\s?[$€£]?\d[\d,.]*k?)?|\d[\d,.]*\s?(?:k\s?)?(?:eur|usd|gbp|rsd|din|km)\b)/i;
const findBudget = (text: string) => {
  const m = BUDGET.exec(text);
  if (!m) return null;
  // „Hourly: $40-70“ — satnica (oznaka može biti pre ili posle iznosa)
  const around = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 20);
  return /hour|\/hr\b|satnic|po satu/i.test(around) ? `${m[0].trim()} per hour` : m[0].trim();
};
const cleanSubject = (s: string) => s.replace(/^\s*((fwd?|fw|tr|wg|re|odg)\s*:\s*)+/i, "").trim();

/** Uklanja parametre za praćenje; kod poznatih platformi ceo query (isti posao = isti link). */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (platformOfHost(u.hostname)) u.search = "";
    else for (const k of [...u.searchParams.keys()]) if (/^(utm_|mc_|ref|source|trk|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

/** Link vodi direktno na platformu (nije redirect servis za praćenje klikova). */
const isDirect = (url: string, p: Platform) => p.domain.test(hostOf(url)) && !/^(click|email|links?|t|track|e)\./i.test(hostOf(url));

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const normTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Rezervno, bez AI-a: linkovi sa dužim tekstom = oglasi; ako ih nema, ceo mejl = jedan lead. */
function heuristicItems(subject: string, text: string, links: Link[]) {
  const seen = new Set<string>();
  const items: Array<{ title: string; link: Link | null; description: string }> = [];
  for (const l of links) {
    if (l.text.length < 15 || l.text.length > 200 || isNoise(l)) continue;
    const key = normTitle(l.text);
    if (seen.has(key)) continue;
    seen.add(key);
    const at = text.indexOf(`[${l.id}]`);
    const description = at >= 0 ? text.slice(at + l.id.length + 2, at + 600).replace(/\[L\d+\]/g, "").trim() : "";
    items.push({ title: l.text, link: l, description });
  }
  if (items.length) return items.slice(0, 15);
  const first = links.find((l) => !isNoise(l)) ?? null;
  return [{ title: cleanSubject(subject) || "Email inquiry", link: first, description: text.replace(/\[L\d+\]/g, "").slice(0, 3000) }];
}

const parseBudgetEur = (b: string | null) => {
  if (!b || /hour|\/hr|\bhr\b|satnic|po satu/i.test(b)) return null; // satnica nije vrednost projekta
  const m = b.replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2").replace(/[,\s](?=\d{3}\b)/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  const cur = /£|gbp/i.test(b) ? "GBP" : /\$|usd/i.test(b) ? "USD" : /rsd|din/i.test(b) ? "RSD" : /\bkm\b|bam/i.test(b) ? "BAM" : "EUR";
  return toEur(n, cur);
};

/** Mejl → oglasi (RawItem) sa izvorom po platformi. */
export async function parseEmail(mail: MailInput): Promise<Array<RawItem & { sourceId: string; sourceName: string }>> {
  const { text, links } = mail.html ? linkify(mail.html) : linkifyText(mail.text ?? "");
  const platform = detectPlatform(mail, links);
  const byId = new Map(links.map((l) => [l.id, l]));

  const prompt = `From: ${mail.from}\nSubject: ${mail.subject}\n\n${text}\n\nLinks:\n${links
    .filter((l) => !isNoise(l))
    .slice(0, 80)
    .map((l) => `${l.id}: ${l.url.slice(0, 160)}`)
    .join("\n")}`;
  const ai = await extractOpportunities(prompt);
  const found = ai
    ? ai.map((x) => ({ title: x.title, link: x.link ? (byId.get(x.link.replace(/[[\]]/g, "")) ?? null) : null, description: x.description, company: x.company, budget: x.budget, country: x.country, deadline: x.deadline }))
    : heuristicItems(mail.subject, text, links).map((x) => ({ ...x, company: null, budget: findBudget(`${x.title}\n${x.description}`), country: null, deadline: null }));

  return found.map((x, i) => {
    const url = x.link ? normalizeUrl(x.link.url) : `mailto:${mail.from}#${sha(mail.messageId)}-${i}`;
    // Isti oglas iz dva mejla: direktan link je ključ; kod linkova za praćenje — platforma + naslov
    const dedupe = x.link && isDirect(x.link.url, platform) ? url : `${platform.id}:${normTitle(x.title)}`;
    const deadline = x.deadline && /^\d{4}-\d{2}-\d{2}$/.test(x.deadline) ? new Date(`${x.deadline}T12:00:00Z`) : null;
    return {
      externalId: sha(dedupe),
      url,
      dedupeKey: dedupe,
      title: x.title.slice(0, 300),
      body: [`Received by email from ${platform.name.replace(" (email)", "")} · subject: ${mail.subject}`, x.budget ? `Budget: ${x.budget}` : "", "", x.description]
        .filter((l, j) => l !== "" || j === 2)
        .join("\n")
        .slice(0, 6000),
      companyName: x.company,
      location: x.country ?? platform.country ?? null,
      salaryText: x.budget,
      postedAt: mail.date,
      leadType: platform.type,
      deadline,
      budgetEur: parseBudgetEur(x.budget),
      country: (x.country && /^[A-Z]{2}$/.test(x.country) ? x.country : null) ?? platform.country ?? null,
      sourceId: platform.id,
      sourceName: platform.name,
    };
  });
}

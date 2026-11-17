import { XMLParser } from "fast-xml-parser";
import { type Connector, type RawItem, getJson, getText, htmlToText } from "./types.js";

/**
 * Srbija i region (provereno 17. 11. 2026, vidi docs/SOURCES.md):
 * - Svetska banka (zvaničan otvoren API) — tenderi u RS, BA, ME, MK, XK
 * - HelloWorld.rs i Startit poslovi (RSS) — oglasi za IT posao = slab signal; čuvamo samo naslov i link
 * - Netokracija, Forbes Srbija, Bizlife (RSS) — vesti o investicijama = signal namere; samo naslov i kratak odlomak
 */
const xml = new XMLParser({ ignoreAttributes: true });
type RssItem = { title: string; link: string; description?: string; pubDate?: string; guid?: string | { "#text": string }; "dc:creator"?: string };
const rssItems = async (url: string) => [xml.parse(await getText(url))?.rss?.channel?.item ?? []].flat() as RssItem[];
const guidOf = (it: RssItem) => String(typeof it.guid === "object" ? it.guid["#text"] : (it.guid ?? it.link));

// ── Svetska banka: tenderi (ne dodele ugovora) za IT / softver / digitalizaciju ──
const WB_IT = /\b(software|information (system|technology|management)|e-?(government|services|procurement|health|learning)|digital\w*|it (equipment|services|system|consult\w*|support)|ict|portal|platform|database|web\s?(site|application)?|application|mobile app|cyber\w*|data (center|centre|warehouse|management|system)|erp|crm|gis)\b/i;
const WB_COUNTRIES: Array<[string, string]> = [
  ["Serbia", "RS"],
  ["Bosnia and Herzegovina", "BA"],
  ["Montenegro", "ME"],
  ["North Macedonia", "MK"],
  ["Kosovo", "XK"],
];
type WbNotice = { id: string; notice_type?: string; noticedate?: string; submission_deadline_date?: string; project_ctry_name?: string; project_name?: string; bid_description?: string; procurement_group?: string; procurement_method_name?: string };
const worldBank: Connector = {
  id: "worldbank",
  name: "World Bank · region",
  kind: "api",
  intervalMinutes: 720,
  defaultType: "tender",
  async fetch() {
    const out: RawItem[] = [];
    for (const [name, iso] of WB_COUNTRIES) {
      const d = await getJson<{ procnotices?: WbNotice[] }>(`https://search.worldbank.org/api/v2/procnotices?format=json&project_ctry_name=${encodeURIComponent(name)}&srt=submission_date&order=desc&rows=60`);
      for (const n of d.procnotices ?? []) {
        if (/award/i.test(n.notice_type ?? "")) continue; // dodela = posao je već dat
        // Samo opis samog posla (naziv projekta je preširok — npr. „sector development“)
        if (!n.bid_description || !WB_IT.test(n.bid_description)) continue;
        const deadline = n.submission_deadline_date ? new Date(n.submission_deadline_date) : null;
        if (deadline && deadline.getTime() < Date.now()) continue;
        const title = (n.bid_description ?? n.project_name ?? "World Bank tender").replace(/\s+/g, " ").trim();
        out.push({
          externalId: n.id,
          url: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`,
          title: title.slice(0, 300),
          body: [
            "PUBLIC TENDER funded by the World Bank (open international procurement; the buyer contracts an external supplier).",
            `Country: ${n.project_ctry_name ?? name} · Project: ${n.project_name ?? "?"}`,
            `Notice: ${n.notice_type ?? "?"} · Method: ${n.procurement_method_name ?? "?"} · Group: ${n.procurement_group ?? "?"}`,
            `Submission deadline: ${deadline ? deadline.toISOString().slice(0, 10) : "not stated"}`,
            "",
            title,
          ].join("\n"),
          companyName: n.project_name ?? null,
          location: n.project_ctry_name ?? name,
          salaryText: null,
          postedAt: n.noticedate ? new Date(n.noticedate) : null,
          leadType: "tender",
          deadline,
          budgetEur: null,
          country: iso,
        });
      }
    }
    return out;
  },
};

// ── Oglasi za IT posao (Srbija) — slab signal; uslovi: samo naslov i link, interno ──
function jobsRss(id: string, name: string, url: string): Connector {
  return {
    id,
    name,
    kind: "rss",
    intervalMinutes: 360,
    defaultType: "hiring_signal",
    async fetch() {
      return (await rssItems(url)).map((it) => {
        const title = htmlToText(String(it.title)).slice(0, 300);
        // „Pozicija — Firma“ ili „Pozicija @ Firma“ u naslovu
        const company = title.match(/\s[-–@|]\s([^-–@|]+)$/)?.[1]?.trim() ?? null; // dc:creator je autor teksta, ne firma
        return {
          externalId: guidOf(it),
          url: String(it.link),
          title,
          body: `IT job post in Serbia (${name}). The company is hiring developers — it may also need an external team.\n\n${title}`,
          companyName: company,
          location: "Serbia",
          salaryText: null,
          postedAt: it.pubDate ? new Date(it.pubDate) : null,
          leadType: "hiring_signal" as const,
          country: "RS",
        };
      });
    },
  };
}

// ── Vesti o investicijama u regionu (signal namere) — samo naslov i kratak odlomak ──
const FUNDING_SR = /\b(investicij\w*|investitor\w*|ulaganj\w*|ulož\w*|runda|rundu|seed|series [a-d]|prikupi\w*|preuze\w*|akvizicij\w*|startap\w*|startup\w*|funding|raises?|raised|digitalizacij\w*|nova platforma|lansira\w*)\b/i;
function newsRss(id: string, name: string, url: string): Connector {
  return {
    id,
    name,
    kind: "rss",
    intervalMinutes: 360,
    defaultType: "intent",
    async fetch() {
      return (await rssItems(url))
        .filter((it) => FUNDING_SR.test(`${it.title} ${String(it.description ?? "").slice(0, 500)}`))
        .map((it) => ({
          externalId: guidOf(it),
          url: String(it.link),
          title: htmlToText(String(it.title)).slice(0, 300),
          body: `REGIONAL BUSINESS NEWS (${name}) — investment, launch or growth: the company may need a development team.\n\n${htmlToText(String(it.title))}\n${htmlToText(String(it.description ?? "")).slice(0, 400)}`,
          companyName: null,
          location: "Serbia & region",
          salaryText: null,
          postedAt: it.pubDate ? new Date(it.pubDate) : null,
          leadType: "intent" as const,
          country: "RS",
        }));
    },
  };
}

export const REGION_CONNECTORS: Connector[] = [
  worldBank,
  jobsRss("helloworld", "HelloWorld.rs", "https://www.helloworld.rs/rss"),
  jobsRss("startit-jobs", "Startit poslovi", "https://startit.rs/poslovi/feed/"),
  newsRss("netokracija", "Netokracija", "https://www.netokracija.rs/feed"),
  newsRss("forbes-rs", "Forbes Srbija", "https://forbes.n1info.rs/feed/"),
  newsRss("bizlife", "Bizlife", "https://bizlife.rs/feed/"),
];

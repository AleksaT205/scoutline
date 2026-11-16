import { parse } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import { IT_TENDER, type Connector, type RawItem, USER_AGENT, getJson, getText, htmlToText, iso2, toEur } from "./types.js";

/** Datum za API-je: pre N dana. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
/** "2026-12-09+02:00" ili ISO → Date (TED datum ima vremensku zonu bez vremena). */
const parseDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}[+-]/.test(v) ? `${v.slice(0, 10)}T12:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const first = <T>(v: T | T[] | undefined | null): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "not stated");

/** Telo oglasa za AI: kratko, sa svim bitnim podacima tendera. */
function tenderBody(t: { title: string; buyer: string | null; country: string | null; budgetEur: number | null; deadline: Date | null; description?: string; cpv?: string }) {
  return [
    "PUBLIC TENDER (procurement notice — the buyer is looking for an external supplier).",
    `Buyer: ${t.buyer ?? "unknown"}${t.country ? ` (${t.country})` : ""}`,
    `Estimated value: ${t.budgetEur ? `€${t.budgetEur.toLocaleString("en")}` : "not stated"}`,
    `Submission deadline: ${fmtDate(t.deadline)}`,
    t.cpv ? `Category: ${t.cpv}` : "",
    "",
    t.title,
    t.description ?? "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Nabavke koje nisu razvoj softvera (oprema, mreže, gradnja…) — preskačemo. */
const NON_DEV = /\b(servers?|hardware|computer equipment|network services|wide area network|telecommunications?|telephon\w*|radio|cabling|printing|photocopi\w*|vehicles?|rolling stock|construction|architectural|engineering and inspection|building|furniture|cleaning|guard|medical equipment|laboratory|fuel|electricity|catering|vessels?|structural|hvac|elevator|roofing)\b/i;

// ── EU TED ────────────────────────────────────────────────────────────────────
// Search API v3, anonimno. CPV 72* = IT usluge, 48* = softver. Samo otvoreni pozivi (contract notices).
const CPV = [
  "72000000", "72200000", "72210000", "72212000", "72220000", "72230000", "72240000", "72250000", "72260000", "72262000", "72263000", "72266000",
  "72267000", "72268000", "72300000", "72310000", "72320000", "72400000", "72410000", "72413000", "72415000", "72420000", "72500000", "72600000",
  "72700000", "72800000", "72900000", "48000000", "48100000", "48200000", "48600000", "48700000", "48800000", "48900000",
];
const ted: Connector = {
  id: "ted",
  name: "EU TED tenders",
  kind: "api",
  intervalMinutes: 180,
  defaultType: "tender",
  async fetch() {
    const since = daysAgo(3).toISOString().slice(0, 10).replace(/-/g, "");
    type Notice = Record<string, unknown> & { "publication-number": string };
    const out: RawItem[] = [];
    let token: string | undefined;
    for (let page = 0; page < 3; page++) {
      const res = await fetch("https://api.ted.europa.eu/v3/notices/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify({
          query: `classification-cpv IN (${CPV.join(" ")}) AND notice-type IN (cn-standard cn-social) AND publication-date>=${since}`,
          fields: ["publication-number", "notice-title", "buyer-name", "buyer-country", "deadline-receipt-tender-date-lot", "estimated-value-lot", "estimated-value-cur-lot", "publication-date"],
          limit: 100,
          scope: "ACTIVE",
          paginationMode: "ITERATION",
          ...(token ? { iterationNextToken: token } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`TED → HTTP ${res.status}`);
      const data = (await res.json()) as { notices?: Notice[]; iterationNextToken?: string };
      for (const n of data.notices ?? []) {
        const titles = (n["notice-title"] ?? {}) as Record<string, string>;
        const title = titles.eng ?? Object.values(titles)[0] ?? "EU tender";
        const buyer = first(Object.values((n["buyer-name"] ?? {}) as Record<string, string[]>)[0]) ?? null;
        const country = iso2(first(n["buyer-country"] as string[]));
        const deadlines = ((n["deadline-receipt-tender-date-lot"] as string[]) ?? []).map(parseDate).filter((d): d is Date => !!d);
        const deadline = deadlines.length ? new Date(Math.min(...deadlines.map((d) => d.getTime()))) : null;
        const values = (n["estimated-value-lot"] as string[]) ?? [];
        const cur = first(n["estimated-value-cur-lot"] as string[]);
        const budgetEur = toEur(values.reduce((a, v) => a + Number(v || 0), 0), cur);
        const pn = n["publication-number"];
        const clean = title.replace(/^[A-Z][a-z]+(?: [A-Z][a-z]+)* – /, ""); // "Romania – " prefiks je već u zemlji
        const [cpvLabel = "", ...rest] = clean.split(" – ");
        if (NON_DEV.test(cpvLabel)) continue; // glavna CPV oznaka nije IT usluga
        const shown = rest.length ? rest.join(" – ") : clean; // naslov bez CPV oznake (ona ide u telo)
        out.push({
          externalId: pn,
          url: `https://ted.europa.eu/en/notice/-/detail/${pn}`,
          title: shown.slice(0, 300),
          body: tenderBody({ title: shown, buyer, country, budgetEur, deadline, cpv: rest.length ? cpvLabel : undefined }),
          companyName: buyer,
          location: country,
          salaryText: null,
          postedAt: parseDate(n["publication-date"]),
          leadType: "tender",
          deadline,
          budgetEur,
          country,
        });
      }
      token = data.iterationNextToken;
      if (!token || (data.notices ?? []).length < 100) break;
    }
    return out;
  },
};

// ── UK: Contracts Finder + Find a Tender (OCDS, Open Government Licence) ──────
type OcdsRelease = {
  id: string;
  ocid: string;
  date?: string;
  buyer?: { name?: string };
  tender?: {
    title?: string;
    description?: string;
    classification?: { id?: string; description?: string };
    tenderPeriod?: { endDate?: string };
    value?: { amount?: number; currency?: string };
    status?: string;
  };
};
const isItRelease = (r: OcdsRelease) => {
  const cpv = r.tender?.classification?.id ?? "";
  if (NON_DEV.test(r.tender?.title ?? "")) return false;
  return cpv.startsWith("72") || cpv.startsWith("48") || IT_TENDER.test(`${r.tender?.title ?? ""} ${r.tender?.description?.slice(0, 600) ?? ""}`);
};
function ocdsItem(r: OcdsRelease, url: string): RawItem {
  const t = r.tender ?? {};
  const deadline = parseDate(t.tenderPeriod?.endDate);
  const budgetEur = toEur(t.value?.amount, t.value?.currency ?? "GBP");
  return {
    externalId: r.id,
    url,
    title: (t.title ?? "UK tender").slice(0, 300),
    body: tenderBody({ title: t.title ?? "", buyer: r.buyer?.name ?? null, country: "GB", budgetEur, deadline, description: t.description?.slice(0, 4000), cpv: t.classification?.description }),
    companyName: r.buyer?.name ?? null,
    location: "United Kingdom",
    salaryText: null,
    postedAt: parseDate(r.date),
    leadType: "tender",
    deadline,
    budgetEur,
    country: "GB",
  };
}

const ukContractsFinder: Connector = {
  id: "uk-cf",
  name: "UK Contracts Finder",
  kind: "api",
  intervalMinutes: 180,
  defaultType: "tender",
  async fetch() {
    const from = daysAgo(7).toISOString().slice(0, 19);
    const data = await getJson<{ releases?: OcdsRelease[] }>(
      `https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?publishedFrom=${from}&stages=tender&limit=100`,
    );
    return (data.releases ?? [])
      .filter(isItRelease)
      .map((r) => ocdsItem(r, `https://www.contractsfinder.service.gov.uk/Notice/${r.ocid.replace(/^ocds-[a-z0-9]+-/, "")}`));
  },
};

const ukFindTender: Connector = {
  id: "uk-fat",
  name: "UK Find a Tender",
  kind: "api",
  intervalMinutes: 180,
  defaultType: "tender",
  async fetch() {
    const from = daysAgo(3).toISOString().slice(0, 19);
    const data = await getJson<{ releases?: OcdsRelease[] }>(`https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${from}&stages=tender&limit=100`);
    return (data.releases ?? []).filter(isItRelease).map((r) => ocdsItem(r, `https://www.find-tender.service.gov.uk/Notice/${r.id}`));
  },
};

// ── Kanada: CanadaBuys (dnevni CSV otvorenih tendera, federalni nivo) ─────────
const canadaBuys: Connector = {
  id: "canadabuys",
  name: "CanadaBuys",
  kind: "api",
  intervalMinutes: 360,
  defaultType: "tender",
  async fetch() {
    const csv = await getText("https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv");
    const rows = parse(csv.replace(/^﻿/, ""), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true }) as Array<Record<string, string>>;
    const since = daysAgo(14).getTime();
    return rows
      .filter((r) => (r["procurementCategory-categorieApprovisionnement"] ?? "").includes("SRV"))
      .filter((r) => !NON_DEV.test(r["title-titre-eng"] ?? ""))
      .filter((r) => IT_TENDER.test(`${r["title-titre-eng"] ?? ""} ${(r["tenderDescription-descriptionAppelOffres-eng"] ?? "").slice(0, 600)}`))
      .filter((r) => (parseDate(r["publicationDate-datePublication"])?.getTime() ?? Date.now()) >= since)
      .map((r) => {
        const deadline = parseDate(r["tenderClosingDate-appelOffresDateCloture"]);
        const buyer = r["contractingEntityName-nomEntitContractante-eng"] || null;
        const title = r["title-titre-eng"] || "Canadian tender";
        const ref = r["referenceNumber-numeroReference"] || r["solicitationNumber-numeroSollicitation"] || title;
        // Kad oglas nije na MERX/Ariba, stranica na CanadaBuys ima slug od referentnog broja (pw-_mer-005-1 → pw-mer-005-1)
        const slug = ref.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return {
          externalId: ref,
          url: r["noticeURL-URLavis-eng"] || `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${slug}`,
          title: title.slice(0, 300),
          body: tenderBody({ title, buyer, country: "CA", budgetEur: null, deadline, description: htmlToText(r["tenderDescription-descriptionAppelOffres-eng"]).slice(0, 4000), cpv: r["gsinDescription-nibsDescription-eng"] }),
          companyName: buyer,
          location: "Canada",
          salaryText: null,
          postedAt: parseDate(r["publicationDate-datePublication"]),
          leadType: "tender" as const,
          deadline,
          budgetEur: null,
          country: "CA",
        };
      });
  },
};

// ── Signali namere: vesti o investicijama (firma ima novac i raste) ───────────
const FUNDING = /\b(raises?|raised|secures?|secured|funding|seed|pre-seed|series [a-d]|investment|investicij\w*|ulaganj\w*|prikupi\w*)\b/i;
const xml = new XMLParser({ ignoreAttributes: true });
function rssIntent(id: string, name: string, feed: string, country: string | null): Connector {
  return {
    id,
    name,
    kind: "rss",
    intervalMinutes: 180,
    defaultType: "intent",
    async fetch() {
      const doc = xml.parse(await getText(feed));
      const items = [doc?.rss?.channel?.item ?? []].flat() as Array<{ title: string; link: string; description?: string; pubDate?: string; guid?: string | { "#text": string } }>;
      return items
        .filter((it) => FUNDING.test(`${it.title} ${String(it.description ?? "").slice(0, 400)}`))
        .map((it) => ({
          externalId: String(typeof it.guid === "object" ? it.guid["#text"] : (it.guid ?? it.link)),
          url: String(it.link),
          title: htmlToText(String(it.title)).slice(0, 300),
          body: `FUNDING / GROWTH NEWS — the company may need an external development team soon.\n\n${it.title}\n${htmlToText(String(it.description ?? "")).slice(0, 3000)}`,
          companyName: null,
          location: country,
          salaryText: null,
          postedAt: it.pubDate ? new Date(it.pubDate) : null,
          leadType: "intent" as const,
          country,
        }));
    },
  };
}

export const TENDER_CONNECTORS: Connector[] = [
  ted,
  ukContractsFinder,
  ukFindTender,
  canadaBuys,
  rssIntent("tc-funding", "TechCrunch funding", "https://techcrunch.com/category/venture/feed/", null),
  rssIntent("startit", "Startit (Srbija)", "https://startit.rs/feed/", "RS"),
];

import { type Connector, type RawItem, USER_AGENT, getJson, htmlToText, toEur } from "./types.js";
import { rt } from "../runtime.js";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

// ── Freelancer.com (zvanični API, bez tokena za pretragu) ─────────────────────
// Uslovi (freelancer.com/about/apiterms): samo za naše licitiranje, bez objavljivanja dalje, keš do 24 h
// (worker briše opis posle 24 h — vidi purgeExpired u pipeline/run.ts), poštovati limit (200/min, 1000/h).
const FREELANCER_QUERIES = ["react", "next.js", "node.js", "web application", "full stack", "ai chatbot", "openai", "automation", "mobile app", "saas"];
type FlProject = {
  id: number;
  title: string;
  seo_url: string;
  type: "fixed" | "hourly";
  description?: string;
  preview_description?: string;
  submitdate: number;
  currency?: { code: string; sign: string };
  budget?: { minimum?: number; maximum?: number };
  bid_stats?: { bid_count?: number; bid_avg?: number };
  language?: string;
  location?: { country?: { code?: string; name?: string } };
};
const freelancer: Connector = {
  id: "freelancer",
  name: "Freelancer.com",
  kind: "api",
  intervalMinutes: 60,
  defaultType: "project",
  async fetch() {
    const seen = new Set<number>();
    const out: RawItem[] = [];
    for (const q of FREELANCER_QUERIES) {
      const data = await getJson<{ result?: { projects?: FlProject[] } }>(
        `https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(q)}&limit=30&compact=true&full_description=true&sort_field=time_updated&languages[]=en`,
      );
      for (const p of data.result?.projects ?? []) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const cur = p.currency?.code ?? "USD";
        const min = p.budget?.minimum ?? null;
        const max = p.budget?.maximum ?? null;
        // Freelancer često stavi ogroman „maksimum“ — za procenu koristimo gornju granicu samo ako je razumna
        // (npr. 10–100.000 USD ne govori ništa → bez budžeta)
        const budget = max && min && max <= min * 10 ? (min + max) / 2 : null;
        const budgetText = min && budget ? `${p.currency?.sign ?? ""}${min}${max ? `–${max}` : "+"} ${cur} ${p.type === "hourly" ? "per hour" : "fixed"}` : null;
        out.push({
          externalId: String(p.id),
          url: `https://www.freelancer.com/projects/${p.seo_url}`,
          title: p.title.slice(0, 300),
          body: [
            `FREELANCE PROJECT on Freelancer.com · ${p.type === "hourly" ? "hourly" : "fixed price"}${budgetText ? ` · budget ${budgetText}` : ""}`,
            p.bid_stats?.bid_count ? `Competition: ${p.bid_stats.bid_count} bids so far` : "",
            "",
            htmlToText(p.description ?? p.preview_description ?? "").slice(0, 5000),
          ]
            .filter((l, i) => l !== "" || i === 2)
            .join("\n"),
          companyName: null,
          location: p.location?.country?.name ?? null,
          salaryText: budgetText,
          postedAt: new Date(p.submitdate * 1000),
          leadType: "project",
          budgetEur: p.type === "fixed" && budget ? toEur(budget, cur) : null,
          country: p.location?.country?.code?.toUpperCase() ?? null,
        });
      }
    }
    return out;
  },
};

// ── SAM.gov (SAD, savezni tenderi) — besplatan ključ, 10 poziva dnevno ────────
// Jedan poziv dnevno (limit 1000), filtriramo IT NAICS kodove lokalno. Preskačemo „set-aside“ (samo za US mala preduzeća).
const SAM_NAICS = /^(541511|541512|541513|541519|518210|513210|611420)/;
type SamOpp = {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  postedDate?: string;
  type?: string;
  naicsCode?: string;
  typeOfSetAside?: string | null;
  typeOfSetAsideDescription?: string | null;
  setAside?: string | null;
  setAsideCode?: string | null;
  responseDeadLine?: string | null;
  reponseDeadLine?: string | null;
  uiLink?: string;
  award?: { amount?: string | number } | null;
};
const fmtUs = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
const sam: Connector = {
  id: "sam",
  name: "SAM.gov (US)",
  kind: "api",
  intervalMinutes: 24 * 60,
  defaultType: "tender",
  enabled: () => Boolean(rt.samKey),
  async fetch() {
    const url = new URL("https://api.sam.gov/opportunities/v2/search");
    url.searchParams.set("api_key", rt.samKey);
    url.searchParams.set("postedFrom", fmtUs(daysAgo(2)));
    url.searchParams.set("postedTo", fmtUs(new Date()));
    url.searchParams.set("ptype", "o,k,p,r");
    url.searchParams.set("limit", "1000");
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`SAM.gov → HTTP ${res.status}`); // namerno bez URL-a (sadrži ključ)
    const data = (await res.json()) as { opportunitiesData?: SamOpp[] };
    return (data.opportunitiesData ?? [])
      .filter((o) => SAM_NAICS.test(o.naicsCode ?? ""))
      .filter((o) => {
        const sa = `${o.typeOfSetAside ?? o.setAsideCode ?? o.setAside ?? ""}`.trim();
        return !sa || /^none$/i.test(sa);
      })
      .map((o) => {
        const dl = o.responseDeadLine ?? o.reponseDeadLine ?? null;
        const deadline = dl ? new Date(dl) : null;
        return {
          externalId: o.noticeId,
          url: o.uiLink ?? `https://sam.gov/opp/${o.noticeId}/view`,
          title: o.title.slice(0, 300),
          body: [
            "US FEDERAL TENDER (SAM.gov). Note: bidding usually requires SAM.gov registration; foreign vendors only for awards ≤ $40k performed outside the US.",
            `Agency: ${o.fullParentPathName ?? "unknown"}`,
            `Notice type: ${o.type ?? "?"} · NAICS ${o.naicsCode ?? "?"}`,
            `Response deadline: ${deadline && !Number.isNaN(deadline.getTime()) ? deadline.toISOString().slice(0, 10) : "not stated"}`,
            "",
            o.title,
          ].join("\n"),
          companyName: o.fullParentPathName?.split(".")[0] ?? null,
          location: "United States",
          salaryText: null,
          postedAt: o.postedDate ? new Date(o.postedDate) : null,
          leadType: "tender" as const,
          deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
          budgetEur: null,
          country: "US",
        };
      });
  },
};

// ── BiH e-nabavke (otvoreni podaci Agencije za javne nabavke, OData) ──────────
const EJN_IT = /softver|aplikacij|informacion\w* sistem|informati\w*|\bweb\b|web[- ]?stranic|portal|digitaliz|baz\w* podataka|sistem\w* za upravljanj|e-uprav|elektronsk\w* (servis|uslug|sistem)/i;
const EJN_NOT = /oprem|štampa|stampa|toner|potrošn|licenc|vozil|računar(a|sk\w* oprem)|hardver/i;
type EjnNotice = { Id: number; ProcedureId: number; ProcedureName: string; ContractingAuthorityName?: string; ContractingAuthorityCityName?: string; ApplicationDeadlineDateTime?: string; Announced?: string; ProcedureNumber?: string };
const ejn: Connector = {
  id: "ejn",
  name: "e-Nabavke BiH",
  kind: "api",
  intervalMinutes: 180,
  defaultType: "tender",
  async fetch() {
    const now = new Date().toISOString().slice(0, 19) + "Z";
    const out: RawItem[] = [];
    // Server vraća najviše 50 po strani
    for (let skip = 0; skip < 300; skip += 50) {
      const url = new URL("https://open.ejn.gov.ba/ProcurementNotices");
      url.searchParams.set("$filter", `ContractType eq 'Services' and ApplicationDeadlineDateTime gt ${now}`);
      url.searchParams.set("$orderby", "Id desc");
      url.searchParams.set("$top", "50");
      url.searchParams.set("$skip", String(skip));
      url.searchParams.set("$select", "Id,ProcedureId,ProcedureName,ProcedureNumber,ContractingAuthorityName,ContractingAuthorityCityName,ApplicationDeadlineDateTime,Announced");
      const data = await getJson<{ value?: EjnNotice[] }>(url.toString());
      const page = data.value ?? [];
      for (const n of page) {
        if (!EJN_IT.test(n.ProcedureName) || EJN_NOT.test(n.ProcedureName)) continue;
        const deadline = n.ApplicationDeadlineDateTime ? new Date(n.ApplicationDeadlineDateTime) : null;
        out.push({
          externalId: String(n.ProcedureId),
          url: `https://next.ejn.gov.ba/advertisement/procurement/${n.ProcedureId}`,
          title: n.ProcedureName.trim().slice(0, 300),
          body: [
            "PUBLIC TENDER in Bosnia and Herzegovina (e-Nabavke). Language: Bosnian/Serbian/Croatian — same as ours.",
            `Buyer: ${n.ContractingAuthorityName ?? "unknown"}${n.ContractingAuthorityCityName ? `, ${n.ContractingAuthorityCityName}` : ""}`,
            `Procedure: ${n.ProcedureNumber ?? "?"}`,
            `Submission deadline: ${deadline ? deadline.toISOString().slice(0, 10) : "not stated"}`,
            "",
            n.ProcedureName.trim(),
          ].join("\n"),
          companyName: n.ContractingAuthorityName ?? null,
          location: "Bosnia and Herzegovina",
          salaryText: null,
          postedAt: n.Announced ? new Date(n.Announced) : null,
          leadType: "tender",
          deadline,
          budgetEur: null,
          country: "BA",
        });
      }
      if (page.length < 50) break;
    }
    return out;
  },
};

export const MORE_CONNECTORS: Connector[] = [freelancer, sam, ejn];

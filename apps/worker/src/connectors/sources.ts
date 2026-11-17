import { XMLParser } from "fast-xml-parser";
import { type Connector, type RawItem, getJson, getText, htmlToText } from "./types.js";

/** RemoteOK — javni JSON API. Uslov: navesti RemoteOK kao izvor i linkovati oglas. */
const remoteok: Connector = {
  id: "remoteok",
  name: "RemoteOK",
  kind: "api",
  intervalMinutes: 30,
  defaultType: "hiring_signal",
  async fetch() {
    type Job = { id: string; company?: string; position?: string; description?: string; location?: string; salary_min?: number; salary_max?: number; date?: string; url?: string; tags?: string[] };
    const data = await getJson<Array<Job | { legal: string }>>("https://remoteok.com/api");
    return data
      .filter((j): j is Job => "id" in j && !!(j as Job).position)
      .map((j) => ({
        externalId: String(j.id),
        url: j.url ?? `https://remoteok.com/remote-jobs/${j.id}`,
        title: j.position!,
        body: [htmlToText(j.description), j.tags?.length ? `Tags: ${j.tags.join(", ")}` : ""].filter(Boolean).join("\n"),
        companyName: j.company ?? null,
        location: j.location || null,
        salaryText: j.salary_min ? `$${j.salary_min}–${j.salary_max ?? j.salary_min} / year` : null,
        postedAt: j.date ? new Date(j.date) : null,
      }));
  },
};

/** We Work Remotely — RSS po kategorijama. */
const WWR_FEEDS = [
  "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
];
const xml = new XMLParser({ ignoreAttributes: true });
const wwr: Connector = {
  id: "wwr",
  name: "We Work Remotely",
  kind: "rss",
  intervalMinutes: 30,
  defaultType: "hiring_signal",
  async fetch() {
    const out: RawItem[] = [];
    for (const feed of WWR_FEEDS) {
      try {
        const doc = xml.parse(await getText(feed));
        const items = [doc?.rss?.channel?.item ?? []].flat() as Array<{ title: string; link: string; description?: string; region?: string; pubDate?: string; guid?: string }>;
        for (const it of items) {
          const [company, ...rest] = String(it.title).split(": ");
          out.push({
            externalId: String(it.guid ?? it.link),
            url: String(it.link),
            title: rest.join(": ") || String(it.title),
            body: htmlToText(it.description),
            companyName: rest.length ? company ?? null : null,
            location: it.region ? String(it.region) : null,
            salaryText: null,
            postedAt: it.pubDate ? new Date(it.pubDate) : null,
          });
        }
      } catch (e) {
        console.warn(`[wwr] ${feed}: ${(e as Error).message}`);
      }
    }
    return out;
  },
};

/** Remotive — javni API. Traže umerenu učestalost (par puta dnevno). */
const remotive: Connector = {
  id: "remotive",
  name: "Remotive",
  kind: "api",
  intervalMinutes: 360,
  defaultType: "hiring_signal",
  async fetch() {
    type Job = { id: number; url: string; title: string; company_name: string; candidate_required_location?: string; salary?: string; publication_date?: string; description?: string; job_type?: string };
    const data = await getJson<{ jobs: Job[] }>("https://remotive.com/api/remote-jobs?category=software-dev");
    return data.jobs.map((j) => ({
      externalId: String(j.id),
      url: j.url,
      title: j.title,
      body: [j.job_type ? `Job type: ${j.job_type}` : "", htmlToText(j.description)].filter(Boolean).join("\n"),
      companyName: j.company_name,
      location: j.candidate_required_location || null,
      salaryText: j.salary || null,
      postedAt: j.publication_date ? new Date(`${j.publication_date}Z`) : null,
    }));
  },
};

/** Arbeitnow — javni API (Nemačka / EU). */
const arbeitnow: Connector = {
  id: "arbeitnow",
  name: "Arbeitnow",
  kind: "api",
  intervalMinutes: 60,
  defaultType: "hiring_signal",
  async fetch() {
    type Job = { slug: string; company_name: string; title: string; description?: string; remote?: boolean; url: string; location?: string; created_at?: number; tags?: string[]; job_types?: string[] };
    const data = await getJson<{ data: Job[] }>("https://www.arbeitnow.com/api/job-board-api");
    return data.data.map((j) => ({
      externalId: j.slug,
      url: j.url,
      title: j.title,
      body: [j.remote ? "Remote: yes" : "", j.job_types?.length ? `Job type: ${j.job_types.join(", ")}` : "", htmlToText(j.description)].filter(Boolean).join("\n"),
      companyName: j.company_name,
      location: j.location || null,
      salaryText: null,
      postedAt: j.created_at ? new Date(j.created_at * 1000) : null,
    }));
  },
};

/** Hacker News "Who is hiring?" — preko zvaničnog Algolia HN API-ja; jedna tema mesečno. */
const hn: Connector = {
  id: "hn",
  name: "HN Who is hiring",
  kind: "api",
  intervalMinutes: 360,
  defaultType: "hiring_signal",
  async fetch() {
    type Hit = { objectID: string; title: string };
    const search = await getJson<{ hits: Hit[] }>("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10");
    const story = search.hits.find((h) => /who is hiring/i.test(h.title));
    if (!story) return [];
    type Item = { id: number; text?: string | null; author?: string; created_at?: string; children?: Item[] };
    const thread = await getJson<Item>(`https://hn.algolia.com/api/v1/items/${story.objectID}`);
    return (thread.children ?? [])
      .filter((c) => c.text && c.text.length > 80)
      // Pravi oglasi imaju format "Firma | Pozicija | Lokacija | ..."; preskačemo ostalo (traže posao, komentari).
      .filter((c) => (htmlToText(c.text).split("\n")[0] ?? "").includes("|") && !/\b(seeking|looking for work|hire me)\b/i.test(c.text ?? ""))
      .map((c) => {
        const text = htmlToText(c.text);
        const firstLine = text.split("\n")[0] ?? "";
        const parts = firstLine.split("|").map((p) => p.trim());
        return {
          externalId: String(c.id),
          url: `https://news.ycombinator.com/item?id=${c.id}`,
          title: (parts[1] ?? firstLine).slice(0, 160),
          body: text,
          companyName: parts[0]?.slice(0, 80) || null,
          location: parts.slice(2).join(" | ").slice(0, 160) || null,
          salaryText: null,
          postedAt: c.created_at ? new Date(c.created_at) : null,
        };
      });
  },
};

/** Himalayas — javni API. Uslov: navesti Himalayas kao izvor i koristiti njihov applicationLink. */
const himalayas: Connector = {
  id: "himalayas",
  name: "Himalayas",
  kind: "api",
  intervalMinutes: 60,
  defaultType: "hiring_signal",
  async fetch() {
    type Job = { title: string; companyName?: string; description?: string; excerpt?: string; employmentType?: string; minSalary?: number | null; maxSalary?: number | null; currency?: string | null; salaryPeriod?: string; locationRestrictions?: string[]; categories?: string[]; pubDate?: number; applicationLink?: string; guid: string };
    const out: RawItem[] = [];
    for (let offset = 0; offset < 200; offset += 20) {
      const data = await getJson<{ jobs: Job[] }>(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`);
      if (!data.jobs?.length) break;
      for (const j of data.jobs) {
        out.push({
          externalId: j.guid,
          url: j.applicationLink ?? j.guid,
          title: j.title,
          body: [j.employmentType ? `Job type: ${j.employmentType}` : "", j.categories?.length ? `Categories: ${j.categories.join(", ")}` : "", htmlToText(j.description ?? j.excerpt)].filter(Boolean).join("\n"),
          companyName: j.companyName ?? null,
          location: j.locationRestrictions?.length ? j.locationRestrictions.join(", ") : "Worldwide",
          salaryText: j.minSalary ? `${j.currency ?? "$"} ${j.minSalary}–${j.maxSalary ?? j.minSalary} / ${j.salaryPeriod ?? "year"}` : null,
          postedAt: j.pubDate ? new Date(j.pubDate * 1000) : null,
        });
      }
    }
    return out;
  },
};

/** Jobicy — javni API (dev oglasi). Uslov: navesti Jobicy i linkovati originalni oglas. */
const jobicy: Connector = {
  id: "jobicy",
  name: "Jobicy",
  kind: "api",
  intervalMinutes: 60,
  defaultType: "hiring_signal",
  async fetch() {
    type Job = { id: number; url: string; jobTitle: string; companyName?: string; jobType?: string[]; jobGeo?: string; jobLevel?: string; jobDescription?: string; jobExcerpt?: string; pubDate?: string; salaryMin?: number; salaryMax?: number; salaryCurrency?: string };
    const data = await getJson<{ jobs?: Job[] }>("https://jobicy.com/api/v2/remote-jobs?count=50&industry=dev");
    return (data.jobs ?? []).map((j) => ({
      externalId: String(j.id),
      url: j.url,
      title: j.jobTitle,
      body: [j.jobType?.length ? `Job type: ${j.jobType.join(", ")}` : "", j.jobLevel ? `Level: ${j.jobLevel}` : "", htmlToText(j.jobDescription ?? j.jobExcerpt)].filter(Boolean).join("\n"),
      companyName: j.companyName ?? null,
      location: j.jobGeo ?? null,
      salaryText: j.salaryMin ? `${j.salaryCurrency ?? "$"} ${j.salaryMin}–${j.salaryMax ?? j.salaryMin} / year` : null,
      postedAt: j.pubDate ? new Date(j.pubDate) : null,
    }));
  },
};

import { TENDER_CONNECTORS } from "./tenders.js";
import { emailIn } from "./email.js";
import { MORE_CONNECTORS } from "./more.js";
import { REGION_CONNECTORS } from "./region.js";

/** Prvo projekti (tenderi, signali namere), pa oglasi za posao (hiring signal). */
export const CONNECTORS: Connector[] = [emailIn, ...TENDER_CONNECTORS, ...MORE_CONNECTORS, ...REGION_CONNECTORS, remoteok, wwr, remotive, arbeitnow, hn, himalayas, jobicy];

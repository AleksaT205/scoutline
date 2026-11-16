import { describe, expect, it } from "vitest";
import { detectPlatform, linkify, normalizeUrl, parseEmail } from "./email-parse.js";

// Bez LITELLM_KEY → koristi se rezervno parsiranje (pravila)
const alertHtml = `<html><body>
<h2>New jobs matching "react"</h2>
<table>
<tr><td><a href="https://www.upwork.com/jobs/~01abc123?source=rss&amp;utm_medium=email">Build a React dashboard for logistics startup</a>
<p>Fixed price: $2,500 · We need a React + Node dashboard with charts and auth.</p></td></tr>
<tr><td><a href="https://www.upwork.com/jobs/~01def456?utm_source=alert">Integrate OpenAI chatbot into Shopify store</a>
<p>Hourly · Expert · Add an AI assistant to our store.</p></td></tr>
<tr><td><a href="https://www.upwork.com/ab/notification-settings">Manage notification settings</a></td></tr>
<tr><td><a href="https://www.upwork.com/nx/unsubscribe?x=1">Unsubscribe</a></td></tr>
</table></body></html>`;

describe("Email-in parsiranje", () => {
  it("prepozna Upwork i izvuče oglase bez šuma", async () => {
    const items = await parseEmail({ from: "donotreply@upwork.com", subject: "New jobs: react", html: alertHtml, text: null, date: new Date(), messageId: "m1" });
    expect(items.map((i) => i.title)).toEqual(["Build a React dashboard for logistics startup", "Integrate OpenAI chatbot into Shopify store"]);
    expect(items[0]!.sourceId).toBe("email-upwork");
    expect(items[0]!.leadType).toBe("project");
    expect(items[0]!.url).toBe("https://www.upwork.com/jobs/~01abc123");
    expect(items[0]!.body).toContain("React + Node dashboard");
  });

  it("isti oglas iz dva mejla ima isti ključ", async () => {
    const a = await parseEmail({ from: "donotreply@upwork.com", subject: "a", html: alertHtml, text: null, date: null, messageId: "1" });
    const b = await parseEmail({ from: "donotreply@upwork.com", subject: "b", html: alertHtml.replace(/utm_source=alert/, "utm_source=digest"), text: null, date: null, messageId: "2" });
    expect(a[1]!.dedupeKey).toBe(b[1]!.dedupeKey);
  });

  it("prosleđen mejl: platforma iz „From:“ u telu", () => {
    const { links } = linkify(alertHtml);
    const p = detectPlatform({ from: "aleksa@gmail.com", subject: "Fwd: New jobs", html: null, text: "---------- Forwarded message ---------\nFrom: Upwork <donotreply@upwork.com>\n", date: null, messageId: "x" }, links);
    expect(p.id).toBe("email-upwork");
  });

  it("direktan upit klijenta = jedan lead iz celog mejla", async () => {
    const items = await parseEmail({
      from: "ceo@acme-logistics.de",
      subject: "Need a team for our customer portal",
      html: null,
      text: "Hi, we are looking for an agency to build a customer portal (React/Node). Budget around €30k. More: https://acme-logistics.de/brief",
      date: null,
      messageId: "m3",
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Need a team for our customer portal");
    expect(items[0]!.sourceId).toBe("email-inbox");
  });

  it("Portal javnih nabavki → tender u Srbiji", async () => {
    const html = `<p>Novi postupak:</p><a href="https://jnportal.ujn.gov.rs/tender-eo/12345">Izrada veb portala opštine Zemun i održavanje</a><p>Rok za podnošenje ponuda: 15.12.2026.</p>`;
    const items = await parseEmail({ from: "noreply@ujn.gov.rs", subject: "Obaveštenje", html, text: null, date: null, messageId: "m4" });
    expect(items[0]!.leadType).toBe("tender");
    expect(items[0]!.country).toBe("RS");
  });

  it("uklanja parametre za praćenje", () => {
    expect(normalizeUrl("https://example.com/job/1?utm_source=x&id=5")).toBe("https://example.com/job/1?id=5");
  });
});

describe("Email-in — tekstualni mejlovi i budžet", () => {
  it("prosleđen tekstualni mejl: naslov iz reda iznad linka, budžet iz teksta", async () => {
    const items = await parseEmail({
      from: "aleksa@example.com",
      subject: "Fwd: New projects on PeoplePerHour",
      html: null,
      text: "From: PeoplePerHour <noreply@peopleperhour.com>\n\nBuild an MVP marketplace web app (budget £3,000)\nhttps://www.peopleperhour.com/freelance-jobs/build-an-mvp-4455667\nWe are a London startup.",
      date: null,
      messageId: "m5",
    });
    expect(items[0]!.sourceId).toBe("email-pph");
    expect(items[0]!.title).toBe("Build an MVP marketplace web app (budget £3,000)");
    expect(items[0]!.budgetEur).toBe(3510);
  });

  it("naslov posla sa rečju „support“ nije šum", async () => {
    const html = `<a href="https://www.upwork.com/jobs/~1">Add GPT-based support chatbot to our SaaS</a><a href="https://www.upwork.com/support">Help and support</a>`;
    const items = await parseEmail({ from: "donotreply@upwork.com", subject: "x", html, text: null, date: null, messageId: "m6" });
    expect(items.map((i) => i.title)).toEqual(["Add GPT-based support chatbot to our SaaS"]);
  });
});

describe("Email-in — budžet", () => {
  it("evropski zapis hiljada i satnice", async () => {
    const one = async (text: string) =>
      (await parseEmail({ from: "x@firma.rs", subject: "Upit", html: null, text, date: null, messageId: text }))[0]!.budgetEur;
    expect(await one("Budžet oko 15.000 EUR, početak u januaru.")).toBe(15000);
    expect(await one("Hourly: $40-70 per hour, long term.")).toBeNull();
  });
});

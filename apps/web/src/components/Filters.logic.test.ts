import { describe, expect, it } from "vitest";
import { applyFilters, freshFilters, sortLeads } from "./Filters";
import { lead } from "../test/leads";

const ids = (list: Array<{ id: string }>) => list.map((l) => l.id);

describe("lead filters", () => {
  const leads = [
    lead({ id: "tender-high", leadType: "tender", score: 90, budgetEur: 50_000, source: "EU TED tenders", tier: "T1" }),
    lead({ id: "project-mid", leadType: "project", score: 65, budgetEur: 3_000, source: "Freelancer.com", tier: "T2", title: "Booking app for a salon" }),
    lead({ id: "project-low", leadType: "project", score: 30, source: "Freelancer.com" }),
    lead({ id: "hiring", leadType: "hiring_signal", score: 80, source: "RemoteOK" }),
    lead({ id: "won", leadType: "project", score: 70, status: "won" }),
    lead({ id: "hidden", leadType: "project", score: 95, status: "hidden" }),
    lead({ id: "no-budget", leadType: "intent", score: 55, budgetEur: 0, tier: null, postedMinutesAgo: 60 * 24 * 10 }),
  ];

  it("by default shows open projects for the agency, 50+ — no job ads, no won or hidden leads", () => {
    expect(ids(applyFilters(leads, freshFilters()))).toEqual(["tender-high", "project-mid", "no-budget"]);
  });
  it("includes job ads only when that type is switched on", () => {
    const f = freshFilters({ types: new Set(["hiring_signal"] as const) });
    expect(ids(applyFilters(leads, f))).toEqual(["hiring"]);
  });
  it("filters by minimum score", () => {
    expect(ids(applyFilters(leads, freshFilters({ minScore: 70 })))).toEqual(["tender-high"]);
    expect(ids(applyFilters(leads, freshFilters({ minScore: 0 })))).toContain("project-low");
  });
  it("minimum budget keeps leads without a stated budget, unless 'stated only' is on", () => {
    expect(ids(applyFilters(leads, freshFilters({ minBudget: 5_000 })))).toEqual(["tender-high", "no-budget"]);
    expect(ids(applyFilters(leads, freshFilters({ minBudget: 5_000, budgetKnownOnly: true })))).toEqual(["tender-high"]);
  });
  it("filters by source, market, status, age and search text", () => {
    expect(ids(applyFilters(leads, freshFilters({ sources: new Set(["Freelancer.com"]) })))).toEqual(["project-mid"]);
    expect(ids(applyFilters(leads, freshFilters({ markets: new Set(["T2"] as const) })))).toEqual(["project-mid"]);
    expect(ids(applyFilters(leads, freshFilters({ status: "won" })))).toEqual(["won"]);
    expect(ids(applyFilters(leads, freshFilters({ status: "hidden" })))).toEqual(["hidden"]);
    expect(ids(applyFilters(leads, freshFilters({ maxAgeHours: 24 })))).not.toContain("no-budget");
    expect(ids(applyFilters(leads, freshFilters({ query: "  SALON " })))).toEqual(["project-mid"]);
  });
  it("sorts by the chosen column and always puts missing values last", () => {
    const list = [lead({ id: "a", score: 50, budgetEur: 0 }), lead({ id: "b", score: 60, budgetEur: 1_000 }), lead({ id: "c", score: 70, budgetEur: 9_000 })];
    expect(ids(sortLeads(list, "score", "desc"))).toEqual(["c", "b", "a"]);
    expect(ids(sortLeads(list, "budget", "desc"))).toEqual(["c", "b", "a"]);
    expect(ids(sortLeads(list, "budget", "asc"))).toEqual(["b", "c", "a"]);
  });
  it("gives every caller its own filter sets", () => {
    const a = freshFilters();
    a.types.clear();
    expect(freshFilters().types.size).toBe(3);
  });
});

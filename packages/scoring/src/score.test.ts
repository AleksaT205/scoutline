import { describe, expect, it } from "vitest";
import { scoreItem } from "./score.js";

const base = { company: "Acme", location: null, salaryText: null, useAi: false as const };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

describe("tip leada", () => {
  it("tender ostaje tender, sa budžetom iz izvora i bonusom", async () => {
    const r = await scoreItem({
      ...base,
      title: "Development of a citizen web portal",
      body: "PUBLIC TENDER. Web application development and maintenance.",
      leadType: "tender",
      budgetHintEur: 120_000,
      deadline: inDays(30),
      prior: { country: "DE", remoteOk: null },
    });
    expect(r.leadType).toBe("tender");
    expect(r.budgetEur).toBe(120_000);
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.status).toBe("new");
  });

  it("tender kome je prošao rok se sakriva", async () => {
    const r = await scoreItem({ ...base, title: "Software development services", body: "Tender", leadType: "tender", deadline: inDays(-1) });
    expect(r.score).toBe(0);
    expect(r.status).toBe("hidden");
  });

  it("oglas za stalno zaposlenje je slab signal", async () => {
    const r = await scoreItem({ ...base, title: "Senior Full-stack Engineer (React, Node)", body: "Full-time position, great benefits.", leadType: "hiring_signal" });
    expect(r.leadType).toBe("hiring_signal");
    expect(r.aiScore).toBeLessThanOrEqual(50);
  });

  it("oglas sa contract/freelance postaje projekat", async () => {
    const r = await scoreItem({ ...base, title: "Freelance React developer for MVP", body: "Contract, 3 months, remote." });
    expect(r.leadType).toBe("project");
  });
});

import { describe, expect, it } from "vitest";
import { budgetFromSalary, passesPrefilter, scoreByRules } from "./rules.js";

describe("prefilter", () => {
  it("keeps software roles", () => {
    expect(passesPrefilter("Senior Full-Stack Developer", "")).toBe(true);
    expect(passesPrefilter("Backend Engineer (Node.js)", "")).toBe(true);
    expect(passesPrefilter("Softwareentwickler (m/w/d)", "")).toBe(false); // compound word — body needed
    expect(passesPrefilter("Entwickler Java (m/w/d)", "")).toBe(true);
  });
  it("drops non-software roles even if body mentions AI", () => {
    expect(passesPrefilter("Go-To-Market Specialist", "We use AI and software")).toBe(false);
    expect(passesPrefilter("Staff Product Designer", "React team")).toBe(false);
    expect(passesPrefilter("Mechanical Engineer", "")).toBe(false);
    expect(passesPrefilter("Software Engineering Intern", "")).toBe(false);
  });
  it("uses body only when allowed (HN multi-role posts)", () => {
    expect(passesPrefilter("Multiple roles", "Hiring full-stack engineers, React/Node")).toBe(false);
    expect(passesPrefilter("Multiple roles", "Hiring full-stack engineers, React/Node", { allowBody: true })).toBe(true);
  });
});

describe("rules scoring", () => {
  it("rewards contract full-stack work", () => {
    const r = scoreByRules("Contract Full-Stack Developer for MVP", "React and Node, freelance");
    expect(r.aiScore).toBeGreaterThanOrEqual(70);
    expect(r.category).toBe("fullstack_app");
  });
  it("parses salary to EUR", () => {
    expect(budgetFromSalary("$170k - $200k")).toBe(170200);
    expect(budgetFromSalary(null)).toBeNull();
  });
});

describe("AI-training gigs", () => {
  it("are not dev leads", () => {
    expect(passesPrefilter("Physician (MD/DO) - Put Medical AI to the Test, Remote", "")).toBe(false);
    expect(passesPrefilter("AI Data Annotator", "")).toBe(false);
  });
});

describe("category from title first", () => {
  it("does not label every post as AI", () => {
    expect(scoreByRules("Senior React Full-stack Developer", "We are an AI-first company").category).toBe("fullstack_app");
    expect(scoreByRules("AI Engineer", "Python").category).toBe("ai_integration");
  });
});

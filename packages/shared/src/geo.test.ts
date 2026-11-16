import { describe, expect, it } from "vitest";
import { detectCountry, remoteFriendly, tierOf } from "./geo.js";
import { finalScore } from "./score.js";

describe("geo", () => {
  it("maps countries to tiers", () => {
    expect(tierOf("us")).toBe("T1");
    expect(tierOf("ES")).toBe("T2");
    expect(tierOf("RS")).toBe("DOMESTIC");
    expect(tierOf("BR")).toBe("T3");
    expect(tierOf(null)).toBe("T3");
  });
  it("detects country from location and currency", () => {
    expect(detectCountry({ location: "Austin, Texas" })).toBe("US");
    expect(detectCountry({ location: "Remote — Berlin office" })).toBe("DE");
    expect(detectCountry({ location: "Remote", salaryText: "£60k" })).toBe("GB");
    expect(detectCountry({ location: "Beograd" })).toBe("RS");
    expect(detectCountry({ location: "Remote" })).toBeNull();
  });
  it("detects remote friendliness", () => {
    expect(remoteFriendly("Remote, worldwide. Contractors welcome")).toBe(true);
    expect(remoteFriendly("US citizens only, hybrid")).toBe(false);
    expect(remoteFriendly("Great team")).toBeNull();
  });
});

describe("finalScore", () => {
  it("rewards T1, remote and budget; clamps to 0–100", () => {
    expect(finalScore({ aiScore: 90, tier: "T1", remoteOk: true, budgetEur: 25000 })).toBe(100);
    expect(finalScore({ aiScore: 80, tier: "T3", remoteOk: null, budgetEur: null })).toBe(48);
    expect(finalScore({ aiScore: 80, tier: "T1", remoteOk: false, budgetEur: 300 })).toBe(45);
  });
});

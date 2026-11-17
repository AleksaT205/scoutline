import { describe, expect, it } from "vitest";
import { projectKey } from "./delivery.js";

describe("ključ projekta", () => {
  it("inicijali ili prva slova", () => {
    expect(projectKey("Acme GmbH")).toBe("AG");
    expect(projectKey("Kite Health Inc")).toBe("KHI");
    expect(projectKey("Scoutline")).toBe("SCOU");
    expect(projectKey("Ćevapi Šop")).toBe("CS");
    expect(projectKey("")).toBe("PRJ");
  });
});

import { parseRepo } from "./delivery.js";
describe("GitHub repo iz linka", () => {
  it("prepozna owner/repo", () => {
    expect(parseRepo("https://github.com/acme/app")).toEqual({ owner: "acme", repo: "app" });
    expect(parseRepo("https://github.com/acme/my.app.git/")).toEqual({ owner: "acme", repo: "my.app" });
    expect(parseRepo("git@github.com:acme/app.git")).toEqual({ owner: "acme", repo: "app" });
    expect(parseRepo("https://gitlab.com/acme/app")).toBeNull();
  });
});

import { fmtMinutes, parseDuration } from "./delivery.js";
describe("trajanje", () => {
  it("razume uobičajene zapise", () => {
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("2")).toBe(120);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("abc")).toBeNull();
    expect(fmtMinutes(90)).toBe("1h 30m");
    expect(fmtMinutes(45)).toBe("45m");
  });
});

import { branchName, slugify } from "./delivery";
describe("branchName", () => {
  it("feature grana sa ključem i opisom bez naših slova", () => {
    expect(branchName({ key: "PZS", number: 1, title: "Početna strana" })).toBe("feature/pzs-1-pocetna-strana");
  });
  it("bug → fix/", () => {
    expect(branchName({ key: "PZS", number: 4, title: "Bug: meni na telefonu" })).toBe("fix/pzs-4-meni-na-telefonu");
    expect(branchName({ key: "ACME", number: 9, title: "Login ne radi", labels: ["bug"] })).toBe("fix/acme-9-login-ne-radi");
  });
  it("bez taska i sa đ", () => {
    expect(branchName({ title: "Đački popust na kolače" })).toBe("feature/djacki-popust-na-kolace");
    expect(slugify("  —  ")).toBe("");
    expect(branchName({ title: "!!!" })).toBe("feature/update");
  });
});


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

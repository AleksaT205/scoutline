import { beforeEach, describe, expect, it } from "vitest";
import { getHashParam, setHashParam } from "./hashParams";

describe("state in the address (#/page?name=value)", () => {
  beforeEach(() => window.history.replaceState(null, "", "#/"));

  it("reads a parameter after the question mark", () => {
    window.history.replaceState(null, "", "#/delivery/projects/abc?view=code&tab=pulls");
    expect(getHashParam("view")).toBe("code");
    expect(getHashParam("tab")).toBe("pulls");
    expect(getHashParam("missing")).toBeNull();
  });
  it("writes, replaces and removes a parameter without touching the page path", () => {
    window.history.replaceState(null, "", "#/settings");
    setHashParam("tab", "team");
    expect(window.location.hash).toBe("#/settings?tab=team");
    setHashParam("tab", "system");
    expect(window.location.hash).toBe("#/settings?tab=system");
    setHashParam("tab", null);
    expect(window.location.hash).toBe("#/settings");
  });
  it("clears the lead link so the same notification can be opened again", () => {
    window.history.replaceState(null, "", "#/?lead=123");
    expect(getHashParam("lead")).toBe("123");
    setHashParam("lead", null);
    expect(window.location.hash).toBe("#/");
  });
});

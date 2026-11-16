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

import { describe, expect, it } from "vitest";
import { titleKey, titleKeyIsSpecific } from "./dedupe.js";

describe("titleKey", () => {
  it("matches the same tender from two sources", () => {
    expect(titleKey("Ireland – IT services: consulting, software development – 2026/S 221-712345")).toBe(titleKey("IRELAND - IT Services: Consulting, Software Development"));
  });
  it("ignores diacritics and case", () => {
    expect(titleKey("Izrada veb sajta za Opštinu Čačak")).toBe(titleKey("izrada veb sajta za opstinu cacak"));
  });
  it("short generic titles are not specific enough", () => {
    expect(titleKeyIsSpecific(titleKey("Web developer"))).toBe(false);
    expect(titleKeyIsSpecific(titleKey("Development of a booking platform for municipal sports centres"))).toBe(true);
  });
});

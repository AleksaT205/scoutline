import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Filters, applyFilters, freshFilters, type FilterState } from "./Filters";
import { lead } from "../test/leads";

const LEADS = [
  lead({ id: "t1", leadType: "tender", score: 90, budgetEur: 50_000 }),
  lead({ id: "t2", leadType: "tender", score: 80, budgetEur: 2_000 }),
  lead({ id: "p1", leadType: "project", score: 70, budgetEur: 30_000, status: "won" }),
  lead({ id: "h1", leadType: "hiring_signal", score: 85 }),
];
function Harness() {
  const [f, setF] = useState<FilterState>(() => freshFilters());
  return <Filters value={f} onChange={setF} all={LEADS} shown={applyFilters(LEADS, f).length} />;
}
// Broj rezultata je složen iz više delova („2“ + „ of “ + „4“ + „ leads“), pa se čita cela oznaka
const count = () => document.querySelector("[aria-live=polite]")?.textContent;
const openPanel = () => (fireEvent.click(screen.getByRole("button", { name: /^Filters/ })), screen.getByRole("dialog", { name: "Filters" }));

describe("Leads filter bar", () => {
  it("shows type chips with counts and the number of matching leads", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /Tenders\s*2/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Hiring signals\s*1/ }).getAttribute("aria-pressed")).toBe("false");
    expect(count()).toBe("2 of 4 leads");
  });
  it("switching a type on changes the result and offers a reset", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Hiring signals/ }));
    expect(count()).toBe("3 of 4 leads");
    fireEvent.click(screen.getByRole("button", { name: /Reset filters/ }));
    expect(count()).toBe("2 of 4 leads");
  });
  it("the Filters panel groups the rest and each choice shows up as a removable chip", () => {
    render(<Harness />);
    const panel = openPanel();
    for (const group of ["Budget", "Market", "Status", "Work mode", "Service", "Industry", "Source"]) expect(within(panel).getByText(group)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "€20k+" }));
    expect(count()).toBe("1 of 4 leads");
    const chip = screen.getByTitle("Remove this filter");
    expect(chip.textContent).toContain("Budget €20k+");
    fireEvent.click(chip);
    expect(count()).toBe("2 of 4 leads");
  });
  it("Status uses the app's own dropdown, not the system one", () => {
    render(<Harness />);
    const panel = openPanel();
    expect(panel.querySelector("select")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /^Status: Open/ }));
    fireEvent.click(within(panel).getByRole("option", { name: "Won" }));
    expect(count()).toBe("1 of 4 leads");
    expect(screen.getByTitle("Remove this filter").textContent).toContain("Status: Won");
  });
  it("the panel closes with its button and with Escape", () => {
    render(<Harness />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /^Show/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    openPanel();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

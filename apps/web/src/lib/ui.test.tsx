import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Select } from "./ui";

function Harness({ onPick }: { onPick: (v: string) => void }) {
  const [v, setV] = useState("member");
  return (
    <Select value={v} aria-label="Role" onChange={(e) => (onPick(e.target.value), setV(e.target.value))}>
      <option value="owner">Owner</option>
      <option value="member">Member</option>
      <option value="guest" disabled>
        Guest
      </option>
    </Select>
  );
}
const trigger = () => screen.getByRole("combobox", { name: "Role" });

describe("Select (styled dropdown)", () => {
  it("shows the current value and keeps the list closed", () => {
    render(<Harness onPick={vi.fn()} />);
    expect(trigger().textContent).toContain("Member");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("opens on click, marks the current option and picks another one", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(trigger());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Owner", "Member", "Guest"]);
    expect(screen.getByRole("option", { name: "Member" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Owner" }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("owner");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger().textContent).toContain("Owner");
  });
  it("does not report a change when the same value is picked, or a disabled one", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Guest" }));
    fireEvent.click(screen.getByRole("option", { name: "Member" }));
    expect(onPick).not.toHaveBeenCalled();
  });
  it("works from the keyboard: arrows move (skipping disabled), Enter picks, Escape closes", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" }); // „Guest“ je isključen — ostaje na „Member“
    fireEvent.keyDown(trigger(), { key: "ArrowUp" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledExactlyOnceWith("owner");
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onPick).toHaveBeenCalledTimes(1);
  });
  it("closes when you click somewhere else", () => {
    render(<Harness onPick={vi.fn()} />);
    fireEvent.click(trigger());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

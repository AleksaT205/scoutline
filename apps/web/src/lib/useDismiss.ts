import { useEffect, type RefObject } from "react";

/** Zatvaranje padajućeg menija: klik/dodir van njega, Esc ili prelazak na drugu stranicu. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("hashchange", close);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("hashchange", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

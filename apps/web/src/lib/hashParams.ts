import { useCallback, useState } from "react";

/**
 * Stanje prikaza u adresi (posle „?“ u hash-u), npr. #/delivery/projects/<id>?view=code&tab=terminal.
 * Osvežavanje stranice vraća isti prikaz, a link može da se pošalje. Upis ide preko history.replaceState —
 * bez novog unosa u istoriju i bez ponovnog renderovanja cele aplikacije.
 */
export function getHashParam(name: string): string | null {
  const q = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(q).get(name);
}

export function setHashParam(name: string, value: string | null) {
  const [path = "", q = ""] = window.location.hash.slice(1).split("?");
  const p = new URLSearchParams(q);
  if (value == null || value === "") p.delete(name);
  else p.set(name, value);
  const s = p.toString();
  window.history.replaceState(window.history.state, "", `#${path}${s ? `?${s}` : ""}`);
}

/** useState koji se pamti u adresi. `allowed` štiti od pogrešnih vrednosti iz ručno izmenjenog linka. */
export function useHashParam<T extends string>(name: string, fallback: T | (() => T), allowed?: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const v = getHashParam(name) as T | null;
    if (v && (!allowed || allowed.includes(v))) return v;
    return typeof fallback === "function" ? (fallback as () => T)() : fallback;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      setHashParam(name, v);
    },
    [name],
  );
  return [value, set];
}

/** Isto, za vrednost koja može da ne postoji (npr. otvoren task). */
export function useOptionalHashParam(name: string): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => getHashParam(name));
  const set = useCallback(
    (v: string | null) => {
      setValue(v);
      setHashParam(name, v);
    },
    [name],
  );
  return [value, set];
}

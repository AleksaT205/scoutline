import { useCallback, useEffect, useSyncExternalStore } from "react";
import { teamFetch } from "./team";
import { onAccountChange } from "./session";

/**
 * Keš podataka za celu aplikaciju („stale-while-revalidate“):
 * - stranica se odmah prikaže sa poslednjim podacima, a sveži stižu u pozadini;
 * - isti zahtev se ne šalje dvaput u isto vreme;
 * - prefetch() unapred učita podatke (hover na meni, mirovanje posle učitavanja);
 * - važne liste se pamte i u localStorage, pa je i novo otvaranje aplikacije odmah puno.
 * Osvežavanje stoji dok je tab sakriven (štedi bateriju i mrežu na telefonu).
 */
interface Entry {
  data?: unknown;
  at: number; // kad je stiglo (ms), 0 = nikad
  error?: string;
  promise?: Promise<unknown>;
  subs: Set<() => void>;
}

const store = new Map<string, Entry>();
const LS_PREFIX = "scoutline-cache:";
const PERSIST = /^\/(leads\?|stats$|sources$|analytics|notifications$|delivery\/(projects$|customers$|cycles$|issues\?))/;
const MAX_PERSIST_CHARS = 1_500_000;

function entry(key: string): Entry {
  let e = store.get(key);
  if (!e) {
    e = { at: 0, subs: new Set() };
    if (PERSIST.test(key)) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        if (raw) {
          const saved = JSON.parse(raw) as { at: number; data: unknown };
          e.data = saved.data;
          e.at = saved.at;
        }
      } catch {
        /* privatni režim ili oštećen zapis — samo učitaj iznova */
      }
    }
    store.set(key, e);
  }
  return e;
}

const notify = (e: Entry) => e.subs.forEach((f) => f());

function persist(key: string, e: Entry) {
  if (!PERSIST.test(key)) return;
  try {
    const raw = JSON.stringify({ at: e.at, data: e.data });
    if (raw.length < MAX_PERSIST_CHARS) localStorage.setItem(LS_PREFIX + key, raw);
  } catch {
    /* pun ili zabranjen storage — keš u memoriji i dalje radi */
  }
}

/** Učita podatke (deli zahtev ako je već u toku). */
export function load<T = unknown>(key: string): Promise<T> {
  const e = entry(key);
  if (e.promise) return e.promise as Promise<T>;
  const p = teamFetch<T>(key)
    .then((d) => {
      e.data = d;
      e.at = Date.now();
      e.error = undefined;
      persist(key, e);
      return d;
    })
    .catch((err: Error) => {
      e.error = err.message;
      throw err;
    })
    .finally(() => {
      e.promise = undefined;
      notify(e);
    });
  e.promise = p;
  notify(e);
  return p;
}

/** Unapred učitaj ako podaci nisu sveži (podrazumevano: mlađi od 30 s se ne diraju). */
export function prefetch(key: string, maxAgeMs = 30_000) {
  const e = entry(key);
  if (e.promise || Date.now() - e.at < maxAgeMs) return;
  load(key).catch(() => undefined);
}

/** Lokalna izmena (optimistično): odmah promeni keš i obavesti sve prikaze. */
export function mutate<T>(key: string, fn: (cur: T | undefined) => T | undefined) {
  const e = entry(key);
  e.data = fn(e.data as T | undefined);
  persist(key, e);
  notify(e);
}

/** Obriši sav keš (odjava, promena korisnika). */
export function clearCache() {
  store.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
  } catch {
    /* ništa */
  }
}

export interface Cached<T> {
  data: T | undefined;
  error: string | null;
  /** Prvi put se učitava (nema ničeg za prikaz). */
  loading: boolean;
  /** Stiže osvežavanje u pozadini. */
  refreshing: boolean;
  loadedAt: number;
  reload: () => Promise<void>;
  setData: (fn: (cur: T | undefined) => T | undefined) => void;
}

/**
 * Hook: podaci za `key` (API putanja). `null` = ništa ne učitavaj.
 * staleMs — koliko dugo su podaci „sveži“ (ne učitava ponovo pri otvaranju stranice);
 * refreshMs — periodično osvežavanje dok je stranica otvorena (0 = isključeno).
 */
export function useCached<T>(key: string | null, opts: { staleMs?: number; refreshMs?: number } = {}): Cached<T> {
  const { staleMs = 15_000, refreshMs = 0 } = opts;
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => undefined;
      const e = entry(key);
      e.subs.add(cb);
      return () => {
        e.subs.delete(cb);
      };
    },
    [key],
  );
  // Snapshot = sam Entry objekat + vreme; menja se samo kad stignu novi podaci
  const snap = useSyncExternalStore(subscribe, () => (key ? snapshot(key) : EMPTY));

  useEffect(() => {
    if (!key) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      const e = entry(key);
      if (Date.now() - e.at >= staleMs) load(key).catch(() => undefined);
    };
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const id = refreshMs ? setInterval(() => document.visibilityState === "visible" && load(key).catch(() => undefined), refreshMs) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (id) clearInterval(id);
    };
  }, [key, staleMs, refreshMs]);

  const reload = useCallback(async () => {
    if (key) await load(key).catch(() => undefined);
  }, [key]);
  const setData = useCallback((fn: (cur: T | undefined) => T | undefined) => key && mutate<T>(key, fn), [key]);

  return {
    data: snap.data as T | undefined,
    error: snap.data === undefined ? snap.error : null,
    loading: snap.data === undefined && !snap.error,
    refreshing: snap.refreshing,
    loadedAt: snap.at,
    reload,
    setData,
  };
}

interface Snap {
  data: unknown;
  error: string | null;
  at: number;
  refreshing: boolean;
}
const EMPTY: Snap = { data: undefined, error: null, at: 0, refreshing: false };
const snaps = new Map<string, Snap>();
function snapshot(key: string): Snap {
  const e = entry(key);
  const prev = snaps.get(key);
  const refreshing = !!e.promise;
  const error = e.error ?? null;
  if (prev && prev.data === e.data && prev.at === e.at && prev.refreshing === refreshing && prev.error === error) return prev;
  const next = { data: e.data, error, at: e.at, refreshing };
  snaps.set(key, next);
  return next;
}

// Drugi nalog = drugi podaci
onAccountChange(clearCache);

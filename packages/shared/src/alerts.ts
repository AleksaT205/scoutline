import type { ServiceCategory, Tier } from "./index.js";

/** Koje leadove šaljemo na Telegram — menja se iz dashboard-a. */
export interface AlertSettings {
  enabled: boolean;
  minScore: number; // 50–95
  markets: Array<Tier | "UNKNOWN">;
  categories: ServiceCategory[]; // prazno = sve
  remoteOnly: boolean;
  maxAgeHours: number; // samo oglasi objavljeni u poslednjih N sati
}

export const DEFAULT_ALERTS: AlertSettings = {
  enabled: true,
  minScore: 75,
  markets: ["T1", "T2", "T3", "UNKNOWN", "DOMESTIC"],
  categories: [],
  remoteOnly: false,
  maxAgeHours: 48,
};

/** Spoji sačuvana podešavanja sa podrazumevanim (i očisti neispravne vrednosti). */
export function normalizeAlerts(input: unknown): AlertSettings {
  const v = (input ?? {}) as Partial<AlertSettings>;
  const clamp = (n: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : d);
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_ALERTS.enabled,
    minScore: clamp(v.minScore, 0, 100, DEFAULT_ALERTS.minScore),
    markets: Array.isArray(v.markets) ? v.markets.filter((m) => ["T1", "T2", "T3", "UNKNOWN", "DOMESTIC"].includes(m)) : DEFAULT_ALERTS.markets,
    categories: Array.isArray(v.categories) ? v.categories.filter((c) => typeof c === "string") : [],
    remoteOnly: typeof v.remoteOnly === "boolean" ? v.remoteOnly : false,
    maxAgeHours: clamp(v.maxAgeHours, 1, 24 * 14, DEFAULT_ALERTS.maxAgeHours),
  };
}

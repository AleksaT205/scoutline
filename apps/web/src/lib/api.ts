import { authHeaders } from "./team";
import type { UiLead } from "../data/demo";
import { useEffect, useState } from "react";
import { useCached } from "./cache";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type ApiStatus =
  | { state: "checking" }
  | { state: "online"; latencyMs: number; checkedAt: Date }
  | { state: "offline"; checkedAt: Date };

/** Proverava API pri učitavanju i svakih 60 s. */
export function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>({ state: "checking" });

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const started = performance.now();
      try {
        const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
        if (!alive) return;
        setStatus(
          res.ok
            ? { state: "online", latencyMs: Math.round(performance.now() - started), checkedAt: new Date() }
            : { state: "offline", checkedAt: new Date() },
        );
      } catch {
        if (alive) setStatus({ state: "offline", checkedAt: new Date() });
      }
    };
    void check();
    const id = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return status;
}


export interface LeadsState {
  leads: UiLead[] | null; // null = još se učitava
  live: boolean; // true = pravi podaci iz API-ja
  newToday?: number;
  total?: number;
  aiCostUsd?: number;
  loadedAt?: number;
  /** Ponovo učitaj odmah. */
  reload: () => void;
  /** Doda lead odmah u listu (npr. posle ručnog dodavanja). */
  add: (lead: UiLead) => void;
  /** Zameni lead u listi (npr. posle promene statusa). */
  update: (lead: UiLead) => void;
}

export const LEADS_KEY = "/leads?limit=1000&includeHidden=1";
export const STATS_KEY = "/stats";

/** Leadovi + brojke iz keša (odmah prikaz), osvežava se svakog minuta dok je tab otvoren. */
export function useLeads(enabled = true): LeadsState {
  const l = useCached<{ items?: UiLead[] }>(enabled ? LEADS_KEY : null, { staleMs: 20_000, refreshMs: 60_000 });
  const s = useCached<{ newToday?: number; total?: number; aiCostUsd?: number }>(enabled ? STATS_KEY : null, { staleMs: 20_000, refreshMs: 60_000 });
  const leads = l.data ? (l.data.items ?? []) : l.error ? [] : null;
  return {
    leads,
    live: !!l.data,
    newToday: s.data?.newToday,
    total: s.data?.total,
    aiCostUsd: s.data?.aiCostUsd,
    loadedAt: l.loadedAt || undefined,
    reload: () => {
      void l.reload();
      void s.reload();
    },
    add: (lead) => l.setData((cur) => ({ ...cur, items: [lead, ...(cur?.items ?? []).filter((x) => x.id !== lead.id)] })),
    update: (lead) => l.setData((cur) => (cur ? { ...cur, items: (cur.items ?? []).map((x) => (x.id === lead.id ? lead : x)) } : cur)),
  };
}

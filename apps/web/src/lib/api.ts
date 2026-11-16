import type { UiLead } from "../data/demo";
import { useEffect, useState } from "react";

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
  /** Doda lead odmah u listu (npr. posle ručnog dodavanja). */
  add: (lead: UiLead) => void;
}

/** Učitava prave leadove; ako ih još nema (ili API nije dostupan), vraća live=false. */
export function useLeads(): LeadsState {
  const [state, setState] = useState<Omit<LeadsState, "add">>({ leads: null, live: false });
  const add = (lead: UiLead) =>
    setState((s) => ({ ...s, live: true, leads: [lead, ...(s.live && s.leads ? s.leads.filter((l) => l.id !== lead.id) : [])] }));
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [l, s] = await Promise.all([
          fetch(`${API_URL}/leads?limit=200`).then((r) => (r.ok ? r.json() : { items: [] })) as Promise<{ items?: UiLead[] }>,
          fetch(`${API_URL}/stats`).then((r) => (r.ok ? r.json() : {})) as Promise<{ newToday?: number }>,
        ]);
        if (!alive) return;
        const items = (l.items ?? []) as UiLead[];
        setState({ leads: items, live: items.length > 0, newToday: s.newToday });
      } catch {
        if (alive) setState({ leads: [], live: false });
      }
    };
    void load();
    const id = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return { ...state, add };
}

import { authHeaders } from "./team";
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

/** Učitava prave leadove; ako ih još nema (ili API nije dostupan), vraća live=false. */
export function useLeads(): LeadsState {
  const [state, setState] = useState<Omit<LeadsState, "add" | "reload" | "update">>({ leads: null, live: false });
  const [tick, setTick] = useState(0);
  const add = (lead: UiLead) =>
    setState((s) => ({ ...s, live: true, leads: [lead, ...(s.live && s.leads ? s.leads.filter((l) => l.id !== lead.id) : [])] }));
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [l, s] = await Promise.all([
          fetch(`${API_URL}/leads?limit=1000&includeHidden=1`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : { items: [] })) as Promise<{ items?: UiLead[] }>,
          fetch(`${API_URL}/stats`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : {})) as Promise<{ newToday?: number; total?: number; aiCostUsd?: number }>,
        ]);
        if (!alive) return;
        const items = (l.items ?? []) as UiLead[];
        // live = podaci su sa servera (i kad ih još nema) — probni podaci se više ne prikazuju
        setState({ leads: items, live: true, newToday: s.newToday, total: s.total, aiCostUsd: s.aiCostUsd, loadedAt: Date.now() });
      } catch {
        if (alive) setState((cur) => (cur.leads ? cur : { leads: [], live: false })); // greška mreže: zadrži poslednje učitane
      }
    };
    void load();
    const id = setInterval(load, 60_000); // dashboard se osvežava svakog minuta
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [tick]);
  const update = (lead: UiLead) => setState((s) => ({ ...s, leads: s.leads?.map((l) => (l.id === lead.id ? lead : l)) ?? null }));
  return { ...state, add, update, reload: () => setTick((t) => t + 1) };
}

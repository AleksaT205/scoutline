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

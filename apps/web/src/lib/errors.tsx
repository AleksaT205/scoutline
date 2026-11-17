import { Component, type ReactNode } from "react";
import { API_URL } from "./api";
import { getTeamToken } from "./team";

/**
 * Greške u pregledaču → server (Settings → System, nova greška stiže na Telegram).
 * Ista greška se u jednoj poseti šalje samo jednom; najviše 20 po poseti.
 */
const sent = new Set<string>();
export function reportError(err: unknown, where?: string) {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err ?? "Unknown error"));
  const message = `${where ? `${where}: ` : ""}${e.message || String(err)}`.slice(0, 1000);
  // Šum koji nije naša greška (proširenja pregledača, prekinute mreže, stari kod posle nove verzije)
  if (/ResizeObserver loop|Script error\.?$|extension:\/\/|Failed to fetch dynamically imported module|Importing a module script failed|Load failed$|NetworkError|AbortError/i.test(`${message} ${e.stack ?? ""}`)) return;
  if (sent.has(message) || sent.size >= 20) return;
  sent.add(message);
  let token = "";
  try {
    token = getTeamToken();
  } catch {
    /* bez prijave */
  }
  void fetch(`${API_URL}/errors`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ message, stack: e.stack?.slice(0, 8000), url: window.location.href.replace(/([?&](token|key|code)=)[^&#]+/gi, "$1…") }),
  }).catch(() => undefined);
}

export function installErrorReporting() {
  window.addEventListener("error", (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason));
}

/** Ako se neka stranica sruši: poruka i „Reload“ umesto bele stranice (greška se prijavi). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    reportError(error, "render");
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div>
          <div className="text-[15px] font-semibold">Something went wrong on this page.</div>
          <p className="mt-1 text-[13px] text-muted">It's been reported. Reloading usually fixes it.</p>
          <button onClick={() => window.location.reload()} className="mt-4 inline-flex h-[34px] items-center rounded-lg bg-fg px-3.5 text-[13px] font-medium text-bg hover:opacity-90">
            Reload
          </button>
        </div>
      </div>
    );
  }
}

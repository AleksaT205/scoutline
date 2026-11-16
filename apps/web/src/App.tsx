import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
type Health = "checking" | "ok" | "down";

const nav = ["Overview", "Leads", "Pipeline", "Sources", "Analytics"];

export function App() {
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => setHealth(r.ok ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr]">
      <aside className="sticky top-0 flex h-screen flex-col gap-5 border-r border-line px-3 py-4">
        <div className="flex items-center gap-2.5 px-2 font-semibold tracking-tight">
          <div className="grid size-[26px] place-items-center rounded-[7px] bg-gradient-to-br from-accent to-[#b4a9ff] text-xs text-white">◎</div>
          Scoutline
          <span className="ml-auto rounded border border-line px-1.5 text-[11px] font-normal text-faint">Beta</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <a
              key={item}
              href="#"
              className={`rounded-md px-2 py-[7px] text-[13.5px] ${
                item === "Leads" ? "bg-surface-2 text-fg ring-1 ring-line ring-inset" : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {item}
            </a>
          ))}
        </nav>
        <div className="mt-auto rounded-[10px] border border-line bg-surface p-3 text-xs text-muted">
          <div className="mb-1 flex items-center gap-2 font-medium text-fg">
            <span className={`size-[7px] rounded-full ${health === "ok" ? "bg-success" : health === "down" ? "bg-red-500" : "bg-faint"}`} />
            {health === "ok" ? "API online" : health === "down" ? "API offline" : "Checking API…"}
          </div>
          <span className="font-mono">{API_URL.replace(/^https?:\/\//, "")}</span>
        </div>
      </aside>

      <main className="px-6 py-7">
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="mt-0.5 text-[13.5px] text-muted">New opportunities, scored and filtered for your services.</p>

        <div className="mt-8 grid place-items-center rounded-xl border border-dashed border-line bg-surface px-6 py-20 text-center">
          <div className="text-sm font-medium">No leads yet</div>
          <p className="mt-1 max-w-sm text-[13px] text-muted">
            Sources start syncing in Phase 1. New opportunities will appear here, scored and ranked automatically.
          </p>
        </div>
      </main>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Play, Terminal as TerminalIcon, Trash2 } from "lucide-react";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";

/**
 * Terminal u Scoutline-u: komanda se izvršava u GitHub Actions (čista Linux mašina sa repoom i Node 20).
 * Bez interaktivnog unosa — za install, test, build, lint, ls… Izlaz stiže kad se komanda završi.
 */
interface Entry {
  id: string;
  command: string;
  ref: string;
  status: "starting" | "queued" | "running" | "done" | "error";
  ok?: boolean;
  seconds?: number;
  url?: string;
  output: string;
}
const QUICK = ["ls -la", "npm install && npm run build", "npm test", "npx --yes html-validate index.html", "git log --oneline -15"];
const key = (repo: string) => `scoutline-terminal:${repo}`;

export function TerminalView({ projectId, repo }: { projectId: string; repo: string }) {
  const user = useSessionUser();
  const [cmd, setCmd] = useState("");
  const [ref, setRef] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>(() => {
    try {
      return (JSON.parse(localStorage.getItem(key(repo)) ?? "[]") as Entry[]).slice(0, 15);
    } catch {
      return [];
    }
  });
  const [hist, setHist] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  const q = `repo=${encodeURIComponent(repo)}`;

  useEffect(() => {
    teamFetch<{ branches: Array<{ name: string; isDefault: boolean }> }>(`/delivery/projects/${projectId}/branches?${q}`)
      .then((d) => setBranches(d.branches.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((b) => b.name)))
      .catch(() => setBranches([]));
  }, [projectId, q]);
  useEffect(() => {
    try {
      localStorage.setItem(key(repo), JSON.stringify(entries.slice(0, 15)));
    } catch {
      /* ništa */
    }
  }, [entries, repo]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);

  // Praćenje komandi koje još rade
  const pending = entries.filter((e) => e.status === "queued" || e.status === "running" || e.status === "starting").map((e) => e.id).join(",");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      for (const id of pending.split(",")) {
        if (id.startsWith("tmp")) continue;
        try {
          const r = await teamFetch<{ status: Entry["status"]; ok?: boolean; seconds?: number; url?: string; output: string }>(`/delivery/projects/${projectId}/terminal/${id}?${q}`);
          setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...r } : e)));
        } catch (err) {
          setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, status: "error", output: (err as Error).message } : e)));
        }
      }
    }, 4000);
    return () => clearInterval(t);
  }, [pending, projectId, q]);

  const run = async (command: string) => {
    const c = command.trim();
    if (!c) return;
    const tmp = `tmp${Date.now()}`;
    setEntries((cur) => [{ id: tmp, command: c, ref: ref || "default", status: "starting" as const, output: "" }, ...cur].slice(0, 15));
    setCmd("");
    setHist(-1);
    try {
      const r = await teamFetch<{ id: string; ref: string }>(`/delivery/projects/${projectId}/terminal?${q}`, { method: "POST", body: JSON.stringify({ command: c, ref }) });
      setEntries((cur) => cur.map((e) => (e.id === tmp ? { ...e, id: r.id, ref: r.ref, status: "queued" } : e)));
    } catch (err) {
      setEntries((cur) => cur.map((e) => (e.id === tmp ? { ...e, status: "error", output: (err as Error).message } : e)));
    }
  };

  const ordered = [...entries].reverse();
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <TerminalIcon size={15} className="text-accent" />
        <span className="text-[13.5px] font-medium">Terminal</span>
        <span className="hidden text-[12px] text-faint sm:inline">runs on a clean Linux machine (GitHub Actions) with this repo and Node 20 · read-only, no secrets</span>
        {entries.length > 0 && (
          <button onClick={() => setEntries([])} className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted hover:text-danger" title="Clear history">
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      <div className="max-h-[520px] min-h-[200px] space-y-3 overflow-y-auto bg-[#0d0d10] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[#d7d7db]">
        {ordered.length === 0 && <div className="text-[#7c7c86]">Type a command below — e.g. <span className="text-[#c3b5ff]">npm install && npm run build</span>. Output appears when it finishes (usually 20–60 s).</div>}
        {ordered.map((e) => (
          <div key={e.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#8fd18f]">{e.ref}</span>
              <span className="text-[#7c7c86]">$</span>
              <span className="min-w-0 break-all text-white">{e.command}</span>
              <span className="ml-auto flex items-center gap-2 text-[11px] text-[#7c7c86]">
                {e.status === "done" ? (
                  <span className={e.ok ? "text-[#8fd18f]" : "text-[#ff8a8a]"}>
                    {e.ok ? "✓ done" : "✕ failed"}
                    {e.seconds != null ? ` · ${e.seconds}s` : ""}
                  </span>
                ) : e.status === "error" ? (
                  <span className="text-[#ff8a8a]">✕ error</span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin" /> {e.status === "running" ? "running…" : "starting a machine…"}
                  </span>
                )}
                {e.url && (
                  <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-white" aria-label="Open the run on GitHub">
                    <ExternalLink size={11} />
                  </a>
                )}
              </span>
            </div>
            {e.output && <pre className="mt-1 whitespace-pre-wrap break-words text-[#cfcfd6]">{e.output}</pre>}
          </div>
        ))}
        <div ref={end} />
      </div>
      {canEdit(user) && (
        <form
          className="space-y-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(cmd);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <select value={ref} onChange={(e) => setRef(e.target.value)} className="h-[36px] max-w-[200px] rounded-lg border border-line bg-bg px-2 font-mono text-[12.5px]" aria-label="Branch">
              <option value="">{branches[0] ? `${branches[0]} (default)` : "default branch"}</option>
              {branches.slice(1).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <label className="flex h-[36px] min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-3 font-mono focus-within:border-accent/60">
              <span className="text-faint">$</span>
              <input
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  // ↑ / ↓ kroz prethodne komande, kao u terminalu
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    const list = entries.map((x) => x.command);
                    if (!list.length) return;
                    e.preventDefault();
                    const next = e.key === "ArrowUp" ? Math.min(list.length - 1, hist + 1) : Math.max(-1, hist - 1);
                    setHist(next);
                    setCmd(next < 0 ? "" : list[next]!);
                  }
                }}
                placeholder="npm run build"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint"
                aria-label="Command"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button disabled={!cmd.trim()} className="inline-flex h-[36px] items-center gap-1.5 rounded-[7px] bg-fg px-3.5 text-[13px] font-medium text-bg disabled:opacity-40">
              <Play size={13} /> Run
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((x) => (
              <button key={x} type="button" onClick={() => void run(x)} className="rounded-full border border-line bg-bg px-2.5 py-1 font-mono text-[11.5px] text-muted hover:border-accent/50 hover:text-fg">
                {x}
              </button>
            ))}
          </div>
        </form>
      )}
    </section>
  );
}

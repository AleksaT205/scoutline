import { useEffect, useState } from "react";
import { ListPlus, Loader2 } from "lucide-react";
import { load } from "../../lib/cache";
import { teamFetch } from "../../lib/team";
import { Dialog, ErrorNote, btnPrimary, btnSecondary } from "./parts";

/**
 * Taskovi iz chata: iz Claude-ovog odgovora izvuče stavke liste (1. … / - … / - [ ] …),
 * korisnik ih štiklira i doteruje, pa idu na Board projekta.
 */
export function extractTasks(text: string): string[] {
  const clean = (s: string) =>
    s
      .replace(/\*\*|__|`/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s*(\[[ xX✓]\]|[✓○])\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:\d+[.)]|[-*•]|[✓○])\s+(.+)$/.exec(line);
    if (!m) continue;
    if (/^\s*(✓|○|[-*•]\s*\[[xX]\])/.test(line)) continue; // već urađeno (Claude-ova lista koraka) — nije task
    const t = clean(m[1]!);
    if (t.length < 4 || /:$/.test(t) || /^(pr|pull request)\b/i.test(t)) continue;
    if (!items.includes(t)) items.push(t.length > 140 ? `${t.slice(0, 137)}…` : t);
  }
  return items.slice(0, 20);
}

export function CreateTasksButton({ projectId, text, className }: { projectId: string; text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? "inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-fg"} title="Turn the suggestions in this answer into tasks on the board">
        <ListPlus size={12} /> Create tasks
      </button>
      {open && <CreateTasksDialog projectId={projectId} text={text} onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateTasksDialog({ projectId, text, onClose }: { projectId: string; text: string; onClose: () => void }) {
  const [rows, setRows] = useState<Array<{ title: string; on: boolean }>>([]);
  const [status, setStatus] = useState<"todo" | "backlog">("todo");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  useEffect(() => {
    const found = extractTasks(text);
    setRows((found.length ? found : [text.split(/[.\n]/)[0]!.slice(0, 120)]).map((t) => ({ title: t, on: true })));
  }, [text]);
  const chosen = rows.filter((r) => r.on && r.title.trim());

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      for (const r of chosen) await teamFetch("/delivery/issues", { method: "POST", body: JSON.stringify({ projectId, title: r.title.trim(), status, description: "Created from a Claude conversation in Scoutline." }) });
      void load(`/delivery/issues?projectId=${projectId}`).catch(() => undefined);
      setDone(chosen.length);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Create tasks from this answer" width={620}>
      <div className="space-y-3 px-4 py-4">
        {done !== null ? (
          <div className="rounded-lg border border-success/40 bg-success-soft px-3 py-2.5 text-[13px] text-success">
            {done} task{done === 1 ? "" : "s"} added to the board ({status === "todo" ? "Todo" : "Backlog"}).
          </div>
        ) : (
          <>
            <p className="text-[12.5px] text-muted">Found {rows.length} item{rows.length === 1 ? "" : "s"}. Untick what you don't need and edit titles before adding.</p>
            <ul className="max-h-[360px] space-y-1.5 overflow-y-auto">
              {rows.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} className="accent-[var(--accent)]" aria-label={`Include ${r.title}`} />
                  <input
                    value={r.title}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    className={`h-[32px] min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent/60 ${r.on ? "" : "text-faint line-through"}`}
                  />
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setRows([...rows, { title: "", on: true }])} className="text-[12px] text-muted hover:text-fg">
              + Add another
            </button>
            {err && <ErrorNote>{err}</ErrorNote>}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
        {done === null && (
          <select value={status} onChange={(e) => setStatus(e.target.value as "todo" | "backlog")} className="mr-auto h-[32px] rounded-md border border-line bg-surface px-2 text-[12.5px]" aria-label="Column">
            <option value="todo">Add to Todo</option>
            <option value="backlog">Add to Backlog</option>
          </select>
        )}
        <button type="button" onClick={onClose} className={btnSecondary}>
          {done !== null ? "Close" : "Cancel"}
        </button>
        {done === null && (
          <button type="button" onClick={() => void create()} disabled={busy || !chosen.length} className={btnPrimary}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />} Create {chosen.length} task{chosen.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </Dialog>
  );
}

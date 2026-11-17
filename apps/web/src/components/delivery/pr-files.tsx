import { useState } from "react";
import { ChevronRight, FileCode2, Loader2 } from "lucide-react";
import { teamFetch } from "../../lib/team";

/** Izmene u PR-u u aplikaciji: lista fajlova (+/−) i diff u boji, bez odlaska na GitHub. */
interface PrFile {
  name: string;
  previous: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  tooBig: boolean;
}

function Patch({ text }: { text: string }) {
  return (
    <pre className="num overflow-x-auto border-t border-line bg-bg py-1 text-[11.5px] leading-[1.55]">
      {text.split("\n").map((l, i) => (
        <div
          key={i}
          className={`whitespace-pre px-3 ${l.startsWith("+") ? "bg-success/10 text-success" : l.startsWith("-") ? "bg-danger/10 text-danger" : l.startsWith("@@") ? "bg-accent-soft/60 text-accent" : "text-muted"}`}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

export function PrFiles({ projectId, repo, number, className = "" }: { projectId: string; repo: string; number: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ files: PrFile[]; additions: number; deletions: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !data) {
      try {
        const d = await teamFetch<{ files: PrFile[]; additions: number; deletions: number }>(`/delivery/projects/${projectId}/pulls/${number}/files?repo=${encodeURIComponent(repo)}`);
        setData(d);
        // Mali PR: odmah otvori sve fajlove
        if (d.files.length <= 3) setShown(new Set(d.files.map((f) => f.name)));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };
  return (
    <div className={className}>
      <button type="button" onClick={() => void toggle()} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        Files changed
        {data && (
          <span className="num ml-1">
            {data.files.length} · <span className="text-success">+{data.additions}</span> <span className="text-danger">−{data.deletions}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-line bg-surface">
          {!data && !error && (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-faint">
              <Loader2 size={13} className="animate-spin" /> Loading changes…
            </div>
          )}
          {error && <div className="px-3 py-3 text-[12px] text-danger">{error}</div>}
          {data?.files.map((f) => {
            const on = shown.has(f.name);
            return (
              <div key={f.name} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => setShown((s) => (s.has(f.name) ? new Set([...s].filter((x) => x !== f.name)) : new Set([...s, f.name])))}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-surface-2"
                >
                  <ChevronRight size={12} className={`shrink-0 text-faint transition-transform ${on ? "rotate-90" : ""}`} />
                  <FileCode2 size={13} className="shrink-0 text-faint" />
                  <span className="num min-w-0 flex-1 truncate" title={f.previous ? `${f.previous} → ${f.name}` : f.name}>
                    {f.name}
                  </span>
                  {f.status !== "modified" && <span className="rounded bg-surface-2 px-1.5 text-[10.5px] text-muted">{f.status}</span>}
                  <span className="num shrink-0 text-[11.5px]">
                    <span className="text-success">+{f.additions}</span> <span className="text-danger">−{f.deletions}</span>
                  </span>
                </button>
                {on && (f.patch ? <Patch text={f.patch} /> : <div className="border-t border-line px-3 py-2 text-[12px] text-faint">{f.tooBig ? "Too big to show here — open it on GitHub." : "No text changes (binary or renamed file)."}</div>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

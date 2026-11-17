import { useState } from "react";
import { ArrowRight, Check, ChevronDown, CircleAlert, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useCached } from "../lib/cache";
import { teamFetch } from "../lib/team";
import { btnSm } from "../lib/ui";

/** Settings → Setup (vlasnik): šta je podešeno, šta fali i kako da se podesi — jedna lista za celu aplikaciju. */
interface Item {
  key: string;
  group: string;
  title: string;
  state: "ok" | "warn" | "missing";
  detail: string;
  steps: string[];
  link?: string;
  required: boolean;
}
const ICON = {
  ok: <Check size={12} strokeWidth={3} />,
  warn: <TriangleAlert size={11} />,
  missing: <CircleAlert size={12} />,
};
const TONE = { ok: "bg-success-soft text-success", warn: "bg-warning/15 text-warning", missing: "bg-danger/10 text-danger" };
/** `tekst` u koracima → kod. */
const Step = ({ text }: { text: string }) => (
  <>
    {text.split(/(`[^`]+`)/).map((p, i) =>
      p.startsWith("`") ? (
        <code key={i} className="num rounded bg-surface-2 px-1 py-px text-[11.5px] text-fg">
          {p.slice(1, -1)}
        </code>
      ) : (
        <span key={i}>{p}</span>
      ),
    )}
  </>
);

export function SetupSettings() {
  const q = useCached<{ items: Item[]; done: number; total: number }>("/system/setup", { staleMs: 5_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false });
  const d = q.data;
  const groups = d ? [...new Set(d.items.map((i) => i.group))] : [];
  const pct = d ? Math.round((d.done / Math.max(1, d.total)) * 100) : 0;
  const testAi = async () => {
    setAi({ busy: true });
    try {
      const r = await teamFetch<{ ok: boolean; model?: string; error?: string }>("/system/setup/test-ai", { method: "POST", body: "{}" });
      setAi({ busy: false, ok: r.ok, text: r.ok ? `Works — answered by ${r.model}` : (r.error ?? "No answer") });
    } catch (e) {
      setAi({ busy: false, ok: false, text: (e as Error).message });
    }
  };
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Setup</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">Everything Scoutline needs to work fully. Nothing here changes settings — it only checks them and tells you where each one goes.</p>
          </div>
          <button onClick={() => void q.reload()} className={btnSm} disabled={q.refreshing}>
            <RefreshCw size={12} className={q.refreshing ? "animate-spin" : ""} /> Check again
          </button>
        </div>
        {d && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
              <span className="font-medium">
                {d.done === d.total ? "All required items are ready" : `${d.done} of ${d.total} required items ready`}
              </span>
              <span className="num text-faint">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full rounded-full ${d.done === d.total ? "bg-success" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {q.error && <p className="mt-3 text-[12.5px] text-danger">{q.error}</p>}
        {!d && !q.error && <div className="mt-4 h-24 animate-pulse rounded-lg bg-surface-2" />}
      </section>

      {groups.map((g) => (
        <section key={g} className="rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5 text-[11.5px] font-medium uppercase tracking-wider text-faint">{g}</div>
          <ul className="divide-y divide-line">
            {d!.items
              .filter((i) => i.group === g)
              .map((i) => {
                const expanded = open === i.key;
                const hasMore = i.steps.length > 0 || i.key === "ai";
                return (
                  <li key={i.key} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 grid size-[20px] shrink-0 place-items-center rounded-full ${TONE[i.state]}`} aria-label={i.state === "ok" ? "Ready" : i.state === "warn" ? "Needs attention" : "Missing"}>
                        {ICON[i.state]}
                      </span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => hasMore && setOpen(expanded ? null : i.key)} aria-expanded={expanded}>
                        <div className="flex flex-wrap items-center gap-x-2 text-[13.5px] font-medium">
                          {i.title}
                          {!i.required && <span className="rounded bg-surface-2 px-1.5 text-[10.5px] font-normal text-faint">optional</span>}
                        </div>
                        <div className="mt-0.5 break-words text-[12.5px] text-muted">{i.detail}</div>
                      </button>
                      {i.link && (
                        <a href={i.link} className={`${btnSm} hidden sm:inline-flex`}>
                          Open <ArrowRight size={12} />
                        </a>
                      )}
                      {hasMore && (
                        <button onClick={() => setOpen(expanded ? null : i.key)} className="mt-0.5 text-faint hover:text-fg" aria-label={expanded ? "Hide steps" : "Show steps"}>
                          <ChevronDown size={15} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div className="mt-2.5 space-y-2 pl-8">
                        {i.steps.length > 0 && (
                          <ol className="list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-muted">
                            {i.steps.map((s, k) => (
                              <li key={k}>
                                <Step text={s} />
                              </li>
                            ))}
                          </ol>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {i.key === "ai" && (
                            <button onClick={() => void testAi()} disabled={ai.busy} className="inline-flex h-[28px] items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-[12px] font-medium text-accent hover:opacity-90 disabled:opacity-60">
                              {ai.busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Test AI
                            </button>
                          )}
                          {i.key === "ai" && ai.text && <span className={`text-[12px] ${ai.ok ? "text-success" : "text-danger"}`}>{ai.text}</span>}
                          {i.link && (
                            <a href={i.link} className={`${btnSm} sm:hidden`}>
                              Open <ArrowRight size={12} />
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

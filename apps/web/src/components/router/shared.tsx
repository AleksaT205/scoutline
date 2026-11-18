import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Zajednički delovi AI Router stranice. */

export type Group = "fast" | "smart" | "local";
export const GROUP_TONE: Record<string, string> = {
  fast: "bg-success-soft text-success",
  smart: "bg-accent-soft text-accent",
  local: "bg-warning/15 text-warning",
};
export function GroupTag({ g }: { g: string | null }) {
  if (!g) return <span className="rounded bg-danger/10 px-1.5 py-px font-mono text-[11px] text-danger">blocked</span>;
  return <span className={`rounded px-1.5 py-px font-mono text-[11px] ${GROUP_TONE[g] ?? "bg-surface-2 text-muted"}`}>{g}</span>;
}

export const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 10_000 ? `${(v / 1000).toFixed(0)} s` : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
export const pctText = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg"
    >
      {done ? <Check size={12} className="text-success" /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}

/** Prekidač (da/ne) sa opisom. */
export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[18px] w-[32px] shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
      >
        <span className={`absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-all ${checked ? "left-[16px]" : "left-[2px]"}`} />
      </button>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[12px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{text}</div>;
}

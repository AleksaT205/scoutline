import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Potvrda u samoj aplikaciji (umesto prozorčića pregledača „localhost says…“).
 * `await askConfirm("Delete X? This can't be undone.")` → true/false. Naslov je prva rečenica, ostalo je objašnjenje;
 * dugme i boja se biraju po radnji (Delete/Remove/Revoke → crveno).
 */
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let show: ((p: Pending) => void) | null = null;

const fromText = (text: string): ConfirmOptions => {
  const i = text.search(/\?(\s|$)/);
  const title = (i >= 0 ? text.slice(0, i + 1) : text).trim();
  const message = (i >= 0 ? text.slice(i + 1) : "").trim() || undefined;
  const verb = /^\s*(delete|remove|revoke|unlink|merge|deploy|set|clear|disconnect)\b/i.exec(title)?.[1]?.toLowerCase();
  const danger = !!verb && ["delete", "remove", "revoke", "unlink", "clear", "disconnect"].includes(verb);
  return { title, message, danger, confirmLabel: verb ? verb[0]!.toUpperCase() + verb.slice(1) : "Confirm" };
};

export function askConfirm(opts: string | ConfirmOptions): Promise<boolean> {
  const o = typeof opts === "string" ? fromText(opts) : opts;
  // Bez otvorenog prikaza (npr. javne stranice) — rezervno, pregledačev prozor
  if (!show) return Promise.resolve(window.confirm([o.title, o.message].filter(Boolean).join("\n\n")));
  return new Promise((resolve) => show!({ ...o, resolve }));
}

/** Postavlja se jednom (u aplikaciji); prikazuje potvrde. */
export function ConfirmHost() {
  const [p, setP] = useState<Pending | null>(null);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    show = (x) => setP(x);
    return () => {
      show = null;
    };
  }, []);
  useEffect(() => {
    if (!p) return;
    ok.current?.focus();
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Samo modal — da se ne zatvori i panel ispod njega
        e.preventDefault();
        e.stopImmediatePropagation();
        close(false);
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);
  const close = (v: boolean) => {
    p?.resolve(v);
    setP(null);
  };
  if (!p) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]" onMouseDown={() => close(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-[420px] rounded-2xl border border-line bg-surface p-5 shadow-float">
        <div className="flex items-start gap-3">
          {p.danger && (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
              <AlertTriangle size={17} />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-[16px] font-semibold leading-snug">
              {p.title}
            </h2>
            {p.message && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-muted">{p.message}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => close(false)} className="inline-flex h-[34px] items-center rounded-lg border border-line bg-surface px-3.5 text-[13px] font-medium hover:bg-surface-2">
            Cancel
          </button>
          <button
            ref={ok}
            type="button"
            onClick={() => close(true)}
            className={`inline-flex h-[34px] items-center rounded-lg px-3.5 text-[13px] font-medium ${p.danger ? "bg-danger text-white hover:opacity-90" : "bg-fg text-bg hover:opacity-90"}`}
          >
            {p.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

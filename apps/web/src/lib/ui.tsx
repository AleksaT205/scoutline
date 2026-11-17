import type { ReactNode } from "react";

/**
 * Zajednički izgled kontrola — jedno mesto za sve stranice.
 * Dve veličine: md = 34px (glavna dugmad, polja, padajući meniji), sm = 28px (dugmad u redovima, čipovi, tabovi).
 * Zaobljenje: md → rounded-lg, sm → rounded-md. Boje samo iz tokena (index.css).
 */
export const btnPrimary = "inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-fg px-3.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40";
export const btnSecondary = "inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50";
export const btnGhost = "inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50";
export const btnDanger = "inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-danger px-3.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40";
export const btnSm = "inline-flex h-[28px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50";
export const btnSmPrimary = "inline-flex h-[28px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-fg px-2.5 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-40";
/** Dugme samo sa ikonicom (34×34). */
export const btnIcon = "inline-grid size-[34px] shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50";

/** Polje bez visine (za textarea); `input` je polje od 34px. */
export const field = "w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60 disabled:opacity-60";
export const input = `h-[34px] ${field}`;
export const select = "h-[34px] rounded-lg border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent/60 disabled:opacity-60";

/** Prekidač (tabovi u okviru): okvir + dugme po stanju. */
export const segWrap = "inline-flex rounded-lg border border-line bg-surface p-0.5";
export const segItem = (on: boolean) => `inline-flex h-[28px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12.5px] ${on ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`;

export function Segmented<T extends string>({ value, onChange, options, full, className = "" }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, ReactNode]>; full?: boolean; className?: string }) {
  return (
    <div className={`${full ? "flex w-full sm:inline-flex sm:w-auto" : "inline-flex"} rounded-lg border border-line bg-surface p-0.5 ${className}`}>
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`${segItem(value === v)} ${full ? "flex-1 sm:flex-none" : ""}`} aria-pressed={value === v}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Kartica sa naslovom (opciono: podnaslov i radnje desno). */
export function Card({ title, sub, actions, children, className = "" }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[14px] font-semibold">{title}</h2>}
            {sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Prazno stanje: ikonica, šta je ovo i jedan sledeći korak. */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-2 text-faint">{icon}</div>}
      <div className="text-[13.5px] font-medium">{title}</div>
      {text && <p className="mt-1 max-w-md text-[12.5px] text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const TONES = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/10 text-danger",
} as const;
/** Oznaka stanja (pilula). */
export function Badge({ tone = "neutral", children, className = "" }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-medium ${TONES[tone]} ${className}`}>{children}</span>;
}

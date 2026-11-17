import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/**
 * Zajednički izgled kontrola — jedno mesto za sve stranice.
 * Dve veličine: md = 34px (glavna dugmad, polja, padajući meniji), sm = 28px (dugmad u redovima, čipovi, tabovi).
 * Zaobljenje: md → rounded-lg, sm → rounded-md. Boje samo iz tokena (index.css).
 *
 * Veličine slova (samo ove): 11 oznake i brojači · 12 sporedni tekst i kontrole od 28px · 13 osnovni tekst i kontrole od 34px ·
 * 14 naslovi kartica, opis stranice i duži tekst · 16 naslovi dijaloga · 20 / 24 / 28 naslovi i velike brojke.
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
export const field = "w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-faint focus:border-accent/60 disabled:opacity-60";
export const input = `h-[34px] ${field}`;
export const select = "h-[34px] rounded-lg border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent/60 disabled:opacity-60";

/** Prekidač (tabovi u okviru): okvir + dugme po stanju. */
export const segWrap = "inline-flex rounded-lg border border-line bg-surface p-0.5";
export const segItem = (on: boolean) => `inline-flex h-[28px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12px] ${on ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`;

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
            {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
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
      <div className="text-[14px] font-medium">{title}</div>
      {text && <p className="mt-1 max-w-md text-[13px] text-muted">{text}</p>}
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

// ── Padajuća lista ───────────────────────────────────────────────────────────
interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  group?: string;
}
/** Čita <option> (i <optgroup>) iz dece, pa se piše isto kao običan <select>. */
function readOptions(children: ReactNode, out: SelectOption[] = [], group?: string): SelectOption[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>;
    if (el.type === "option") out.push({ value: String(el.props.value ?? (typeof el.props.children === "string" ? el.props.children : "")), label: el.props.children, disabled: el.props.disabled, group });
    else if (el.type === "optgroup") readOptions(el.props.children, out, el.props.label);
    else if (el.type === Fragment) readOptions(el.props.children, out, group);
  });
  return out;
}
interface SelectProps {
  value: string | number;
  /** Isti oblik kao kod <select>: čita se e.target.value. */
  onChange(e: { target: { value: string } }): void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
}
/**
 * Padajuća lista u stilu aplikacije — zamena za sistemski <select> (ista upotreba: value, onChange, <option>).
 * Lista se crta preko svega (portal), pa je ne seku tabele, kartice ni dijalozi; tastatura: strelice, Enter, Esc.
 */
export function Select({ value, onChange, children, className = "", disabled, title, "aria-label": ariaLabel }: SelectProps) {
  const options = readOptions(children);
  const current = options.findIndex((o) => o.value === String(value));
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; minWidth: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return; // sakriveno dugme nema gde da otvori listu
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below; // malo mesta ispod → otvori nagore
    setPos({ left: r.left, minWidth: r.width, maxHeight: Math.max(120, Math.min(320, up ? above : below)), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    setHi(Math.max(0, current));
    setOpen(true);
  };
  const pick = (o: SelectOption) => {
    if (o.disabled) return;
    setOpen(false);
    if (o.value !== String(value)) onChange({ target: { value: o.value } });
    btn.current?.focus();
  };
  const move = (dir: 1 | -1) => {
    for (let i = hi + dir; i >= 0 && i < options.length; i += dir) if (!options[i]!.disabled) return setHi(i);
  };

  // Ne dozvoli da lista izađe van desne ivice ekrana
  useLayoutEffect(() => {
    if (!open || !pop.current || !pos) return;
    const w = pop.current.offsetWidth;
    const left = Math.max(8, Math.min(pos.left, window.innerWidth - 8 - w));
    if (left !== pos.left) setPos({ ...pos, left });
    pop.current.querySelector<HTMLElement>("[data-hi=true]")?.scrollIntoView({ block: "nearest" });
  }, [open, pos, hi]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    const scroll = (e: Event) => !pop.current?.contains(e.target as Node) && close();
    document.addEventListener("pointerdown", down);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("hashchange", close);
    return () => {
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("hashchange", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") (e.preventDefault(), show());
            return;
          }
          if (e.key === "ArrowDown") (e.preventDefault(), move(1));
          else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
          else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), options[hi] && pick(options[hi]!));
          else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), setOpen(false));
          else if (e.key === "Tab") setOpen(false);
        }}
        className={`inline-flex cursor-pointer items-center justify-between gap-1.5 text-left outline-none focus-visible:border-accent/60 disabled:cursor-default disabled:opacity-60 ${className}`}
      >
        <span className="min-w-0 truncate">{options[current]?.label ?? "\u00a0"}</span>
        <ChevronDown size={13} className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            role="listbox"
            aria-label={ariaLabel}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth, maxHeight: pos.maxHeight, maxWidth: "min(360px, calc(100vw - 16px))" }}
            className="fixed z-[100] overflow-y-auto rounded-xl border border-line bg-surface p-1 font-sans text-fg shadow-float"
          >
            {options.map((o, i) => (
              <Fragment key={`${o.value}:${i}`}>
                {o.group && o.group !== options[i - 1]?.group && <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{o.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === current}
                  data-hi={i === hi}
                  disabled={o.disabled}
                  tabIndex={-1}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(o)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] disabled:opacity-40 ${i === hi ? "bg-surface-2 text-fg" : "text-muted"}`}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {i === current && <Check size={13} strokeWidth={2.5} className="shrink-0 text-accent" />}
                </button>
              </Fragment>
            ))}
            {options.length === 0 && <div className="px-2 py-1.5 text-[12px] text-faint">Nothing to choose</div>}
          </div>,
          document.body,
        )}
    </>
  );
}

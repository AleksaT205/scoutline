import { useEffect, useState } from "react";
import { Activity, Check, Copy, FileText, Loader2, Plus, Printer, Receipt, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useCached } from "../../lib/cache";
import { teamFetch } from "../../lib/team";
import { askConfirm } from "../../lib/confirm";
import { canEdit, useSessionUser } from "../../lib/session";
import { Badge, Segmented, btnPrimary, btnSecondary, btnSm, field, input, Select } from "../../lib/ui";
import { Md } from "./assistant";

/** Projekat → Overview: dokumentacija, release notes, zdravlje sajta i fakture. */
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const eur = (n: number) => `€${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
function Section({ icon, title, sub, actions, children }: { icon: React.ReactNode; title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start gap-2">
        <span className="mt-0.5 text-accent">{icon}</span>
        {/* min-w: kad pored teksta nema mesta za radnje, radnje prelaze u novi red (tekst se ne lomi reč po reč) */}
        <div className="min-w-[190px] flex-1">
          <h3 className="text-[14px] font-semibold">{title}</h3>
          {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ── Dokumentacija ──
interface Doc {
  id: string;
  title: string;
  body: string;
  shareWithAi: boolean;
  updatedAt: string;
  updatedBy: string | null;
}
export function DocsCard({ projectId }: { projectId: string }) {
  const user = useSessionUser();
  const docs = useCached<{ docs: Doc[] }>(`/delivery/projects/${projectId}/docs`, { staleMs: 15_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const list = docs.data?.docs ?? [];
  const cur = list.find((d) => d.id === open) ?? null;
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      if (edit.id) await teamFetch(`/delivery/docs/${edit.id}`, { method: "PATCH", body: JSON.stringify({ title: edit.title, body: edit.body, shareWithAi: edit.shareWithAi }) });
      else {
        const r = await teamFetch<{ doc: Doc }>(`/delivery/projects/${projectId}/docs`, { method: "POST", body: JSON.stringify({ title: edit.title, body: edit.body, shareWithAi: edit.shareWithAi }) });
        setOpen(r.doc.id);
      }
      setEdit(null);
      await docs.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      icon={<FileText size={15} />}
      title="Docs"
      sub="How to run it, decisions, contacts. Pages marked “AI” are given to Claude when it works on this project. Don't store passwords here."
      actions={
        canEdit(user) && !edit ? (
          <button onClick={() => setEdit({ id: "", title: "", body: "", shareWithAi: true, updatedAt: "", updatedBy: null })} className={btnSm}>
            <Plus size={12} /> New page
          </button>
        ) : null
      }
    >
      {edit ? (
        <div className="space-y-2">
          <input className={input} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Page title, e.g. “How to run locally”" autoFocus />
          <textarea className={`${field} min-h-[220px] py-2 font-mono text-[13px]`} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder={"Markdown — e.g.\n## Setup\n1. pnpm install\n2. pnpm dev"} />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              <input type="checkbox" checked={edit.shareWithAi} onChange={(e) => setEdit({ ...edit, shareWithAi: e.target.checked })} className="accent-[var(--accent)]" /> Give to Claude as context
            </label>
            <span className="ml-auto" />
            <button onClick={() => setEdit(null)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={() => void save()} disabled={busy || !edit.title.trim()} className={btnPrimary}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
          </div>
        </div>
      ) : list.length === 0 ? (
        <p className="text-[13px] text-faint">{docs.data ? "No pages yet." : "Loading…"}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
          <ul className="flex gap-1 overflow-x-auto md:block md:space-y-0.5">
            {list.map((d) => (
              <li key={d.id} className="shrink-0">
                <button onClick={() => setOpen(d.id)} className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] ${(cur?.id ?? list[0]!.id) === d.id ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}>
                  <span className="truncate">{d.title}</span>
                  {d.shareWithAi && <span className="ml-auto rounded bg-accent-soft px-1 text-[11px] text-accent">AI</span>}
                </button>
              </li>
            ))}
          </ul>
          {(() => {
            const d = cur ?? list[0]!;
            return (
              <article className="min-w-0 rounded-lg border border-line bg-bg p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h4 className="text-[14px] font-semibold">{d.title}</h4>
                  <span className="text-[12px] text-faint">
                    {d.updatedBy ?? "—"} · {ago(d.updatedAt)}
                  </span>
                  {canEdit(user) && (
                    <span className="ml-auto flex gap-1.5">
                      <button onClick={() => setEdit(d)} className={btnSm}>
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          if (!(await askConfirm(`Delete “${d.title}”? This can't be undone.`))) return;
                          await teamFetch(`/delivery/docs/${d.id}`, { method: "DELETE" });
                          setOpen(null);
                          await docs.reload();
                        }}
                        className={`${btnSm} hover:text-danger`}
                        aria-label="Delete page"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  )}
                </div>
                <div className="text-[13px] text-muted">{d.body ? <Md text={d.body} /> : <span className="text-faint">Empty page.</span>}</div>
              </article>
            );
          })()}
        </div>
      )}
    </Section>
  );
}

// ── Release notes ──
export function ReleaseNotesCard({ projectId }: { projectId: string }) {
  const user = useSessionUser();
  const [days, setDays] = useState<"7" | "14" | "30">("14");
  const [lang, setLang] = useState<"en" | "sr">("en");
  const data = useCached<{ tasks: Array<{ key: string; title: string }>; prs: Array<{ number: number; title: string; url: string }> }>(`/delivery/projects/${projectId}/release-notes?days=${days}`, { staleMs: 60_000 });
  const [polished, setPolished] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setPolished(null), [days]);
  const plain = [...(data.data?.tasks ?? []).map((t) => `- ${t.title}`), ...(data.data?.prs ?? []).map((p) => `- ${p.title.replace(/^\[[^\]]+\]\s*/, "")}`)].join("\n");
  const empty = data.data && !data.data.tasks.length && !data.data.prs.length;
  return (
    <Section
      icon={<Sparkles size={15} />}
      title="Release notes"
      sub="What got done — from merged pull requests and finished tasks. Polish it into client language and copy it into an email or the status update."
      actions={<Segmented value={days} onChange={setDays} options={[["7", "7 days"], ["14", "14 days"], ["30", "30 days"]]} />}
    >
      {!data.data ? (
        <div className="h-16 animate-pulse rounded-lg bg-surface-2" />
      ) : empty ? (
        <p className="text-[13px] text-faint">Nothing merged or finished in this period.</p>
      ) : (
        <>
          <div className={`rounded-lg border border-line bg-bg p-3 text-[13px] text-muted ${busy ? "opacity-50" : ""}`}>{polished ? <Md text={polished} /> : <Md text={plain} />}</div>
          {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {canEdit(user) && (
              <>
                <Segmented value={lang} onChange={setLang} options={[["en", "EN"], ["sr", "SR"]]} />
                <button
                  onClick={async () => {
                    setBusy(true);
                    setErr(null);
                    try {
                      const r = await teamFetch<{ text: string }>(`/delivery/projects/${projectId}/release-notes/polish`, { method: "POST", body: JSON.stringify({ days: Number(days), lang }) });
                      setPolished(r.text);
                    } catch (e) {
                      setErr((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  className="inline-flex h-[28px] items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-[12px] font-medium text-accent hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Polish with AI
                </button>
              </>
            )}
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(polished ?? plain);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className={`${btnSm} ml-auto`}
            >
              {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

// ── Zdravlje sajta ──
interface Health {
  url: string | null;
  last: { ok: boolean; status: number | null; ms: number | null; error: string | null; at: string } | null;
  uptime: number | null;
  avgMs: number | null;
  recent: Array<{ ok: boolean; at: string; ms: number | null }>;
}
export function SiteHealthCard({ projectId, onEdit }: { projectId: string; onEdit: () => void }) {
  const user = useSessionUser();
  const h = useCached<Health>(`/delivery/projects/${projectId}/health`, { staleMs: 30_000, refreshMs: 120_000 });
  const [busy, setBusy] = useState(false);
  const d = h.data;
  return (
    <Section
      icon={<Activity size={15} />}
      title="Site health"
      sub="Checked every 5 min · Telegram when it goes down or back up."
      actions={
        d?.url && canEdit(user) ? (
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await teamFetch(`/delivery/projects/${projectId}/health/check`, { method: "POST", body: "{}" });
                await h.reload();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className={btnSm}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check now
          </button>
        ) : null
      }
    >
      {!d ? (
        <div className="h-12 animate-pulse rounded-lg bg-surface-2" />
      ) : !d.url ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-faint">
          No site address yet.
          {canEdit(user) && (
            <button onClick={onEdit} className="text-accent hover:underline">
              Add it in Edit project
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
            <a href={d.url} target="_blank" rel="noreferrer" className="num truncate text-muted hover:text-fg">
              {d.url.replace(/^https?:\/\//, "")}
            </a>
            {d.last ? <Badge tone={d.last.ok ? "success" : "danger"}>{d.last.ok ? "Up" : "Down"}</Badge> : <Badge>Waiting for the first check</Badge>}
            {d.last?.ok && d.last.ms !== null && <span className="num text-muted">{d.last.ms} ms</span>}
            {d.uptime !== null && <span className="text-muted">Uptime 7 days: <b className="num text-fg">{d.uptime}%</b></span>}
            {d.last && <span className="text-[12px] text-faint">checked {ago(d.last.at)}</span>}
          </div>
          {d.last && !d.last.ok && d.last.error && <p className="mt-1.5 text-[12px] text-danger">{d.last.error}</p>}
          {d.recent.length > 1 && (
            <div className="mt-3 flex h-6 items-end gap-[2px]" aria-label="Last checks">
              {d.recent.map((r, i) => (
                <span key={i} title={`${new Date(r.at).toLocaleString("en-GB")} · ${r.ok ? `${r.ms ?? "?"} ms` : "down"}`} className={`flex-1 rounded-sm ${r.ok ? "bg-success/60" : "bg-danger"}`} style={{ height: r.ok ? `${Math.max(30, Math.min(100, 100 - (r.ms ?? 0) / 30))}%` : "100%" }} />
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ── Fakture (vlasnik) ──
interface Line {
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
}
interface Invoice {
  id: string;
  number: string;
  issuedAt: string;
  dueAt: string;
  totalEur: number;
  status: "draft" | "sent" | "paid";
  items: Line[];
  notes: string | null;
}
export function InvoicesCard({ projectId }: { projectId: string }) {
  const q = useCached<{ invoices: Invoice[] }>(`/delivery/projects/${projectId}/invoices`, { staleMs: 15_000 });
  const [draft, setDraft] = useState<{ items: Line[]; notes: string; dueDays: number; from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);
  const startDraft = async () => {
    setErr(null);
    const d = await teamFetch<{ items: Line[]; from: string; to: string }>(`/delivery/projects/${projectId}/invoice-draft`);
    setDraft({ items: d.items.length ? d.items : [{ description: "", qty: 1, unit: "pcs", unitPrice: 0 }], notes: "", dueDays: 15, from: d.from, to: d.to });
  };
  const total = (items: Line[]) => items.reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.unitPrice) || 0), 0);
  const create = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      const issuedAt = new Date();
      const r = await teamFetch<{ invoice: Invoice }>(`/delivery/projects/${projectId}/invoices`, {
        method: "POST",
        body: JSON.stringify({ items: draft.items, notes: draft.notes, issuedAt, dueAt: new Date(issuedAt.getTime() + draft.dueDays * 86_400_000), periodFrom: draft.from, periodTo: draft.to }),
      });
      setDraft(null);
      await q.reload();
      setPrintId(r.invoice.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setLine = (i: number, k: keyof Line, v: string) => setDraft((d) => (d ? { ...d, items: d.items.map((x, j) => (j === i ? { ...x, [k]: k === "qty" || k === "unitPrice" ? Number(v.replace(",", ".")) || 0 : v } : x)) } : d));
  const list = q.data?.invoices ?? [];
  return (
    <Section
      icon={<Receipt size={15} />}
      title="Invoices"
      sub="From logged hours or the budget · print or save as PDF."
      actions={
        !draft ? (
          <button onClick={() => void startDraft()} className={btnSm}>
            <Plus size={12} /> New invoice
          </button>
        ) : null
      }
    >
      {draft && (
        <div className="mb-3 space-y-2 rounded-lg border border-line bg-bg p-3">
          <div className="text-[12px] text-faint">
            Period {fmtDay(draft.from)} – {fmtDay(draft.to)}
          </div>
          {draft.items.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-1.5 sm:grid-cols-[minmax(0,1fr)_70px_60px_100px_auto]">
              <input className={`${input} col-span-2 sm:col-span-1`} value={x.description} onChange={(e) => setLine(i, "description", e.target.value)} placeholder="Description" />
              <input className={`${input} num`} inputMode="decimal" value={x.qty || ""} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder="Qty" aria-label="Quantity" />
              <input className={input} value={x.unit} onChange={(e) => setLine(i, "unit", e.target.value)} placeholder="h" aria-label="Unit" />
              <input className={`${input} num`} inputMode="decimal" value={x.unitPrice || ""} onChange={(e) => setLine(i, "unitPrice", e.target.value)} placeholder="Price €" aria-label="Unit price in euros" />
              <button onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })} className="inline-grid size-[34px] place-items-center rounded-lg text-faint hover:text-danger" aria-label="Remove line">
                <X size={14} />
              </button>
            </div>
          ))}
          <button onClick={() => setDraft({ ...draft, items: [...draft.items, { description: "", qty: 1, unit: "pcs", unitPrice: 0 }] })} className={btnSm}>
            <Plus size={12} /> Add line
          </button>
          <textarea className={`${field} min-h-[56px] py-2 text-[13px]`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Note on the invoice (optional)" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              Due in
              <input className={`${input} num w-16`} inputMode="numeric" value={draft.dueDays} onChange={(e) => setDraft({ ...draft, dueDays: Number(e.target.value) || 0 })} />
              days
            </label>
            <span className="num ml-auto text-[14px] font-semibold">{eur(total(draft.items))}</span>
            <button onClick={() => setDraft(null)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={() => void create()} disabled={busy} className={btnPrimary}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create
            </button>
          </div>
          {err && <p className="text-[12px] text-danger">{err}</p>}
        </div>
      )}
      {list.length === 0 && !draft ? (
        <p className="text-[13px] text-faint">{q.data ? "No invoices yet." : q.error ?? "Loading…"}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
              <span className="num font-medium">#{inv.number}</span>
              <span className="text-faint">{fmtDay(inv.issuedAt)}</span>
              <span className="num">{eur(inv.totalEur)}</span>
              <Select
                value={inv.status}
                onChange={async (e) => {
                  await teamFetch(`/delivery/invoices/${inv.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
                  await q.reload();
                }}
                className={`h-[28px] rounded-md border border-line bg-bg px-1.5 text-[12px] ${inv.status === "paid" ? "text-success" : inv.status === "sent" ? "text-warning" : "text-muted"}`}
                aria-label="Invoice status"
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
              </Select>
              {inv.status !== "paid" && Date.parse(inv.dueAt) < Date.now() && inv.status === "sent" && <Badge tone="danger">Overdue</Badge>}
              <span className="ml-auto flex gap-1.5">
                <button onClick={() => setPrintId(inv.id)} className={btnSm}>
                  <Printer size={12} /> Open
                </button>
                {inv.status === "draft" && (
                  <button
                    onClick={async () => {
                      if (!(await askConfirm(`Delete invoice #${inv.number}? This can't be undone.`))) return;
                      await teamFetch(`/delivery/invoices/${inv.id}`, { method: "DELETE" });
                      await q.reload();
                    }}
                    className={`${btnSm} hover:text-danger`}
                    aria-label="Delete invoice"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {printId && <InvoicePrint id={printId} onClose={() => setPrintId(null)} />}
    </Section>
  );
}

/** Faktura preko celog ekrana; „Print / Save as PDF“ štampa samo nju. */
function InvoicePrint({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useCached<{ invoice: Invoice & { periodFrom: string | null; periodTo: string | null }; project: { name: string; key: string } | null; customer: { name: string; contactName: string | null; contactEmail: string | null; website: string | null; country: string | null } | null; organization: { name?: string; logoUrl?: string; website?: string; email?: string; invoiceDetails?: string } }>(`/delivery/invoices/${id}`);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  const d = q.data;
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/50 p-4 print:static print:bg-white print:p-0">
      <div className="mx-auto mb-3 flex max-w-[800px] justify-end gap-2 print:hidden">
        <button onClick={() => window.print()} className={btnPrimary}>
          <Printer size={14} /> Print / Save as PDF
        </button>
        <button onClick={onClose} className={btnSecondary}>
          Close
        </button>
      </div>
      <div className="print-area mx-auto max-w-[800px] rounded-xl bg-white p-8 text-[13px] text-zinc-800 shadow-float sm:p-12 print:max-w-none print:rounded-none print:shadow-none">
        {!d ? (
          <div className="h-40 animate-pulse rounded bg-zinc-100" />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                {d.organization.logoUrl && <img src={d.organization.logoUrl} alt="" className="mb-2 h-10 w-auto" />}
                <div className="text-[16px] font-semibold text-zinc-900">{d.organization.name || "Your company"}</div>
                <div className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-zinc-500">{d.organization.invoiceDetails}</div>
                <div className="text-[12px] text-zinc-500">{[d.organization.website, d.organization.email].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="text-right">
                <div className="text-[20px] font-semibold tracking-tight text-zinc-900">Invoice</div>
                <div className="num mt-1 text-zinc-600">#{d.invoice.number}</div>
                <div className="mt-2 text-[12px] text-zinc-500">Issued {fmtDay(d.invoice.issuedAt)}</div>
                <div className="text-[12px] text-zinc-500">Due {fmtDay(d.invoice.dueAt)}</div>
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-400">Bill to</div>
                <div className="mt-1 font-medium text-zinc-900">{d.customer?.name ?? "—"}</div>
                <div className="text-[12px] text-zinc-500">{[d.customer?.contactName, d.customer?.contactEmail, d.customer?.country].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="sm:text-right">
                <div className="text-[11px] uppercase tracking-wider text-zinc-400">Project</div>
                <div className="mt-1 font-medium text-zinc-900">{d.project?.name ?? "—"}</div>
                {d.invoice.periodFrom && d.invoice.periodTo && (
                  <div className="text-[12px] text-zinc-500">
                    {fmtDay(d.invoice.periodFrom)} – {fmtDay(d.invoice.periodTo)}
                  </div>
                )}
              </div>
            </div>
            <table className="mt-8 w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-zinc-200 text-[11px] uppercase tracking-wider text-zinc-400">
                  <th className="py-2 font-normal">Description</th>
                  <th className="py-2 text-right font-normal">Qty</th>
                  <th className="py-2 text-right font-normal">Price</th>
                  <th className="py-2 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.invoice.items.map((x, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="py-2.5 pr-3">{x.description}</td>
                    <td className="num py-2.5 text-right">
                      {x.qty} {x.unit}
                    </td>
                    <td className="num py-2.5 text-right">{eur(x.unitPrice)}</td>
                    <td className="num py-2.5 text-right">{eur(x.qty * x.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex justify-end">
              <div className="w-60 border-t-2 border-zinc-900 pt-2 text-right">
                <div className="text-[11px] uppercase tracking-wider text-zinc-400">Total</div>
                <div className="num text-[20px] font-semibold text-zinc-900">{eur(d.invoice.totalEur)}</div>
              </div>
            </div>
            {d.invoice.notes && <p className="mt-8 whitespace-pre-line text-[12px] text-zinc-500">{d.invoice.notes}</p>}
          </>
        )}
      </div>
    </div>
  );
}

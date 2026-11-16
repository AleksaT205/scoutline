import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, CircleDashed, Loader2, Send, Timer } from "lucide-react";
import type { IssueStatus, ProjectStatus } from "@radar/shared";
import { API_URL } from "../lib/api";
import { fmtDate } from "../lib/delivery";
import { ProgressRing, StatusIcon } from "./delivery/parts";

/** Javni portal za klijenta (Faza 11): napredak projekta + slanje zahteva. Bez prijave, samo uz tajni link. */
interface Item {
  key: string;
  title: string;
  status: IssueStatus;
  completedAt: string | null;
  dueDate: string | null;
}
interface PortalData {
  label: string;
  allowRequests: boolean;
  project: { name: string; key: string; status: ProjectStatus; dueDate: string | null; startDate: string; customerName: string | null };
  progress: number;
  counts: { total: number; done: number; inProgress: number };
  doneThisWeek: Item[];
  inProgress: Item[];
  upNext: Item[];
  requests: Item[];
}

const STATUS_TEXT: Record<ProjectStatus, string> = { planned: "Planned", active: "In progress", paused: "Paused", done: "Delivered", canceled: "Canceled" };
const REQ_TEXT: Partial<Record<IssueStatus, string>> = { triage: "Received", backlog: "Planned", todo: "Planned", in_progress: "In progress", in_review: "In review", done: "Done", canceled: "Declined" };

function Section({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: Item[]; empty: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        {icon} {title} <span className="num text-faint">{items.length}</span>
      </div>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-2 text-[13px]">
              <span className="mt-[3px]">
                <StatusIcon status={i.status} size={13} />
              </span>
              <span className="min-w-0 flex-1">{i.title}</span>
              {i.completedAt && <span className="num shrink-0 text-[11.5px] text-faint">{fmtDate(i.completedAt)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-faint">{empty}</p>
      )}
    </section>
  );
}

export function PortalPage({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", title: "", details: "", website: "" });
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = () =>
    fetch(`${API_URL}/portal/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "This link doesn't work.");
        setData(d as PortalData);
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const field = "w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60";

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-2.5 text-[13px] text-muted">
          <div className="grid size-[24px] place-items-center rounded-[7px] bg-gradient-to-br from-accent to-[#b4a9ff]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </div>
          Project portal
        </div>
        {error ? (
          <div className="rounded-xl border border-line bg-surface p-8 text-center">
            <div className="text-[15px] font-medium">Link unavailable</div>
            <p className="mt-1 text-[13px] text-muted">{error}</p>
          </div>
        ) : !data ? (
          <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
        ) : (
          <>
            <header className="mb-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <div className="text-[12.5px] text-muted">{data.project.customerName ?? "Your project"}</div>
              <h1 className="mt-0.5 text-[26px] font-semibold tracking-tight">{data.project.name}</h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-3">
                  <ProgressRing value={data.progress} size={44} />
                  <div>
                    <div className="num text-[22px] font-semibold leading-none">{data.progress}%</div>
                    <div className="text-[12px] text-muted">
                      {data.counts.done} of {data.counts.total} tasks done
                    </div>
                  </div>
                </div>
                <div className="text-[13px]">
                  <div className="text-faint">Status</div>
                  <div className="font-medium">{STATUS_TEXT[data.project.status]}</div>
                </div>
                <div className="text-[13px]">
                  <div className="text-faint">Started</div>
                  <div className="font-medium">{fmtDate(data.project.startDate)}</div>
                </div>
                {data.project.dueDate && (
                  <div className="text-[13px]">
                    <div className="inline-flex items-center gap-1 text-faint">
                      <CalendarDays size={12} /> Target date
                    </div>
                    <div className="font-medium">{fmtDate(data.project.dueDate)}</div>
                  </div>
                )}
              </div>
            </header>

            <div className="grid gap-4 md:grid-cols-3">
              <Section title="Done this week" icon={<CheckCircle2 size={14} className="text-success" />} items={data.doneThisWeek} empty="Nothing finished yet this week." />
              <Section title="In progress" icon={<Timer size={14} className="text-warning" />} items={data.inProgress} empty="Nothing in progress right now." />
              <Section title="Up next" icon={<CircleDashed size={14} className="text-muted" />} items={data.upNext} empty="The next tasks will appear here." />
            </div>

            {data.allowRequests && (
              <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
                <h2 className="text-[15px] font-semibold">Send a request</h2>
                <p className="mt-0.5 text-[13px] text-muted">A change, a bug or a new idea — the team reviews every request and replies.</p>
                {sent ? (
                  <div className="mt-3 rounded-lg border border-success/40 bg-success-soft px-3 py-2.5 text-[13px] text-success">
                    Thanks! Your request <span className="num">{sent}</span> was received.{" "}
                    <button onClick={() => setSent(null)} className="underline">
                      Send another
                    </button>
                  </div>
                ) : (
                  <form
                    className="mt-3 grid gap-2.5 sm:grid-cols-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      setFormError(null);
                      try {
                        const r = await fetch(`${API_URL}/portal/${encodeURIComponent(token)}/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d.error ?? "Couldn't send the request.");
                        setSent(d.key ?? "");
                        setForm({ ...form, title: "", details: "" });
                        void load();
                      } catch (err) {
                        setFormError((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <input className={`${field} h-[36px]`} placeholder="Your name" value={form.name} onChange={set("name")} />
                    <input className={`${field} h-[36px]`} type="email" placeholder="Email (for our reply)" value={form.email} onChange={set("email")} />
                    <input className={`${field} h-[36px] sm:col-span-2`} placeholder="Short title, e.g. “Add PDF export to invoices”" value={form.title} onChange={set("title")} required />
                    <textarea className={`${field} h-28 resize-none py-2 sm:col-span-2`} placeholder="Details (what, where, why it matters)" value={form.details} onChange={set("details")} />
                    {/* Zamka za botove — ljudi ne vide ovo polje */}
                    <input className="hidden" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} aria-hidden="true" />
                    {formError && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger sm:col-span-2">{formError}</div>}
                    <div className="sm:col-span-2">
                      <button disabled={busy || !form.title.trim()} className="inline-flex h-[36px] items-center gap-1.5 rounded-[7px] bg-fg px-4 text-[13px] font-medium text-bg disabled:opacity-40">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send request
                      </button>
                    </div>
                  </form>
                )}
                {data.requests.length > 0 && (
                  <div className="mt-4 border-t border-line pt-3">
                    <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-faint">Your recent requests</div>
                    <ul className="space-y-1">
                      {data.requests.map((r) => (
                        <li key={r.key} className="flex items-center gap-2 text-[13px]">
                          <StatusIcon status={r.status} size={13} />
                          <span className="min-w-0 flex-1 truncate">{r.title}</span>
                          <span className="text-[12px] text-muted">{REQ_TEXT[r.status] ?? r.status}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
            <p className="mt-6 text-center text-[11.5px] text-faint">Private link · shared by your project team</p>
          </>
        )}
      </div>
    </div>
  );
}

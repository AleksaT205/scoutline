import { useEffect, useState } from "react";
import { ArrowRight, EyeOff, Loader2, Lock, MessageSquarePlus, Send } from "lucide-react";
import type { LeadStatus } from "@radar/shared";
import type { UiLead } from "../data/demo";
import { getTeamToken, setTeamToken, teamFetch } from "../lib/team";
import { STATUS_META } from "./ui";

/** Redosled kroz pipeline (hidden je posebno — "Hide"). */
export const STAGES: LeadStatus[] = ["new", "contacted", "replied", "meeting", "won", "lost"];
const NEXT: Partial<Record<LeadStatus, LeadStatus>> = { new: "contacted", contacted: "replied", replied: "meeting", meeting: "won" };
const NEXT_LABEL: Partial<Record<LeadStatus, string>> = { new: "Mark contacted", contacted: "Got a reply", replied: "Meeting booked", meeting: "Mark won" };

/** Promena statusa preko API-ja; ako nema lozinke, traži je jednom. */
export async function changeStatus(lead: UiLead, status: LeadStatus): Promise<UiLead> {
  if (!getTeamToken()) {
    const pw = window.prompt("Team password (needed to update leads):");
    if (!pw) throw new Error("Team password is required.");
    setTeamToken(pw);
  }
  try {
    const res = await teamFetch<{ lead: UiLead }>(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    return res.lead;
  } catch (e) {
    if ((e as { status?: number }).status === 401) setTeamToken("");
    throw e;
  }
}

export function StatusBar({ lead, live, onUpdated }: { lead: UiLead; live: boolean; onUpdated: (l: UiLead) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = lead.status ?? "new";
  const next = NEXT[status];

  const go = async (to: LeadStatus) => {
    if (!live) return setError("This is sample data — status changes work on live leads.");
    setBusy(true);
    setError(null);
    try {
      onUpdated(await changeStatus(lead, to));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-bg p-1" role="radiogroup" aria-label="Pipeline stage">
        {STAGES.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={status === s}
            disabled={busy}
            onClick={() => status !== s && go(s)}
            className={`h-[26px] shrink-0 rounded-md px-2 text-[12px] transition-colors ${
              status === s ? `font-medium ring-1 ring-inset ${STATUS_META[s].cls}` : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {STATUS_META[s].label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {next && (
          <button
            onClick={() => go(next)}
            disabled={busy}
            className="inline-flex h-[32px] flex-1 items-center justify-center gap-1.5 rounded-[7px] bg-accent text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />} {NEXT_LABEL[status]}
          </button>
        )}
        {status !== "hidden" ? (
          <button
            onClick={() => go("hidden")}
            disabled={busy}
            title="Hide this lead (not a fit)"
            className="inline-flex h-[32px] items-center justify-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-medium text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <EyeOff size={13} /> Hide
          </button>
        ) : (
          <button onClick={() => go("new")} disabled={busy} className="inline-flex h-[32px] flex-1 items-center justify-center rounded-[7px] border border-line bg-surface text-[12.5px] font-medium hover:bg-surface-2">
            Restore
          </button>
        )}
      </div>
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

interface LeadEvent {
  id: string;
  type: string;
  data: { from?: string; to?: string; text?: string } | null;
  createdAt: string;
}

function when(iso: string) {
  const d = new Date(iso);
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function NotesPanel({ lead, live }: { lead: UiLead; live: boolean }) {
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [locked, setLocked] = useState(!getTeamToken());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await teamFetch<{ events: LeadEvent[] }>(`/leads/${lead.id}/events`);
      setEvents(res.events);
      setLocked(false);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setLocked(true);
      else setError((e as Error).message);
    }
  };

  useEffect(() => {
    setEvents(null);
    setError(null);
    if (live && getTeamToken()) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.status, live]);

  if (!live) return null;

  return (
    <div className="mt-[18px]">
      <div className="mb-2 text-[11.5px] uppercase tracking-wider text-faint">Notes & history</div>
      {locked ? (
        <button
          onClick={() => {
            const pw = window.prompt("Team password:");
            if (pw) {
              setTeamToken(pw);
              void load();
            }
          }}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg"
        >
          <Lock size={12} /> Unlock notes
        </button>
      ) : (
        <>
          <form
            className="flex items-start gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              setBusy(true);
              setError(null);
              try {
                await teamFetch(`/leads/${lead.id}/notes`, { method: "POST", body: JSON.stringify({ text }) });
                setText("");
                await load();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }}
              rows={2}
              placeholder="Add a note… (e.g. sent email to CTO, follow up Friday)"
              className="min-h-[56px] flex-1 resize-none rounded-lg border border-line bg-bg px-2.5 py-2 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60"
            />
            <button disabled={busy || !text.trim()} className="grid size-[32px] place-items-center rounded-[7px] bg-fg text-bg disabled:opacity-30" aria-label="Add note">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          </form>
          {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
          <ol className="mt-3 space-y-2">
            {events === null && <li className="h-4 animate-pulse rounded bg-surface-2" />}
            {events?.length === 0 && (
              <li className="flex items-center gap-1.5 text-[12.5px] text-faint">
                <MessageSquarePlus size={12} /> No notes yet.
              </li>
            )}
            {events?.map((ev) => (
              <li key={ev.id} className="flex gap-2 text-[12.5px]">
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${ev.type === "note" ? "bg-accent" : "bg-line-2"}`} />
                <div className="min-w-0 flex-1">
                  {ev.type === "note" ? (
                    <p className="whitespace-pre-wrap text-fg">{ev.data?.text}</p>
                  ) : (
                    <p className="text-muted">
                      Moved to <b className="font-medium text-fg">{STATUS_META[(ev.data?.to as LeadStatus) ?? "new"]?.label ?? ev.data?.to}</b>
                      {ev.data?.from && <> from {STATUS_META[ev.data.from as LeadStatus]?.label ?? ev.data.from}</>}
                    </p>
                  )}
                  <span className="text-[11px] text-faint">{when(ev.createdAt)}</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

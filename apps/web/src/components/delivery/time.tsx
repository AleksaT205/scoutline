import { useEffect, useState } from "react";
import { Clock, Loader2, Plus, X } from "lucide-react";
import { fmtMinutes, parseDuration } from "@radar/shared";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";
import { fmtDate, type TimeEntry } from "../../lib/delivery";

/** Evidencija vremena na tasku (Faza 12): „1h 30m“, datum, napomena, naplativo. */
export function TimeBox({ issueId }: { issueId: string }) {
  const user = useSessionUser();
  const editable = canEdit(user);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  // Današnji datum po lokalnom vremenu (ne UTC — posle ponoći bi bio jučerašnji)
  const [day, setDay] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [billable, setBillable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    teamFetch<{ entries: TimeEntry[] }>(`/delivery/time?issueId=${issueId}`)
      .then((d) => setEntries(d.entries))
      .catch(() => setEntries([]));
  useEffect(() => {
    setEntries(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);
  const minutes = parseDuration(text);
  const total = (entries ?? []).reduce((a, e) => a + e.minutes, 0);

  return (
    <div className="mt-3 rounded-xl border border-line bg-bg p-3">
      <div className="flex items-center gap-2 text-[12.5px]">
        <Clock size={14} className="text-accent" />
        <span className="font-medium">Time</span>
        {total ? <span className="num text-muted">{fmtMinutes(total)}</span> : <span className="text-faint">nothing logged yet</span>}
      </div>
      {editable && (
        <form
          className="mt-2 flex flex-wrap items-center gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!minutes) return setError("Write time like 1h 30m, 45m or 2h.");
            setBusy(true);
            setError(null);
            try {
              await teamFetch("/delivery/time", { method: "POST", body: JSON.stringify({ issueId, minutes, note, billable, spentOn: new Date(`${day}T12:00:00Z`).toISOString() }) });
              setText("");
              setNote("");
              await load();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="1h 30m" aria-label="Time spent" className={`num h-[28px] w-24 rounded-md border bg-surface px-2 text-[12.5px] outline-none placeholder:text-faint ${text && !minutes ? "border-danger/60" : "border-line focus:border-accent/60"}`} />
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Date" className="h-[28px] rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-accent/60" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do? (optional)" aria-label="Note" className="h-[28px] min-w-[140px] flex-1 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60" />
          <label className="inline-flex items-center gap-1 text-[12px] text-muted" title="Counts toward client billing on hourly projects">
            <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} className="accent-[var(--accent)]" /> Billable
          </label>
          <button disabled={busy || !text.trim()} className="inline-flex h-[28px] items-center gap-1 rounded-md bg-fg px-2.5 text-[12px] font-medium text-bg disabled:opacity-40">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Log
          </button>
        </form>
      )}
      {error && <div className="mt-1.5 text-[12px] text-danger">{error}</div>}
      {(entries ?? []).length > 0 && (
        <ul className="mt-2 space-y-1">
          {entries!.map((e) => (
            <li key={e.id} className="group flex items-center gap-2 text-[12.5px]">
              <span className="num w-14 shrink-0 font-medium">{fmtMinutes(e.minutes)}</span>
              <span className="shrink-0 text-muted">{e.userName}</span>
              <span className="min-w-0 flex-1 truncate text-faint">{e.note}</span>
              {!e.billable && <span className="text-[11px] text-faint">non-billable</span>}
              <span className="num shrink-0 text-[11.5px] text-faint">{fmtDate(e.spentOn)}</span>
              {editable && (user?.role === "owner" || e.userId === user?.id) && (
                <button
                  onClick={async () => {
                    await teamFetch(`/delivery/time/${e.id}`, { method: "DELETE" }).catch((err) => setError((err as Error).message));
                    void load();
                  }}
                  className="text-faint hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label="Delete time entry"
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

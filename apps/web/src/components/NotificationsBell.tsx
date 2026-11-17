import { useEffect, useRef, useState } from "react";
import { useDismiss } from "../lib/useDismiss";
import { Bell, CheckCheck, CircleDot, GitMerge, Inbox, MessageSquare, Sparkles, UserPlus } from "lucide-react";
import { useCached } from "../lib/cache";

/** Zvonce u zaglavlju: novi dobri leadovi, zahtevi u Inboxu, dodele, komentari, PR-ovi. „Pročitano“ pamti browser. */
interface Note {
  id: string;
  kind: "lead" | "inbox" | "assigned" | "comment" | "github" | "done";
  title: string;
  sub: string;
  at: string;
  href: string;
}
const SEEN_KEY = "scoutline-notifications-seen";
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
};
const ICON: Record<Note["kind"], React.ReactNode> = {
  lead: <Sparkles size={14} className="text-accent" />,
  inbox: <Inbox size={14} className="text-warning" />,
  assigned: <UserPlus size={14} className="text-success" />,
  comment: <MessageSquare size={14} className="text-muted" />,
  github: <GitMerge size={14} className="text-accent" />,
  done: <CircleDot size={14} className="text-success" />,
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

const NONE: Note[] = [];

export function NotificationsBell() {
  const res = useCached<{ items: Note[] }>("/notifications", { staleMs: 30_000, refreshMs: 60_000 });
  const items = res.data?.items ?? NONE;
  // Prihvaćen/odbijen zahtev u Inboxu → osveži zvonce odmah
  useEffect(() => {
    const on = () => void res.reload();
    window.addEventListener("inbox-changed", on);
    return () => window.removeEventListener("inbox-changed", on);
  }, [res.reload]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const unread = items.filter((i) => i.at > seen).length;
  const markRead = () => {
    const now = new Date().toISOString();
    setSeen(now);
    try {
      localStorage.setItem(SEEN_KEY, now);
    } catch {
      /* privatni režim */
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-[34px] place-items-center rounded-[7px] border border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={unread ? `Notifications (${unread} new)` : "Notifications"}
        aria-expanded={open}
      >
        <Bell size={15} />
        {unread > 0 && <span className="num absolute -right-1 -top-1 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-accent px-1 text-[10px] font-medium text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-14 z-40 rounded-xl border border-line bg-surface shadow-float sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[380px]">
          <div className="flex items-center border-b border-line px-3 py-2.5">
            <span className="text-[13px] font-medium">Notifications</span>
            {unread > 0 && (
              <button onClick={markRead} className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto p-1">
            {items.map((n) => (
              <li key={n.id}>
                <a
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-surface-2 ${n.at > seen ? "" : "opacity-70"}`}
                >
                  <span className="mt-0.5">{ICON[n.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{n.title}</span>
                    <span className="block truncate text-[12px] text-muted">{n.sub}</span>
                  </span>
                  <span className="num shrink-0 text-[11px] text-faint">{ago(n.at)}</span>
                  {n.at > seen && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />}
                </a>
              </li>
            ))}
            {items.length === 0 && <li className="px-3 py-8 text-center text-[12.5px] text-faint">You're all caught up.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

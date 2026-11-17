import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, RefreshCw, Rocket } from "lucide-react";
import { useCached } from "../lib/cache";
import { teamFetch } from "../lib/team";
import { segItem } from "../lib/ui";
import { askConfirm } from "../lib/confirm";

/** Settings → System (vlasnik): greške iz aplikacije i sa servera. Nova greška stiže i na Telegram. */
interface AppError {
  id: string;
  source: "web" | "api" | "worker";
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
  userName: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
}
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const browserOf = (ua: string | null) => (!ua ? "" : /iphone|ipad/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /edg\//i.test(ua) ? "Edge" : /chrome/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : /firefox/i.test(ua) ? "Firefox" : "");

interface Deploy {
  enabled: boolean;
  missing: string[];
  repo: string | null;
  branch: string;
  deployed: string | null;
  lastTriggered?: string;
  lastTriggeredAt?: string;
  lastCheck?: string;
  note?: string;
}

/** Auto-deploy: server sam pokrene Redeploy u Coolify-ju kad CI na main prođe. */
function AutoDeploy() {
  const q = useCached<Deploy>("/system/deploy", { staleMs: 10_000, refreshMs: 60_000 });
  const [busy, setBusy] = useState(false);
  const d = q.data;
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <Rocket size={16} className="mt-0.5 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            Auto-deploy
            {d && <span className={`rounded-full px-2 py-px text-[11px] font-normal ${d.enabled ? "bg-success-soft text-success" : "bg-surface-2 text-muted"}`}>{d.enabled ? "On" : "Off"}</span>}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">When a commit on main passes CI (tests + build), the server redeploys itself in Coolify. If CI fails, nothing is deployed and Telegram tells you.</p>
        </div>
        {d?.enabled && (
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await teamFetch("/system/deploy/check", { method: "POST", body: "{}" });
                await q.reload();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="inline-flex h-[28px] items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12px] hover:bg-surface-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check now
          </button>
        )}
      </div>
      {q.error && <p className="mt-3 text-[12.5px] text-danger">{q.error}</p>}
      {d?.enabled && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[auto_1fr]">
          <dt className="text-faint">Watching</dt>
          <dd className="num">
            {d.repo} · {d.branch}
          </dd>
          <dt className="text-faint">Running</dt>
          <dd className="num">{d.deployed ? d.deployed.slice(0, 7) : "—"}</dd>
          <dt className="text-faint">Status</dt>
          <dd>
            {d.note ?? "Waiting for the first check"}
            {d.lastCheck && <span className="text-faint"> · checked {ago(d.lastCheck)}</span>}
          </dd>
        </dl>
      )}
      {d && !d.enabled && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12.5px] text-muted">
          <li>
            Coolify → <b className="text-fg">Keys &amp; Tokens → API tokens</b> → create one with the <b className="text-fg">deploy</b> permission.
          </li>
          <li>
            Coolify → this project → <b className="text-fg">Environment Variables</b>: <code className="num text-fg">COOLIFY_API_TOKEN</code> = that token, <code className="num text-fg">COOLIFY_API_URL</code> = the Coolify address (e.g. <code className="num">http://192.168.100.60:8000</code>), <code className="num text-fg">DEPLOY_REPO</code> = <code className="num">owner/repo</code>.
          </li>
          <li>
            In the project's settings turn on <b className="text-fg">Include Source Commit in Build</b>, then Redeploy once.
          </li>
          <li className="list-none pt-1 text-faint">Missing now: {d.missing.join(", ")}</li>
        </ol>
      )}
    </section>
  );
}

export function SystemSettings() {
  return (
    <div className="space-y-4">
      <AutoDeploy />
      <ErrorsCard />
    </div>
  );
}

function ErrorsCard() {
  const [show, setShow] = useState<"open" | "resolved">("open");
  const q = useCached<{ errors: AppError[]; open: number }>(`/system/errors${show === "resolved" ? "?show=resolved" : ""}`, { staleMs: 5_000, refreshMs: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const act = async (key: string, path: string) => {
    setBusy(key);
    try {
      await teamFetch(path, { method: "POST", body: "{}" });
      await q.reload();
    } finally {
      setBusy(null);
    }
  };
  const list = q.data?.errors ?? [];
  const seg = segItem;
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Errors</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Crashes in the app and on the server. A new one is also sent to Telegram (at most once an hour).</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
          <button onClick={() => setShow("open")} className={seg(show === "open")}>
            Open{q.data && show === "open" ? ` · ${q.data.open}` : ""}
          </button>
          <button onClick={() => setShow("resolved")} className={seg(show === "resolved")}>
            Resolved
          </button>
        </div>
      </div>
      {q.error && <p className="mt-3 text-[12.5px] text-danger">{q.error}</p>}
      {!q.data && !q.error && <div className="mt-4 h-20 animate-pulse rounded-lg bg-surface-2" />}
      {q.data && list.length === 0 && (
        <div className="mt-4 grid place-items-center rounded-lg border border-dashed border-line px-6 py-10 text-center">
          <Check size={20} className="mb-1.5 text-success" />
          <div className="text-[13px] font-medium">{show === "open" ? "No open errors" : "Nothing resolved yet"}</div>
          <p className="mt-0.5 text-[12px] text-faint">{show === "open" ? "Everything has been running cleanly." : "Errors you mark as resolved show up here."}</p>
        </div>
      )}
      {list.length > 0 && (
        <>
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {list.map((e) => (
              <li key={e.id} className="px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${show === "open" ? "text-danger" : "text-faint"}`} />
                  <button onClick={() => setOpenId(openId === e.id ? null : e.id)} className="min-w-0 flex-1 text-left">
                    <div className="break-words text-[13px] font-medium leading-snug">{e.message}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-faint">
                      <span className="rounded bg-surface-2 px-1.5 font-mono text-[10.5px] uppercase text-muted">{e.source}</span>
                      <span className="num">{e.count}×</span>
                      <span>last {ago(e.lastSeen)}</span>
                      {e.userName && <span>· {e.userName}</span>}
                      {browserOf(e.userAgent) && <span>· {browserOf(e.userAgent)}</span>}
                    </div>
                  </button>
                  <ChevronDown size={14} className={`mt-0.5 shrink-0 text-faint transition-transform ${openId === e.id ? "rotate-180" : ""}`} />
                  {show === "open" && (
                    <button onClick={() => void act(e.id, `/system/errors/${e.id}/resolve`)} disabled={!!busy} className="inline-flex h-[28px] shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[12px] hover:bg-surface-2 disabled:opacity-50">
                      {busy === e.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} <span className="hidden sm:inline">Resolve</span>
                    </button>
                  )}
                </div>
                {openId === e.id && (
                  <div className="mt-2 space-y-1.5 pl-6 text-[11.5px] text-muted">
                    {e.url && <div className="break-all">Where: <span className="text-fg">{e.url}</span></div>}
                    <div>First seen {new Date(e.firstSeen).toLocaleString("en-GB")} · last {new Date(e.lastSeen).toLocaleString("en-GB")}</div>
                    {e.stack && <pre className="num max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-bg p-2 text-[10.5px] leading-relaxed text-faint">{e.stack}</pre>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            {show === "open" ? (
              <button onClick={async () => (await askConfirm("Mark all errors as resolved? If one happens again, it comes back and you get a Telegram message.")) && void act("all", "/system/errors/resolve-all")} disabled={!!busy} className="text-[12px] text-muted hover:text-fg">
                Resolve all
              </button>
            ) : (
              <button onClick={async () => (await askConfirm("Clear resolved errors? They're deleted for good.")) && void act("clear", "/system/errors/clear-resolved")} disabled={!!busy} className="text-[12px] text-muted hover:text-danger">
                Clear resolved
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

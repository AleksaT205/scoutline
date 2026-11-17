import { useEffect, useState } from "react";
import { BellRing, Check, Loader2, Lock, Send, X } from "lucide-react";
import { LEAD_TYPES, SERVICE_CATEGORIES, type AlertSettings } from "@radar/shared";
import { getTeamToken, setTeamToken, teamFetch } from "../lib/team";
import { CATEGORY_LABEL, TYPE_META } from "./ui";

const MARKETS: Array<{ key: AlertSettings["markets"][number]; label: string }> = [
  { key: "T1", label: "Tier 1" },
  { key: "T2", label: "Tier 2" },
  { key: "T3", label: "Other" },
  { key: "UNKNOWN", label: "Worldwide / unknown" },
  { key: "DOMESTIC", label: "🇷🇸 Serbia & region" },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-[13px]">
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-accent" : "bg-line-2"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-[28px] items-center gap-1 rounded-full border px-2.5 text-[12px] transition-colors ${
        on ? "border-accent/55 bg-accent-soft text-fg" : "border-line bg-surface text-muted hover:text-fg"
      }`}
    >
      {on && <Check size={11} />} {children}
    </button>
  );
}

export function AlertsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [alerts, setAlerts] = useState<AlertSettings | null>(null);
  const [telegram, setTelegram] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    setMsg(null);
    try {
      const res = await teamFetch<{ alerts: AlertSettings; telegram: boolean }>("/settings/alerts");
      setAlerts(res.alerts);
      setTelegram(res.telegram);
      setNeedsPassword(false);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedsPassword(true);
      else setMsg({ kind: "err", text: (e as Error).message });
    }
  };

  useEffect(() => {
    if (!open) return;
    if (!getTeamToken()) setNeedsPassword(true);
    else void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const set = (patch: Partial<AlertSettings>) => alerts && setAlerts({ ...alerts, ...patch });
  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-[560px] rounded-[14px] border border-line bg-surface p-5 shadow-float" role="dialog" aria-modal="true" aria-labelledby="alerts-title">
        <div className="mb-1 flex items-center gap-2">
          <BellRing size={16} className="text-accent" />
          <h2 id="alerts-title" className="text-base font-semibold tracking-tight">
            Telegram alerts
          </h2>
          <button onClick={onClose} className="ml-auto text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-[13px] text-muted">Choose which new leads are sent to Telegram. New posts are checked every minute; each lead is sent once.</p>

        {needsPassword ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setTeamToken(password);
              void load();
            }}
          >
            <Lock size={14} className="text-faint" />
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Team password"
              className="h-[34px] flex-1 rounded-lg border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-faint focus:border-accent/60"
            />
            <button disabled={!password} className="h-[34px] rounded-lg bg-fg px-3.5 text-[13px] font-medium text-bg disabled:opacity-40">
              Unlock
            </button>
          </form>
        ) : !alerts ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {!telegram && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-warning">
                Telegram isn’t connected yet — the owner can add the bot in Settings → Integrations.
              </div>
            )}
            <Toggle on={alerts.enabled} onChange={(enabled) => set({ enabled })} label={alerts.enabled ? "Alerts on" : "Alerts paused"} />

            <div className={alerts.enabled ? "" : "pointer-events-none opacity-50"}>
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-faint">
                <span className="uppercase tracking-wider">Minimum score</span>
                <span className="num text-[13px] text-fg">{alerts.minScore}+</span>
              </div>
              <input type="range" min={50} max={95} step={5} value={alerts.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />

              <div className="mt-4 mb-1.5 text-[12px] uppercase tracking-wider text-faint">Lead types</div>
              <div className="flex flex-wrap gap-1.5">
                {LEAD_TYPES.map((t) => (
                  <Chip key={t} on={(alerts.types ?? []).includes(t)} onClick={() => set({ types: toggleIn(alerts.types ?? [], t) })}>
                    {TYPE_META[t].label}
                  </Chip>
                ))}
              </div>

              <div className="mt-4 mb-1.5 text-[12px] uppercase tracking-wider text-faint">Markets</div>
              <div className="flex flex-wrap gap-1.5">
                {MARKETS.map((m) => (
                  <Chip key={m.key} on={alerts.markets.includes(m.key)} onClick={() => set({ markets: toggleIn(alerts.markets, m.key) })}>
                    {m.label}
                  </Chip>
                ))}
              </div>

              <div className="mt-4 mb-1.5 text-[12px] uppercase tracking-wider text-faint">
                Services <span className="normal-case tracking-normal">· none selected = all</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SERVICE_CATEGORIES.filter((c) => c !== "not_relevant").map((c) => (
                  <Chip key={c} on={alerts.categories.includes(c)} onClick={() => set({ categories: toggleIn(alerts.categories, c) })}>
                    {CATEGORY_LABEL[c]}
                  </Chip>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Toggle on={alerts.remoteOnly} onChange={(remoteOnly) => set({ remoteOnly })} label="Only remote-friendly" />
                <label className="inline-flex items-center gap-2 text-[13px] text-muted">
                  Posted within
                  <select
                    value={alerts.maxAgeHours}
                    onChange={(e) => set({ maxAgeHours: Number(e.target.value) })}
                    className="h-[28px] rounded-lg border border-line bg-bg px-2 text-[13px] text-fg outline-none"
                  >
                    <option value={6}>6 hours</option>
                    <option value={24}>24 hours</option>
                    <option value={48}>48 hours</option>
                    <option value={168}>7 days</option>
                  </select>
                </label>
              </div>
            </div>

            {msg && (
              <div className={`rounded-lg border px-3 py-2 text-[13px] ${msg.kind === "ok" ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>{msg.text}</div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={busy !== null || !telegram}
                onClick={async () => {
                  setBusy("test");
                  setMsg(null);
                  try {
                    await teamFetch("/settings/alerts/test", { method: "POST" });
                    setMsg({ kind: "ok", text: "Test message sent — check Telegram." });
                  } catch (e) {
                    setMsg({ kind: "err", text: (e as Error).message });
                  } finally {
                    setBusy(null);
                  }
                }}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-40"
              >
                {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send test
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("save");
                  setMsg(null);
                  try {
                    const res = await teamFetch<{ alerts: AlertSettings }>("/settings/alerts", { method: "PUT", body: JSON.stringify(alerts) });
                    setAlerts(res.alerts);
                    setMsg({ kind: "ok", text: "Saved. New matching leads will be sent within a minute." });
                  } catch (e) {
                    setMsg({ kind: "err", text: (e as Error).message });
                  } finally {
                    setBusy(null);
                  }
                }}
                className="ml-auto inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-fg px-4 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
              >
                {busy === "save" && <Loader2 size={14} className="animate-spin" />} Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

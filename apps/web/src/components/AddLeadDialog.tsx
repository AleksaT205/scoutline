import { useEffect, useRef, useState } from "react";
import { FileText, Link2, Loader2, Lock, Sparkles, X } from "lucide-react";
import type { UiLead } from "../data/demo";
import { API_URL } from "../lib/api";
import { getSessionToken } from "../lib/session";
import { getTeamToken } from "../lib/team";

const TOKEN_KEY = "scoutline-team-token";
const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};

export function AddLeadDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (lead: UiLead) => void }) {
  const [mode, setMode] = useState<"link" | "text">("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [token, setToken] = useState(() => getTeamToken() || readToken());
  const signedIn = !!getSessionToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTimeout(() => firstField.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, busy, onClose]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/leads/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(mode === "link" ? { url, company, location } : { text, company, location }),
      });
      const data = (await res.json().catch(() => ({}))) as { lead?: UiLead; error?: string; duplicate?: boolean };
      if (!res.ok || !data.lead) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
      try {
        if (!signedIn) localStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* privatni režim */
      }
      onAdded(data.lead);
      setUrl("");
      setText("");
      setCompany("");
      setLocation("");
      onClose();
    } catch (err) {
      setError(err instanceof TypeError ? "Can't reach the server. Check that the backend is running." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = "h-[36px] w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60";
  const canSubmit = !busy && token.length > 0 && (mode === "link" ? /^https?:\/\/\S+\.\S+/.test(url) : text.trim().length >= 40);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={() => !busy && onClose()}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-[14px] border border-line bg-surface p-5 shadow-float"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-lead-title"
      >
        <div className="mb-1 flex items-center gap-2">
          <h2 id="add-lead-title" className="text-base font-semibold tracking-tight">
            Add a lead
          </h2>
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-[13px] text-muted">From any site — Infostud, Halo oglasi, LinkedIn, an email. AI scores it right away.</p>

        <div className="mb-3 inline-flex rounded-lg border border-line bg-bg p-0.5 text-[13px]">
          {(
            [
              ["link", "Link", Link2],
              ["text", "Paste text", FileText],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`inline-flex h-[30px] items-center gap-1.5 rounded-md px-3 ${mode === m ? "bg-surface text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          {mode === "link" ? (
            <input
              ref={firstField as React.RefObject<HTMLInputElement>}
              className={input}
              type="url"
              inputMode="url"
              placeholder="https://poslovi.infostud.com/posao/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          ) : (
            <textarea
              ref={firstField as React.RefObject<HTMLTextAreaElement>}
              className="h-36 w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-faint focus:border-accent/60"
              placeholder="Paste the job post or project description…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <input className={input} placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
            <input className={input} placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          {mode === "link" && <p className="text-[12px] text-faint">If a page needs a login, switch to “Paste text”.</p>}
          {!signedIn && (
          <label className="flex items-center gap-2 pt-1">
            <Lock size={13} className="text-faint" />
            <input className={input} type="password" placeholder="Team password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          )}
        </div>

        {error && <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-[34px] rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-fg px-3.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {busy ? "Analyzing…" : "Add & score"}
          </button>
        </div>
      </form>
    </div>
  );
}

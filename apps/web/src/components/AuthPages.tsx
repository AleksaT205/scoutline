import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { API_URL } from "../lib/api";
import { setSession, type SessionUser } from "../lib/session";

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Can't reach the server. Check that the backend is running.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
  return data;
}

function Shell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(600px_circle_at_50%_0%,var(--accent-soft),transparent_70%)]" />
      <div className="relative w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-2.5 font-semibold tracking-tight">
          <div className="grid size-[30px] place-items-center rounded-[8px] bg-gradient-to-br from-accent to-[#b4a9ff] shadow-[0_6px_18px_-6px_var(--accent)]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </div>
          <span className="text-lg">Scoutline</span>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-6 shadow-float">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 mb-5 text-[13px] text-muted">{sub}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

const field = "h-[38px] w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60";

function Submit({ busy, label, disabled }: { busy: boolean; label: string; disabled?: boolean }) {
  return (
    <button disabled={busy || disabled} className="mt-1 inline-flex h-[38px] w-full items-center justify-center gap-1.5 rounded-[8px] bg-fg text-[13.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40">
      {busy && <Loader2 size={14} className="animate-spin" />} {label}
    </button>
  );
}

function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const ErrorBox = ({ error }: { error: string | null }) =>
  error ? <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div> : null;

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useForm();
  return (
    <Shell title="Sign in" sub="Welcome back. Sign in to see your leads.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const res = await post<{ token: string; user: SessionUser }>("/auth/login", { email, password });
            setSession(res.token, res.user);
          });
        }}
      >
        <input className={field} type="email" autoComplete="email" autoFocus placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={field} type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox error={error} />
        <Submit busy={busy} label="Sign in" disabled={!email || !password} />
      </form>
      <p className="mt-4 text-center text-[12px] text-faint">No account? Ask the team owner for an invite link.</p>
    </Shell>
  );
}

/** Prvi nalog (owner) — potvrđuje se starom timskom lozinkom (API_TOKEN). */
export function SetupPage({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamPassword, setTeamPassword] = useState("");
  const { busy, error, run } = useForm();
  return (
    <Shell title="Create the owner account" sub="One-time setup. After this, everyone signs in with their own account — the team password is only for confirming this step.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const res = await post<{ token: string; user: SessionUser }>("/auth/setup", { name, email, password, teamPassword });
            setSession(res.token, res.user);
            onDone();
          });
        }}
      >
        <input className={field} autoFocus placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={field} type="password" autoComplete="new-password" placeholder="Password (min. 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className={field} type="password" placeholder="Team password (API_TOKEN)" value={teamPassword} onChange={(e) => setTeamPassword(e.target.value)} />
        <ErrorBox error={error} />
        <Submit busy={busy} label="Create account" disabled={!email || password.length < 8 || !teamPassword} />
      </form>
    </Shell>
  );
}

export function AcceptInvitePage({ token, onDone }: { token: string; onDone: () => void }) {
  const [invite, setInvite] = useState<{ email: string | null; role: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useForm();

  useEffect(() => {
    fetch(`${API_URL}/auth/invite/${token}`)
      .then(async (r) => {
        const d = (await r.json()) as { email: string | null; role: string; error?: string };
        if (!r.ok) throw new Error(d.error ?? "This invite link is invalid or expired.");
        setInvite(d);
        if (d.email) setEmail(d.email);
      })
      .catch((e: Error) => setInvalid(e.message));
  }, [token]);

  if (invalid)
    return (
      <Shell title="Invite not valid" sub={invalid}>
        <a href="#/" className="text-[13px] text-accent">
          Go to sign in →
        </a>
      </Shell>
    );

  return (
    <Shell title="Join the team" sub={invite ? `You're invited as ${invite.role}. Create your account to continue.` : "Checking your invite…"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const res = await post<{ token: string; user: SessionUser }>(`/auth/invite/${token}`, { name, email, password });
            setSession(res.token, res.user);
            onDone();
          });
        }}
      >
        <input className={field} autoFocus placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} type="email" autoComplete="email" placeholder="Email" value={email} disabled={!!invite?.email} onChange={(e) => setEmail(e.target.value)} />
        <input className={field} type="password" autoComplete="new-password" placeholder="Password (min. 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox error={error} />
        <Submit busy={busy} label="Create account" disabled={!invite || !email || password.length < 8} />
      </form>
    </Shell>
  );
}

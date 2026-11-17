import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, Copy, Link2, Loader2, Trash2, UserPlus } from "lucide-react";
import { getSessionUser, setSession, useSessionUser, type SessionUser } from "../lib/session";
import { teamFetch } from "../lib/team";
import { IntegrationsSettings } from "./IntegrationsSettings";

type Tab = "profile" | "team" | "shares" | "alerts" | "integrations";
interface Member { id: string; email: string; name: string; role: SessionUser["role"]; lastLoginAt: string | null }
interface Invite { id: string; email: string | null; role: string; expiresAt: string }
interface Share { id: string; label: string; minScore: number; expiresAt: string | null; lastViewedAt: string | null; createdAt: string }

const base = () => `${window.location.origin}${window.location.pathname}`;
const field = "h-[36px] w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60";
const ROLE_HINT: Record<string, string> = { owner: "Everything, incl. team", member: "Work with leads, router, settings", viewer: "Read only" };

function CopyBox({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
      <code className="num min-w-0 flex-1 truncate text-[12.5px]">{value}</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[12px] text-muted hover:text-fg"
      >
        {done ? <Check size={12} className="text-success" /> : <Copy size={12} />} {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-4">
        <div className="text-[14px] font-medium">{title}</div>
        {sub && <div className="text-[12.5px] text-muted">{sub}</div>}
      </div>
      {children}
    </section>
  );
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <div className={`mt-3 rounded-lg border px-3 py-2 text-[12.5px] ${msg.ok ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>{msg.text}</div> : null;
}

function Profile() {
  const user = useSessionUser();
  const [name, setName] = useState(user?.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!user?.id) return <Card title="Profile" sub="You're using the team password. Create the owner account to get a personal profile." children={null} />;
  return (
    <Card title="Profile" sub={`${user.email} · ${user.role}`}>
      <form
        className="max-w-md space-y-2.5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            const res = await teamFetch<{ user: SessionUser; token: string }>("/auth/me", { method: "PATCH", body: JSON.stringify({ name, currentPassword: current, newPassword: next || undefined }) });
            setSession(res.token, res.user);
            setCurrent("");
            setNext("");
            setMsg({ ok: true, text: next ? "Saved. Other devices were signed out." : "Saved." });
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-[12px] text-faint">Name</label>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="block pt-2 text-[12px] text-faint">Change password (optional)</label>
        <input className={field} type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className={field} type="password" autoComplete="new-password" placeholder="New password (min. 8)" value={next} onChange={(e) => setNext(e.target.value)} />
        <button disabled={busy} className="mt-1 inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-fg px-4 text-[13px] font-medium text-bg disabled:opacity-40">
          {busy && <Loader2 size={13} className="animate-spin" />} Save
        </button>
        <Msg msg={msg} />
      </form>
    </Card>
  );
}

function Team() {
  const me = useSessionUser();
  const isOwner = me?.role === "owner";
  const [data, setData] = useState<{ users: Member[]; invites: Invite[] } | null>(null);
  const [role, setRole] = useState("member");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => teamFetch<{ users: Member[]; invites: Invite[] }>("/team").then(setData, (e) => setMsg({ ok: false, text: (e as Error).message })), []);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Team members" sub="Everyone signs in with their own email and password.">
        <ul className="divide-y divide-line rounded-lg border border-line">
          {(data?.users ?? []).map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="grid size-8 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{u.name.slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">
                  {u.name} {u.id === me?.id && <span className="text-[11.5px] font-normal text-faint">(you)</span>}
                </div>
                <div className="truncate text-[12px] text-muted">{u.email}</div>
              </div>
              {isOwner && u.id !== me?.id ? (
                <>
                  <select value={u.role} onChange={(e) => act(() => teamFetch(`/team/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }))} className="h-[30px] rounded-lg border border-line bg-bg px-2 text-[12.5px]">
                    <option value="owner">Owner</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  {u.role !== "owner" && (
                    <select
                      value={(u as { access?: string }).access ?? "all"}
                      onChange={(e) => act(() => teamFetch(`/team/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ access: e.target.value }) }))}
                      className="h-[30px] rounded-lg border border-line bg-bg px-2 text-[12.5px]"
                      title="Which part of the app this person can use"
                      aria-label={`${u.name} access`}
                    >
                      <option value="all">Sales + Delivery</option>
                      <option value="sales">Sales only</option>
                      <option value="delivery">Delivery only</option>
                    </select>
                  )}
                  <button onClick={() => window.confirm(`Remove ${u.name} from the team?`) && act(() => teamFetch(`/team/users/${u.id}`, { method: "DELETE" }))} className="text-faint hover:text-danger" aria-label={`Remove ${u.name}`}>
                    <Trash2 size={14} />
                  </button>
                </>
              ) : (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] capitalize text-muted ring-1 ring-line ring-inset">{u.role}</span>
              )}
            </li>
          ))}
          {!data && <li className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-surface-2" /></li>}
        </ul>
        <Msg msg={msg} />
      </Card>

      {isOwner && (
        <Card title="Invite a teammate" sub="Creates a one-time link valid for 7 days. Send it on Slack, email or Telegram.">
          <div className="flex flex-wrap gap-2">
            <input className={`${field} max-w-xs flex-1`} type="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value)} className="h-[36px] rounded-lg border border-line bg-bg px-2 text-[13px]" title={ROLE_HINT[role]}>
              <option value="member">Member — {ROLE_HINT.member}</option>
              <option value="viewer">Viewer — {ROLE_HINT.viewer}</option>
              <option value="owner">Owner — {ROLE_HINT.owner}</option>
            </select>
            <button
              onClick={() =>
                act(async () => {
                  const res = await teamFetch<{ token: string }>("/team/invites", { method: "POST", body: JSON.stringify({ email, role }) });
                  setLink(`${base()}#/invite/${res.token}`);
                  setEmail("");
                })
              }
              className="inline-flex h-[36px] items-center gap-1.5 rounded-[7px] bg-fg px-3.5 text-[13px] font-medium text-bg"
            >
              <UserPlus size={14} /> Create invite link
            </button>
          </div>
          {link && (
            <div className="mt-3">
              <CopyBox value={link} />
              <p className="mt-1 text-[12px] text-faint">Shown once — copy it now.</p>
            </div>
          )}
          {!!data?.invites.length && (
            <ul className="mt-4 space-y-1 text-[12.5px] text-muted">
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  Pending: {i.email ?? "anyone with the link"} · {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  <button onClick={() => act(() => teamFetch(`/team/invites/${i.id}`, { method: "DELETE" }))} className="text-faint hover:text-danger">
                    cancel
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function Shares() {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [label, setLabel] = useState("");
  const [minScore, setMinScore] = useState("60");
  const [days, setDays] = useState("30");
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => teamFetch<{ shares: Share[] }>("/team/shares").then((d) => setShares(d.shares), (e) => setMsg({ ok: false, text: (e as Error).message })), []);
  useEffect(() => void load(), [load]);

  return (
    <Card title="View-only links" sub="Share leads with anyone — no account needed. They see scores and posts, not your notes, emails or pipeline.">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${field} max-w-[220px]`} placeholder="Label (e.g. For Marko)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
          Min score
          <input className="h-[36px] w-16 rounded-lg border border-line bg-bg px-2 text-[13px]" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} />
        </label>
        <select value={days} onChange={(e) => setDays(e.target.value)} className="h-[36px] rounded-lg border border-line bg-bg px-2 text-[13px]">
          <option value="7">Expires in 7 days</option>
          <option value="30">Expires in 30 days</option>
          <option value="0">Never expires</option>
        </select>
        <button
          onClick={async () => {
            setMsg(null);
            try {
              const res = await teamFetch<{ token: string }>("/team/shares", { method: "POST", body: JSON.stringify({ label, minScore: Number(minScore), days: Number(days) }) });
              setLink(`${base()}#/share/${res.token}`);
              setLabel("");
              await load();
            } catch (e) {
              setMsg({ ok: false, text: (e as Error).message });
            }
          }}
          className="inline-flex h-[36px] items-center gap-1.5 rounded-[7px] bg-fg px-3.5 text-[13px] font-medium text-bg"
        >
          <Link2 size={14} /> Create link
        </button>
      </div>
      {link && (
        <div className="mt-3">
          <CopyBox value={link} />
          <p className="mt-1 text-[12px] text-faint">Shown once — copy it now.</p>
        </div>
      )}
      <Msg msg={msg} />
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-[13px]">
        {(shares ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{s.label}</div>
              <div className="text-[12px] text-muted">
                Score ≥ {s.minScore} · {s.expiresAt ? `expires ${new Date(s.expiresAt).toLocaleDateString()}` : "no expiry"} · {s.lastViewedAt ? `last viewed ${new Date(s.lastViewedAt).toLocaleDateString()}` : "not viewed yet"}
              </div>
            </div>
            <button
              onClick={async () => {
                if (!window.confirm(`Revoke “${s.label}”? The link stops working immediately.`)) return;
                await teamFetch(`/team/shares/${s.id}`, { method: "DELETE" });
                await load();
              }}
              className="text-[12.5px] text-faint hover:text-danger"
            >
              Revoke
            </button>
          </li>
        ))}
        {shares?.length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-faint">No active links.</li>}
      </ul>
    </Card>
  );
}

export function SettingsPage({ initialTab = "profile", onOpenAlerts }: { initialTab?: Tab; onOpenAlerts: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const role = getSessionUser()?.role;
  const tabs: Array<[Tab, string]> = [
    ["profile", "Profile"],
    ["team", "Team"],
    ["integrations", "Integrations"],
    ["shares", "View-only links"],
    ["alerts", "Notifications"],
  ];
  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[13.5px] text-muted">Your profile, team access, integrations and sharing.</p>
      </div>
      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5 text-[13px]">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`h-[30px] rounded-md px-3 ${tab === k ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "profile" && <Profile />}
      {tab === "integrations" && <IntegrationsSettings />}
      {tab === "team" && (role === "viewer" ? <Card title="Team" sub="Only owners and members can see the team." children={null} /> : <Team />)}
      {tab === "shares" && (role === "viewer" ? <Card title="View-only links" sub="Viewers can't create links." children={null} /> : <Shares />)}
      {tab === "alerts" && (
        <Card title="Telegram notifications" sub="Choose which new leads are sent to Telegram.">
          <button onClick={onOpenAlerts} className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
            <BellRing size={14} /> Open alert settings
          </button>
        </Card>
      )}
    </>
  );
}

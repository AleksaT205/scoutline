import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Lock, Plus, Route, ShieldOff, X, Zap } from "lucide-react";
import { API_URL } from "../lib/api";
import { askConfirm } from "../lib/confirm";
import { input } from "../lib/ui";
import { ApiError, getTeamToken, setTeamToken, teamFetch, usd } from "../lib/team";

interface Client {
  id: string;
  name: string;
  email: string | null;
  keyPreview: string;
  monthlyBudgetUsd: number;
  defaultMode: "auto" | "fast" | "smart";
  status: "active" | "revoked";
  createdAt: string;
  spendUsd: number;
  requests: number;
  tokens: number;
  baselineUsd: number;
  savingsUsd: number;
  split: { fast: number; smart: number };
}
interface Overview {
  items: Client[];
  totals: { spendUsd: number; requests: number; baselineUsd: number; savingsUsd: number; activeClients: number };
  baseline: { inputPerM: number; outputPerM: number };
}
interface Usage {
  daily: Array<{ day: string; requests: number; spendUsd: number; baselineUsd: number }>;
  recent: Array<{ at: string; mode: string; model: string; tokens: number; spendUsd: number; baselineUsd: number; status: string | null }>;
}

const BASE_URL = `${API_URL}/llm/v1`;

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg"
    >
      {done ? <Check size={12} className="text-success" /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface px-4 py-4">
      {accent && <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_65%)]" />}
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="num mt-1.5 text-[28px] font-semibold leading-tight tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
}

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mx-auto mt-16 max-w-sm rounded-[14px] border border-line bg-surface p-6 text-center shadow-float"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setTeamToken(token);
        try {
          await teamFetch("/auth/check", { method: "POST" });
          onUnlock();
        } catch (err) {
          setTeamToken("");
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
        <Lock size={18} />
      </div>
      <div className="text-base font-semibold tracking-tight">Team access</div>
      <p className="mt-1 mb-4 text-[13px] text-muted">The AI Router shows client keys and spend. Enter the team password.</p>
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Team password"
        className="h-[34px] w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60"
      />
      {error && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}
      <button disabled={busy || !token} className="mt-3 inline-flex h-[34px] w-full items-center justify-center gap-1.5 rounded-lg bg-fg text-[13px] font-medium text-bg disabled:opacity-40">
        {busy && <Loader2 size={14} className="animate-spin" />} Unlock
      </button>
    </form>
  );
}

function NewClientDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [budget, setBudget] = useState("20");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; apiKey: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setCreated(null);
      setError(null);
    }
  }, [open]);
  if (!open) return null;

  const field = input;
  const close = () => {
    if (created) onCreated();
    onClose();
    setName("");
    setEmail("");
    setBudget("20");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={() => !busy && !created && close()}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-[520px] rounded-[14px] border border-line bg-surface p-5 shadow-float" role="dialog" aria-modal="true">
        <div className="mb-1 flex items-center">
          <h2 className="text-base font-semibold tracking-tight">{created ? "Client created" : "New client"}</h2>
          <button onClick={close} className="ml-auto text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {created ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted">
              Send these to <b className="text-fg">{created.name}</b>. Works with any OpenAI- or Anthropic-compatible SDK — just change the base URL and key.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> The API key is shown only once. Copy it now and share it securely.
            </div>
            {[
              ["Base URL", BASE_URL],
              ["API key", created.apiKey],
              ["Model", "auto"],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="mb-1 text-[11.5px] uppercase tracking-wider text-faint">{label}</div>
                <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                  <code className="num min-w-0 flex-1 truncate text-[12.5px]">{value}</code>
                  <CopyButton text={value!} />
                </div>
              </div>
            ))}
            <div className="flex justify-end pt-1">
              <button onClick={close} className="h-[34px] rounded-lg bg-fg px-4 text-[13px] font-medium text-bg">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-2.5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                const res = await teamFetch<{ apiKey: string; client: { name: string } }>("/router/clients", {
                  method: "POST",
                  body: JSON.stringify({ name, email, monthlyBudgetUsd: Number(budget) }),
                });
                setCreated({ name: res.client.name, apiKey: res.apiKey });
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="mb-2 text-[13px] text-muted">Creates a private API key with its own monthly budget. Spend stops automatically at the limit.</p>
            <input className={field} autoFocus placeholder="Client name (e.g. Acme Shop)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={field} type="email" placeholder="Contact email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label className="flex items-center gap-2">
              <span className="w-40 text-[13px] text-muted">Monthly budget (USD)</span>
              <input className={field} type="number" min={1} max={10000} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} />
            </label>
            {error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={close} className="h-[34px] rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
                Cancel
              </button>
              <button disabled={busy || !name.trim() || !(Number(budget) > 0)} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-fg px-3.5 text-[13px] font-medium text-bg disabled:opacity-40">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Create key
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SpendBars({ daily }: { daily: Usage["daily"] }) {
  const days = useMemo(() => {
    const map = new Map(daily.map((d) => [d.day, d]));
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
      return { day: d, spend: map.get(d)?.spendUsd ?? 0, baseline: map.get(d)?.baselineUsd ?? 0, requests: map.get(d)?.requests ?? 0 };
    });
  }, [daily]);
  const max = Math.max(...days.map((d) => d.baseline), 1e-9);
  return (
    <div className="flex h-24 items-end gap-[3px]" aria-label="Daily spend, last 30 days">
      {days.map((d) => (
        <div key={d.day} className="relative flex-1" style={{ height: "100%" }} title={`${d.day}: ${usd(d.spend)} spent · ${usd(d.baseline)} on premium · ${d.requests} requests`}>
          <div className="absolute bottom-0 w-full rounded-sm bg-line" style={{ height: `${(d.baseline / max) * 100}%` }} />
          <div className="absolute bottom-0 w-full rounded-sm bg-accent" style={{ height: `${Math.max(d.spend > 0 ? 3 : 0, (d.spend / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function ClientDetail({ client, onChanged }: { client: Client; onChanged: () => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [budget, setBudget] = useState(String(client.monthlyBudgetUsd));
  const [busy, setBusy] = useState<"budget" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUsage(null);
    setBudget(String(client.monthlyBudgetUsd));
    teamFetch<Usage>(`/router/clients/${client.id}/usage`).then(setUsage, (e) => setError((e as Error).message));
  }, [client.id, client.monthlyBudgetUsd]);

  const pct = Math.min(100, (client.spendUsd / client.monthlyBudgetUsd) * 100);
  const savedPct = client.baselineUsd > 0 ? Math.round((client.savingsUsd / client.baselineUsd) * 100) : 0;

  return (
    <aside className="rounded-xl border border-line bg-surface p-[18px] shadow-float xl:sticky xl:top-[72px]">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">{client.name.slice(0, 2).toUpperCase()}</div>
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-tight">{client.name}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {client.email ?? "No email"} · <span className="num">{client.keyPreview}</span>
          </div>
        </div>
        {client.status === "revoked" && <span className="ml-auto rounded-full bg-danger/10 px-2 py-0.5 text-[11px] text-danger">Revoked</span>}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-line bg-bg px-2.5 py-2">
          <div className="text-[11.5px] text-faint">Spent (month)</div>
          <div className="num text-[13px] font-medium">{usd(client.spendUsd)}</div>
        </div>
        <div className="rounded-lg border border-line bg-bg px-2.5 py-2">
          <div className="text-[11.5px] text-faint">Saved</div>
          <div className="num text-[13px] font-medium text-success">
            {usd(client.savingsUsd)} {savedPct > 0 && <span className="text-[11px]">({savedPct}%)</span>}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-bg px-2.5 py-2">
          <div className="text-[11.5px] text-faint">Requests</div>
          <div className="num text-[13px] font-medium">{client.requests.toLocaleString()}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-[11.5px] uppercase tracking-wider text-faint">
          Last 30 days
          <span className="flex items-center gap-2 normal-case tracking-normal">
            <span className="inline-flex items-center gap-1">
              <i className="size-2 rounded-sm bg-accent" /> spent
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="size-2 rounded-sm bg-line" /> on premium
            </span>
          </span>
        </div>
        {usage ? <SpendBars daily={usage.daily} /> : <div className="h-24 animate-pulse rounded-lg bg-surface-2" />}
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[11.5px] uppercase tracking-wider text-faint">Monthly budget</div>
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${pct > 90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted">$</span>
          <input
            type="number"
            min={1}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            disabled={client.status === "revoked"}
            className="num h-[34px] w-28 rounded-lg border border-line bg-bg px-2.5 text-[13px] outline-none focus:border-accent/60"
          />
          <button
            disabled={busy !== null || client.status === "revoked" || Number(budget) === client.monthlyBudgetUsd || !(Number(budget) > 0)}
            onClick={async () => {
              setBusy("budget");
              setError(null);
              try {
                await teamFetch(`/router/clients/${client.id}`, { method: "PATCH", body: JSON.stringify({ monthlyBudgetUsd: Number(budget) }) });
                onChanged();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium hover:bg-surface-2 disabled:opacity-40"
          >
            {busy === "budget" && <Loader2 size={12} className="animate-spin" />} Save
          </button>
          <span className="ml-auto text-[12px] text-faint">{Math.round(pct)}% used</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[11.5px] uppercase tracking-wider text-faint">Recent requests</div>
        {usage?.recent.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-bg text-[12.5px]">
            {usage.recent.slice(0, 6).map((r, i) => (
              <li key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className={`rounded px-1.5 py-px font-mono text-[10.5px] ${r.mode === "smart" ? "bg-accent-soft text-accent" : "bg-success-soft text-success"}`}>{r.mode}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{r.model}</span>
                <span className="num text-faint">{r.tokens.toLocaleString()} tok</span>
                <span className="num w-16 text-right">{usd(r.spendUsd)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-muted">{usage ? "No requests yet." : "Loading…"}</div>
        )}
      </div>

      {error && <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      {client.status === "active" && (
        <button
          disabled={busy !== null}
          onClick={async () => {
            if (!await askConfirm(`Revoke ${client.name}'s key? Their apps stop working immediately. History is kept.`)) return;
            setBusy("revoke");
            setError(null);
            try {
              await teamFetch(`/router/clients/${client.id}/revoke`, { method: "POST" });
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
          className="mt-4 inline-flex h-[34px] w-full items-center justify-center gap-1.5 rounded-lg border border-danger/40 text-[12.5px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40"
        >
          {busy === "revoke" ? <Loader2 size={12} className="animate-spin" /> : <ShieldOff size={13} />} Revoke key
        </button>
      )}
    </aside>
  );
}

const SNIPPETS: Record<string, string> = {
  curl: `curl ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer $CLIENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'`,
  "OpenAI SDK": `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: process.env.CLIENT_KEY,
});

const res = await client.chat.completions.create({
  model: "auto", // or "fast" / "smart"
  messages: [{ role: "user", content: "Hello" }],
});`,
  Python: `from openai import OpenAI

client = OpenAI(base_url="${BASE_URL}", api_key=CLIENT_KEY)
res = client.chat.completions.create(
    model="auto",  # or "fast" / "smart"
    messages=[{"role": "user", "content": "Hello"}],
)`,
};

export function RouterPage() {
  const [unlocked, setUnlocked] = useState(() => getTeamToken().length > 0);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [newOpen, setNewOpen] = useState(false);
  const [tab, setTab] = useState("OpenAI SDK");

  const load = useCallback(async () => {
    try {
      setData(await teamFetch<Overview>("/router/overview"));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setTeamToken("");
        setUnlocked(false);
      }
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (unlocked) void load();
  }, [unlocked, load]);

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />;

  const selected = data?.items.find((c) => c.id === selectedId) ?? data?.items[0];
  const t = data?.totals;
  const savedPct = t && t.baselineUsd > 0 ? Math.round((t.savingsUsd / t.baselineUsd) * 100) : 0;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">AI Router</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">One endpoint for your clients' apps. Simple requests go to fast models, complex ones to smart models — with spend tracked per client.</p>
        </div>
        <button onClick={() => setNewOpen(true)} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-fg px-3 text-[13px] font-medium text-bg hover:opacity-90 sm:ml-auto">
          <Plus size={14} /> New client
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Spent this month" value={t ? usd(t.spendUsd) : "—"} hint="Across all clients" />
        <Kpi label="Saved vs premium model" value={t ? usd(t.savingsUsd) : "—"} hint={savedPct ? `${savedPct}% cheaper than running everything on a premium model` : "Compared with GPT-4o-class pricing"} accent />
        <Kpi label="Requests this month" value={t ? t.requests.toLocaleString() : "—"} />
        <Kpi label="Active clients" value={t ? String(t.activeClients) : "—"} />
      </section>

      <section className="mb-5 rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Route size={15} className="text-accent" />
          <span className="text-[13.5px] font-medium">Endpoint</span>
          <code className="num ml-1 min-w-0 truncate rounded-md bg-bg px-2 py-1 text-[12.5px] ring-1 ring-line">{BASE_URL}</code>
          <CopyButton text={BASE_URL} />
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-faint">
            <Zap size={12} /> model <code className="num text-fg">auto</code> · <code className="num text-fg">fast</code> · <code className="num text-fg">smart</code>
          </span>
        </div>
        <div className="mb-2 inline-flex rounded-lg border border-line bg-bg p-0.5 text-[12.5px]">
          {Object.keys(SNIPPETS).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={`h-[28px] rounded-md px-2.5 ${tab === k ? "bg-surface text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
              {k}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre className="num overflow-x-auto rounded-lg border border-line bg-bg p-3 text-[12px] leading-relaxed text-muted">{SNIPPETS[tab]}</pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={SNIPPETS[tab]!} />
          </div>
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {data && data.items.length === 0 ? (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div className="mb-3 grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
                <KeyRound size={18} />
              </div>
              <div className="text-sm font-medium">No clients yet</div>
              <p className="mt-1 max-w-sm text-[13px] text-muted">Create a client to get a private API key with its own budget. Their apps use your endpoint instead of OpenAI or Anthropic directly.</p>
              <button onClick={() => setNewOpen(true)} className="mt-4 inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-fg px-3 text-[13px] font-medium text-bg">
                <Plus size={14} /> New client
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-faint">
                    <th className="px-3 py-2.5 font-medium">Client</th>
                    <th className="px-3 py-2.5 font-medium">Budget</th>
                    <th className="px-3 py-2.5 font-medium">Requests</th>
                    <th className="hidden px-3 py-2.5 font-medium md:table-cell">Fast / Smart</th>
                    <th className="px-3 py-2.5 font-medium">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((c) => {
                    const pct = Math.min(100, (c.spendUsd / c.monthlyBudgetUsd) * 100);
                    const total = c.split.fast + c.split.smart;
                    const sel = c.id === selected?.id;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className={`cursor-pointer border-b border-line transition-colors last:border-0 ${sel ? "bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-2"} ${c.status === "revoked" ? "opacity-50" : ""}`}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{c.name}</div>
                          <div className="num text-xs text-muted">{c.keyPreview}</div>
                        </td>
                        <td className="w-44 px-3 py-2.5">
                          <div className="num mb-1 text-[12px] text-muted">
                            {usd(c.spendUsd)} <span className="text-faint">/ {usd(c.monthlyBudgetUsd)}</span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                            <div className={`h-full rounded-full ${pct > 90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-accent"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="num px-3 py-2.5">{c.requests.toLocaleString()}</td>
                        <td className="hidden px-3 py-2.5 md:table-cell">
                          {total ? (
                            <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" title={`${c.split.fast} fast · ${c.split.smart} smart`}>
                              <div className="bg-success" style={{ width: `${(c.split.fast / total) * 100}%` }} />
                              <div className="bg-accent" style={{ width: `${(c.split.smart / total) * 100}%` }} />
                            </div>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="num px-3 py-2.5 text-success">{usd(c.savingsUsd)}</td>
                      </tr>
                    );
                  })}
                  {!data &&
                    [0, 1, 2].map((i) => (
                      <tr key={i} className="border-b border-line">
                        <td colSpan={5} className="px-3 py-3">
                          <div className="h-4 animate-pulse rounded bg-surface-2" />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {selected && <ClientDetail client={selected} onChanged={load} />}
      </div>

      <p className="mt-4 text-[12px] text-faint">
        Spend is calculated by LiteLLM at the providers' list prices — on free tiers (Groq, Gemini free, OpenRouter :free) nothing is actually billed. “Saved” compares with a premium model at ${data?.baseline.inputPerM ?? 2.5} / ${data?.baseline.outputPerM ?? 10} per 1M input / output tokens.
      </p>

      <NewClientDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={load} />
    </>
  );
}

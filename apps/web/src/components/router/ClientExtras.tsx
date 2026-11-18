import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, ShieldOff, UserPlus } from "lucide-react";
import { API_URL } from "../../lib/api";
import { askConfirm } from "../../lib/confirm";
import { getTeamToken, teamFetch, usd } from "../../lib/team";
import { btnSm, btnSmPrimary, input } from "../../lib/ui";
import { CopyButton, ErrorNote, Toggle } from "./shared";

/** Detalj klijenta u AI Router-u: dozvole (poverljivost, grupe, shadow, maskiranje), ključevi inženjera, mesečni CSV. */

export interface RouterClient {
  id: string;
  name: string;
  status: "active" | "revoked";
  monthlyBudgetUsd: number;
  confidential: boolean;
  allowedGroups: string[];
  effectiveGroups: string[];
  shadow: boolean;
  maskSecrets: boolean;
}

const GROUPS = [
  ["fast", "fast", "Free cloud tier — quick answers"],
  ["smart", "smart", "Free cloud tier — stronger model"],
  ["local", "local", "Ollama on your server — data never leaves it"],
] as const;

export function ClientSettings({ client, onChanged }: { client: RouterClient; onChanged: () => void }) {
  const [s, setS] = useState({ confidential: client.confidential, allowedGroups: client.allowedGroups, shadow: client.shadow, maskSecrets: client.maskSecrets });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setS({ confidential: client.confidential, allowedGroups: client.allowedGroups, shadow: client.shadow, maskSecrets: client.maskSecrets }), [client]);
  const dirty = JSON.stringify(s) !== JSON.stringify({ confidential: client.confidential, allowedGroups: client.allowedGroups, shadow: client.shadow, maskSecrets: client.maskSecrets });
  const disabled = client.status === "revoked";
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await teamFetch(`/router/clients/${client.id}`, { method: "PATCH", body: JSON.stringify(s) });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <Toggle
        label="Confidential client"
        hint="Only private models (local). Free cloud tiers may train on data, so this client never uses them."
        checked={s.confidential}
        disabled={disabled}
        onChange={(v) => setS((x) => ({ ...x, confidential: v, allowedGroups: v ? ["local"] : x.allowedGroups.filter((g) => g !== "local").length ? x.allowedGroups : ["fast", "smart"] }))}
      />
      <div>
        <div className="mb-1.5 text-[12px] text-muted">Allowed model groups</div>
        <div className="flex flex-wrap gap-1.5">
          {GROUPS.map(([g, label, hint]) => {
            const on = s.allowedGroups.includes(g);
            const locked = s.confidential && g !== "local";
            return (
              <button
                key={g}
                type="button"
                title={locked ? "Confidential clients can't use free cloud tiers" : hint}
                disabled={disabled || locked}
                onClick={() => setS((x) => ({ ...x, allowedGroups: on ? x.allowedGroups.filter((y) => y !== g) : [...x.allowedGroups, g] }))}
                className={`h-[28px] rounded-md border px-2.5 font-mono text-[12px] disabled:opacity-40 ${on && !locked ? "border-accent/60 bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg"}`}
                aria-pressed={on && !locked}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[12px] text-faint">Enforced on the key itself (LiteLLM), not only here. Local works once Ollama runs on the server.</p>
      </div>
      <Toggle label="Shadow mode" hint="Send requests as asked and only record what the router would choose — to show savings before switching on." checked={s.shadow} disabled={disabled} onChange={(v) => setS((x) => ({ ...x, shadow: v }))} />
      <Toggle label="Mask secrets" hint="Replace API keys, tokens and .env passwords with [REDACTED] before a request reaches a free cloud tier." checked={s.maskSecrets} disabled={disabled} onChange={(v) => setS((x) => ({ ...x, maskSecrets: v }))} />
      <ErrorNote text={error} />
      {dirty && (
        <div className="flex justify-end gap-2">
          <button onClick={() => setS({ confidential: client.confidential, allowedGroups: client.allowedGroups, shadow: client.shadow, maskSecrets: client.maskSecrets })} className={btnSm}>
            Reset
          </button>
          <button onClick={() => void save()} disabled={busy || (!s.confidential && !s.allowedGroups.length)} className={btnSmPrimary}>
            {busy && <Loader2 size={12} className="animate-spin" />} Save
          </button>
        </div>
      )}
    </div>
  );
}

interface Member {
  id: string;
  name: string;
  email: string | null;
  keyPreview: string;
  monthlyBudgetUsd: number;
  status: "active" | "revoked";
  spendUsd: number;
  requests: number;
}

export function ClientMembers({ client }: { client: RouterClient }) {
  const [list, setList] = useState<Member[] | null>(null);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("5");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; apiKey: string } | null>(null);
  const load = useCallback(async () => {
    try {
      setList((await teamFetch<{ members: Member[] }>(`/router/clients/${client.id}/members`)).members);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [client.id]);
  useEffect(() => {
    setCreated(null);
    setList(null);
    void load();
  }, [load]);
  const add = async () => {
    setBusy("add");
    setError(null);
    try {
      const r = await teamFetch<{ apiKey: string; member: { name: string } }>(`/router/clients/${client.id}/members`, { method: "POST", body: JSON.stringify({ name, monthlyBudgetUsd: Number(budget) }) });
      setCreated({ name: r.member.name, apiKey: r.apiKey });
      setName("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (m: Member) => {
    if (!(await askConfirm(`Revoke ${m.name}'s key? It stops working immediately.`))) return;
    setBusy(m.id);
    try {
      await teamFetch(`/router/members/${m.id}/revoke`, { method: "POST" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const active = (list ?? []).filter((m) => m.status === "active");
  return (
    <div className="space-y-2">
      {created && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5">
          <div className="flex items-start gap-2 text-[12px] text-warning">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Key for {created.name} — shown only once.
          </div>
          <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5">
            <code className="num min-w-0 flex-1 truncate text-[12px]">{created.apiKey}</code>
            <CopyButton text={created.apiKey} />
          </div>
        </div>
      )}
      {active.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-bg text-[13px]">
          {active.map((m) => {
            const pct = Math.min(100, (m.spendUsd / m.monthlyBudgetUsd) * 100);
            return (
              <li key={m.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.name}</div>
                  <div className="num text-[11px] text-faint">
                    {m.keyPreview} · {m.requests} req
                  </div>
                </div>
                <div className="w-24 shrink-0">
                  <div className="num text-right text-[11px] text-muted">
                    {usd(m.spendUsd)} / {usd(m.monthlyBudgetUsd)}
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className={`h-full rounded-full ${pct > 90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-accent"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <button onClick={() => void revoke(m)} disabled={busy !== null} className="grid size-[28px] shrink-0 place-items-center rounded-md text-muted hover:bg-danger/10 hover:text-danger" aria-label={`Revoke ${m.name}'s key`} title="Revoke key">
                  {busy === m.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldOff size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        list && <p className="text-[12px] text-muted">No engineer keys yet. Give each engineer their own key and budget (e.g. for Claude Code); the client budget still caps the total.</p>
      )}
      {client.status === "active" && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input className={`${input} min-w-0 flex-1`} placeholder="Engineer name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Engineer name" />
          <div className="flex items-center gap-1">
            <span className="text-[13px] text-muted">$</span>
            <input className={`${input} num w-20`} type="number" min={1} max={client.monthlyBudgetUsd} value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Monthly budget (USD)" />
          </div>
          <button disabled={busy !== null || !name.trim() || !(Number(budget) > 0)} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-40">
            {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Add key
          </button>
        </form>
      )}
      <ErrorNote text={error} />
    </div>
  );
}

/** Preuzimanje mesečnog CSV izveštaja (sa prijavom). */
export function ReportButton({ client }: { client: { id: string; name: string } }) {
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const download = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/router/clients/${client.id}/report.csv?month=${month}`, { headers: { Authorization: `Bearer ${getTeamToken()}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-usage-${client.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="num h-[28px] rounded-md border border-line bg-bg px-2 text-[12px] outline-none focus:border-accent/60" aria-label="Report month" />
      <button onClick={() => void download()} disabled={busy} className={btnSm}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Monthly report (CSV)
      </button>
    </div>
  );
}


import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Check, FlaskConical, History, Loader2, Pencil, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { REQUEST_CLASSES, describeCondition, type RuleCondition } from "@radar/shared";
import { askConfirm } from "../../lib/confirm";
import { teamFetch } from "../../lib/team";
import { Badge, Card, EmptyState, Select, btnPrimary, btnSecondary, btnSm, btnSmPrimary, input, select } from "../../lib/ui";
import { ErrorNote, GroupTag, pctText, when } from "./shared";

/** AI Router → Rules: aktivna pravila, predlozi iz statistike, verzije i probni zahtev. */

export interface Rule {
  id: string;
  clientId: string | null;
  clientName: string | null;
  lineage: string;
  version: number;
  key: string | null;
  name: string;
  condition: RuleCondition;
  target: string;
  priority: number;
  status: "proposed" | "active" | "archived" | "rejected";
  reason: string | null;
  createdBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  stats: { requests: number; failed: number; lastAt: string | null };
}
interface ClientOpt {
  id: string;
  name: string;
}

type Tri = "any" | "yes" | "no";
const tri = (v: boolean | undefined): Tri => (v === undefined ? "any" : v ? "yes" : "no");
const fromTri = (v: Tri) => (v === "any" ? undefined : v === "yes");

interface Draft {
  id?: string;
  clientId: string;
  name: string;
  priority: string;
  target: string;
  model: string;
  keywords: string;
  minChars: string;
  maxChars: string;
  tools: Tri;
  agent: Tri;
  requestClass: string[];
}
const emptyDraft: Draft = { clientId: "", name: "", priority: "100", target: "smart", model: "", keywords: "", minChars: "", maxChars: "", tools: "any", agent: "any", requestClass: [] };
const toDraft = (r: Rule): Draft => ({
  id: r.id,
  clientId: r.clientId ?? "",
  name: r.name,
  priority: String(r.priority),
  target: r.target,
  model: r.condition.model ?? "",
  keywords: r.condition.keywords ?? "",
  minChars: r.condition.minChars?.toString() ?? "",
  maxChars: r.condition.maxChars?.toString() ?? "",
  tools: tri(r.condition.tools),
  agent: tri(r.condition.agent),
  requestClass: r.condition.requestClass ?? [],
});
function toCondition(d: Draft): RuleCondition {
  const c: RuleCondition = {};
  if (d.model.trim()) c.model = d.model.trim();
  if (d.keywords.trim()) c.keywords = d.keywords.trim();
  if (d.minChars.trim()) c.minChars = Number(d.minChars);
  if (d.maxChars.trim()) c.maxChars = Number(d.maxChars);
  const t = fromTri(d.tools);
  if (t !== undefined) c.tools = t;
  const a = fromTri(d.agent);
  if (a !== undefined) c.agent = a;
  if (d.requestClass.length) c.requestClass = d.requestClass;
  return c;
}

function RuleForm({ draft, clients, onCancel, onSaved }: { draft: Draft; clients: ClientOpt[]; onCancel: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const cond = toCondition(d);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name: d.name, priority: Number(d.priority), target: d.target, condition: cond, ...(d.id ? {} : { clientId: d.clientId || null }) };
      await teamFetch(d.id ? `/router/rules/${d.id}` : "/router/rules", { method: d.id ? "PATCH" : "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const triSel = (k: "tools" | "agent", label: string) => (
    <label className="block">
      <span className="mb-1 block text-[12px] text-muted">{label}</span>
      <Select value={d[k]} onChange={(e) => set(k, e.target.value as Tri)} className={`${select} w-full`} aria-label={label}>
        <option value="any">Any</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </Select>
    </label>
  );
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-surface p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[14px] font-semibold">{d.id ? "Edit rule (saves a new version)" : "New rule"}</h3>
        <button onClick={onCancel} className="ml-auto text-muted hover:text-fg" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_110px_140px]">
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Name</span>
          <input className={input} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Long code reviews → smart" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Priority</span>
          <input className={`${input} num`} type="number" min={0} value={d.priority} onChange={(e) => set("priority", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Send to</span>
          <Select value={d.target} onChange={(e) => set("target", e.target.value)} className={`${select} w-full`} aria-label="Send to">
            <option value="fast">fast</option>
            <option value="smart">smart</option>
            <option value="local">local (private)</option>
          </Select>
        </label>
      </div>
      {!d.id && (
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Applies to</span>
          <Select value={d.clientId} onChange={(e) => set("clientId", e.target.value)} className={`${select} w-full sm:w-72`} aria-label="Applies to">
            <option value="">All clients (global)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <div className="rounded-lg border border-line bg-bg p-3">
        <div className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">When (all must match)</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Requested model matches (regex)</span>
            <input className={`${input} num`} value={d.model} onChange={(e) => set("model", e.target.value)} placeholder="opus|sonnet" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Prompt text matches (regex)</span>
            <input className={`${input} num`} value={d.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="\\b(refactor|debug)\\b" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Prompt at least (chars)</span>
            <input className={`${input} num`} type="number" min={0} value={d.minChars} onChange={(e) => set("minChars", e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Prompt at most (chars)</span>
            <input className={`${input} num`} type="number" min={0} value={d.maxChars} onChange={(e) => set("maxChars", e.target.value)} />
          </label>
          {triSel("tools", "Has tools")}
          {triSel("agent", "From an agent (Claude Code…)")}
        </div>
        <div className="mt-3">
          <span className="mb-1 block text-[12px] text-muted">Agent request class</span>
          <div className="flex flex-wrap gap-1.5">
            {REQUEST_CLASSES.map((rc) => {
              const on = d.requestClass.includes(rc);
              return (
                <button
                  key={rc}
                  type="button"
                  onClick={() => set("requestClass", on ? d.requestClass.filter((x) => x !== rc) : [...d.requestClass, rc])}
                  className={`h-[28px] rounded-md border px-2.5 font-mono text-[12px] ${on ? "border-accent/60 bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg"}`}
                  aria-pressed={on}
                >
                  {rc}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="text-[12px] text-muted">
        Summary: <span className="text-fg">{describeCondition(cond)}</span> → <GroupTag g={d.target} />. Lower priority runs first; client rules run before global ones.
      </p>
      <ErrorNote text={error} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={btnSecondary}>
          Cancel
        </button>
        <button onClick={() => void save()} disabled={busy || !d.name.trim()} className={btnPrimary}>
          {busy && <Loader2 size={14} className="animate-spin" />} {d.id ? "Save new version" : "Create rule"}
        </button>
      </div>
    </div>
  );
}

function TestBox({ clients }: { clients: ClientOpt[] }) {
  const [t, setT] = useState({ model: "auto", text: "", requestClass: "", agent: false, tools: false, clientId: "" });
  const [res, setRes] = useState<{ chosen: string | null; applied: string | null; rule: { name: string } | null; blocked: string | null; features: { chars: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setRes(await teamFetch("/router/rules/test", { method: "POST", body: JSON.stringify({ ...t, clientId: t.clientId || undefined }) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Test a request" sub="See which rule would apply. Nothing is sent to a model.">
      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
        <input className={`${input} num`} value={t.model} onChange={(e) => setT({ ...t, model: e.target.value })} placeholder="Model (auto)" aria-label="Requested model" />
        <input className={input} value={t.text} onChange={(e) => setT({ ...t, text: e.target.value })} placeholder="Prompt text" aria-label="Prompt text" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select value={t.requestClass} onChange={(e) => setT({ ...t, requestClass: e.target.value })} className={select} aria-label="Request class">
          <option value="">No request class</option>
          {REQUEST_CLASSES.map((rc) => (
            <option key={rc} value={rc}>
              {rc}
            </option>
          ))}
        </Select>
        <Select value={t.clientId} onChange={(e) => setT({ ...t, clientId: e.target.value })} className={select} aria-label="Client">
          <option value="">Any client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-1.5 text-[13px] text-muted">
          <input type="checkbox" checked={t.agent} onChange={(e) => setT({ ...t, agent: e.target.checked })} /> Agent
        </label>
        <label className="inline-flex items-center gap-1.5 text-[13px] text-muted">
          <input type="checkbox" checked={t.tools} onChange={(e) => setT({ ...t, tools: e.target.checked })} /> Tools
        </label>
        <button onClick={() => void run()} disabled={busy} className={`${btnSm} sm:ml-auto`}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />} Test
        </button>
      </div>
      {res && (
        <div className="mt-3 rounded-lg border border-line bg-bg px-3 py-2 text-[13px]">
          {res.blocked ? (
            <span className="text-danger">{res.blocked}</span>
          ) : (
            <span>
              Goes to <GroupTag g={res.applied} /> {res.applied !== res.chosen && <span className="text-muted">(router chose {res.chosen})</span>} · {res.rule ? <>rule “{res.rule.name}”</> : "no rule matched (default fast)"} ·{" "}
              <span className="num text-faint">{res.features.chars.toLocaleString()} chars</span>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

export function RulesPanel({ clients }: { clients: ClientOpt[] }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRules((await teamFetch<{ rules: Rule[] }>("/router/rules")).rules);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const act = async (id: string, path: string, confirmText?: string) => {
    if (confirmText && !(await askConfirm(confirmText))) return;
    setBusy(id + path);
    try {
      await teamFetch(`/router/rules/${id}/${path}`, { method: "POST" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const active = useMemo(() => (rules ?? []).filter((r) => r.status === "active").sort((a, b) => (a.clientId === b.clientId ? a.priority - b.priority : a.clientId ? -1 : 1)), [rules]);
  const proposals = (rules ?? []).filter((r) => r.status === "proposed");
  const versions = (lineage: string) => (rules ?? []).filter((r) => r.lineage === lineage && r.status !== "proposed").sort((a, b) => b.version - a.version);

  return (
    <div className="space-y-4">
      <ErrorNote text={error} />
      {proposals.length > 0 && (
        <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles size={14} className="text-accent" /> Suggested changes</span>} sub="From the last 7 days of router decisions — no AI involved. Nothing changes until you approve.">
          <ul className="space-y-2">
            {proposals.map((p) => {
              const cur = active.find((a) => a.lineage === p.lineage);
              return (
                <li key={p.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-bg p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">
                      {p.name}: {cur ? <GroupTag g={cur.target} /> : null} → <GroupTag g={p.target} />
                    </div>
                    <p className="mt-1 text-[12px] text-muted">{p.reason}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => void act(p.id, "reject")} disabled={!!busy} className={btnSm}>
                      <X size={12} /> Reject
                    </button>
                    <button onClick={() => void act(p.id, "approve")} disabled={!!busy} className={btnSmPrimary}>
                      {busy === p.id + "approve" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {draft && <RuleForm key={draft.id ?? "new"} draft={draft} clients={clients} onCancel={() => setDraft(null)} onSaved={() => (setDraft(null), void load())} />}

      <Card
        title="Routing rules"
        sub="The first matching rule decides where a request goes. Rules run in code — no extra model calls, no tokens."
        actions={
          <button onClick={() => setDraft({ ...emptyDraft })} className={btnSm}>
            <Plus size={12} /> New rule
          </button>
        }
      >
        {rules === null ? (
          <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
        ) : active.length === 0 ? (
          <EmptyState title="No active rules" text="Every request goes to fast. Add a rule to send some requests to smart or local." />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-line text-left text-[12px] text-faint">
                  <th className="w-14 px-4 py-2 font-medium sm:pl-5">#</th>
                  <th className="px-2 py-2 font-medium">Rule</th>
                  <th className="w-20 px-2 py-2 font-medium">Send to</th>
                  <th className="w-28 px-2 py-2 font-medium">Last 7 days</th>
                  <th className="w-32 px-4 py-2 sm:pr-5" />
                </tr>
              </thead>
              <tbody>
                {active.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-line align-top last:border-0">
                      <td className="num px-4 py-2.5 text-muted sm:pl-5">{r.priority}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          {r.name}
                          {r.clientName && <Badge tone="accent">{r.clientName}</Badge>}
                          {r.version > 1 && <span className="text-[11px] font-normal text-faint">v{r.version}</span>}
                        </div>
                        <div className="mt-0.5 break-words text-[12px] text-muted">{describeCondition(r.condition)}</div>
                      </td>
                      <td className="px-2 py-2.5">
                        <GroupTag g={r.target} />
                      </td>
                      <td className="num px-2 py-2.5 text-[12px] text-muted">
                        {r.stats.requests ? (
                          <>
                            {r.stats.requests.toLocaleString()} req
                            {r.stats.failed > 0 && <span className="block text-danger">{pctText(r.stats.failed, r.stats.requests)} failed</span>}
                          </>
                        ) : (
                          <span className="text-faint">unused</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 sm:pr-5">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setDraft(toDraft(r))} className="grid size-[28px] place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Edit ${r.name}`} title="Edit">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setHistory(history === r.lineage ? null : r.lineage)} className="grid size-[28px] place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg" aria-label={`History of ${r.name}`} title="Versions">
                            <History size={13} />
                          </button>
                          <button onClick={() => void act(r.id, "archive", `Turn off “${r.name}”? You can restore it from its history.`)} className="grid size-[28px] place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger" aria-label={`Turn off ${r.name}`} title="Turn off">
                            <Archive size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {history === r.lineage && (
                      <tr className="border-b border-line bg-bg">
                        <td />
                        <td colSpan={4} className="px-2 py-2 pr-4 sm:pr-5">
                          <ul className="space-y-1">
                            {versions(r.lineage).map((v) => (
                              <li key={v.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                                <span className="num w-8 text-faint">v{v.version}</span>
                                <GroupTag g={v.target} />
                                <span className="min-w-0 flex-1 truncate text-muted">{describeCondition(v.condition)}</span>
                                <span className="text-faint">
                                  {v.status} · {v.decidedBy ?? v.createdBy ?? "system"} · {when(v.decidedAt ?? v.createdAt)}
                                </span>
                                {v.status === "archived" && (
                                  <button onClick={() => void act(v.id, "restore")} disabled={!!busy} className={btnSm}>
                                    <RotateCcw size={12} /> Restore
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rules && rules.some((r) => r.status === "archived" && !active.some((a) => a.lineage === r.lineage)) && (
          <details className="mt-3 text-[12px] text-muted">
            <summary className="cursor-pointer">Turned off rules</summary>
            <ul className="mt-2 space-y-1">
              {[...new Map(rules.filter((r) => r.status === "archived" && !active.some((a) => a.lineage === r.lineage)).map((r) => [r.lineage, r])).values()].map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <GroupTag g={r.target} /> <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <button onClick={() => void act(r.id, "restore")} className={btnSm}>
                    <RotateCcw size={12} /> Restore
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <TestBox clients={clients} />
    </div>
  );
}

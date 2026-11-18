import { useEffect, useState } from "react";
import { CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import { teamFetch } from "../../lib/team";
import { Card, btnSm } from "../../lib/ui";
import { ErrorNote, when } from "./shared";

/** AI Router → Audit: lanac heševa (izmene pravila, klijenata, pečati odluka) i provera lanca. */

interface Entry {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  entity: string | null;
  data: Record<string, unknown>;
  hash: string;
}
interface Check {
  ok: boolean;
  entries: number;
  sealedDecisions: number;
  prunedSeals: number;
  brokenAt?: number;
  problem?: string;
}

const LABEL: Record<string, string> = {
  "client.create": "Client created",
  "client.update": "Client changed",
  "client.revoke": "Client revoked",
  "member.create": "Engineer key created",
  "member.update": "Engineer budget changed",
  "member.revoke": "Engineer key revoked",
  "rule.create": "Rule created",
  "rule.update": "Rule changed",
  "rule.archive": "Rule turned off",
  "rule.restore": "Rule version restored",
  "rule.approve": "Suggestion approved",
  "rule.reject": "Suggestion rejected",
  "decisions.seal": "Router decisions sealed",
};

function summary(e: Entry): string {
  const d = e.data;
  if (e.action === "decisions.seal") return `${d.count} decisions (#${Number(d.fromId) + 1}–${d.toId})`;
  const parts = Object.entries(d)
    .filter(([k]) => !["from", "to", "id"].includes(k))
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.join(" · ").slice(0, 220);
}

export function AuditPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    teamFetch<{ entries: Entry[] }>("/router/audit").then(
      (r) => setEntries(r.entries),
      (e) => setError((e as Error).message),
    );
  }, []);
  const verify = async () => {
    setBusy(true);
    try {
      setCheck(await teamFetch<Check>("/router/audit/verify"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card
        title="Tamper-evident log"
        sub="Every rule, client and key change is chained by hash: changing or deleting any row breaks the chain. Router decisions are sealed into the chain every 15 minutes."
        actions={
          <button onClick={() => void verify()} disabled={busy} className={btnSm}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Verify chain
          </button>
        }
      >
        {check && (
          <div className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${check.ok ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>
            {check.ok ? <ShieldCheck size={15} className="mt-0.5 shrink-0" /> : <CircleAlert size={15} className="mt-0.5 shrink-0" />}
            <span>
              {check.ok
                ? `Chain is intact: ${check.entries} entries, ${check.sealedDecisions.toLocaleString()} sealed router decisions${check.prunedSeals ? ` (${check.prunedSeals} older seals past retention)` : ""}.`
                : `Chain broken at entry #${check.brokenAt}: ${check.problem}`}
            </span>
          </div>
        )}
        <ErrorNote text={error} />
        {entries === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
        ) : entries.length === 0 ? (
          <p className="text-[13px] text-muted">No entries yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-bg">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
                <span className="num w-12 text-[12px] text-faint">#{e.id}</span>
                <span className="font-medium">{LABEL[e.action] ?? e.action}</span>
                <span className="text-[12px] text-muted">{e.actor ?? "system"}</span>
                <span className="ml-auto text-[12px] text-faint">{when(e.at)}</span>
                <span className="basis-full break-words pl-[60px] text-[12px] text-muted">{summary(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

import { useEffect, useState } from "react";
import { AlarmClock, Check, Copy, ExternalLink, Loader2, Mail, Sparkles, X } from "lucide-react";
import { teamFetch } from "../lib/team";
import { Segmented } from "../lib/ui";
import type { UiLead } from "../data/demo";
import { ScoreRing, TypeBadge, daysLeft, flag, timeAgo } from "./ui";
import { NotesPanel, StatusBar } from "./LeadCrm";

function Signal({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-bg px-2.5 py-2">
      <div className="text-[11.5px] text-faint">{label}</div>
      <div className={`text-[13px] font-medium ${ok ? "text-success" : ""}`}>{value}</div>
    </div>
  );
}

function Label({ children, ai, rules }: { children: React.ReactNode; ai?: boolean; rules?: boolean }) {
  return (
    <div className="mb-2 flex items-center text-[11.5px] uppercase tracking-wider text-faint">
      {children}
      {ai && !rules && (
        <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 text-[11px] normal-case tracking-normal text-accent">
          <Sparkles size={10} /> AI
        </span>
      )}
      {ai && rules && (
        <span className="ml-1.5 inline-flex items-center rounded-full bg-surface-2 px-2 text-[11px] normal-case tracking-normal text-muted ring-1 ring-line ring-inset">
          Rules
        </span>
      )}
    </div>
  );
}

/** Isti oglas iz drugih izvora (sakriveni duplikati). */
function AlsoOn({ id }: { id: string }) {
  const [rows, setRows] = useState<Array<{ id: string; source: string; url: string | null }>>([]);
  useEffect(() => {
    setRows([]);
    teamFetch<{ related: Array<{ id: string; source: string; url: string | null }> }>(`/leads/${id}/related`)
      .then((d) => setRows(d.related))
      .catch(() => undefined);
  }, [id]);
  if (!rows.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
      <span className="text-faint">Also on</span>
      {rows.map((r) =>
        r.url ? (
          <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg">
            {r.source} <ExternalLink size={10} />
          </a>
        ) : (
          <span key={r.id}>{r.source}</span>
        ),
      )}
    </div>
  );
}

/** Podsetnik „javi se ponovo“: sutra / 3 dana / nedelja / datum. Kad stigne — Telegram i zvonce. */
function FollowUp({ lead, onUpdated }: { lead: UiLead; onUpdated: (l: UiLead) => void }) {
  const [busy, setBusy] = useState(false);
  const set = async (at: Date | null) => {
    setBusy(true);
    try {
      const r = await teamFetch<{ followUpAt: string | null }>(`/leads/${lead.id}/follow-up`, { method: "PATCH", body: JSON.stringify({ at: at?.toISOString() ?? null }) });
      onUpdated({ ...lead, followUpAt: r.followUpAt });
    } finally {
      setBusy(false);
    }
  };
  const inDays = (d: number) => {
    const x = new Date();
    x.setDate(x.getDate() + d);
    x.setHours(9, 0, 0, 0);
    return x;
  };
  const at = lead.followUpAt ? new Date(lead.followUpAt) : null;
  const due = at && at.getTime() <= Date.now();
  const chip = "inline-flex h-[28px] items-center rounded-md border border-line bg-surface px-2.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className={`mr-1 inline-flex items-center gap-1 text-[12px] ${due ? "font-medium text-warning" : "text-faint"}`}>
        <AlarmClock size={13} /> {at ? `${due ? "Follow up now" : "Follow up"} · ${at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Follow up"}
      </span>
      {at ? (
        <button onClick={() => void set(null)} disabled={busy} className={chip} aria-label="Clear the reminder">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} <span className="ml-1">Clear</span>
        </button>
      ) : (
        <>
          {([["Tomorrow", 1], ["3 days", 3], ["1 week", 7]] as const).map(([l, d]) => (
            <button key={l} onClick={() => void set(inDays(d))} disabled={busy} className={chip}>
              {l}
            </button>
          ))}
          <input
            type="date"
            aria-label="Pick a date"
            className={`${chip} w-[132px] bg-bg`}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => e.target.value && void set(new Date(`${e.target.value}T09:00:00`))}
          />
        </>
      )}
    </div>
  );
}

export function LeadDetail({ lead, live, onUpdated }: { lead: UiLead; live: boolean; onUpdated: (l: UiLead) => void }) {
  const [copied, setCopied] = useState(false);
  const [kind, setKind] = useState<"email" | "proposal">("email");
  const [lang, setLang] = useState<"en" | "sr">(() => (lead.country === "RS" || lead.country === "BA" || lead.country === "ME" ? "sr" : "en"));
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  useEffect(() => {
    setLang(lead.country === "RS" || lead.country === "BA" || lead.country === "ME" ? "sr" : "en");
    setDraftErr(null);
  }, [lead.id, lead.country]);
  const draft = async () => {
    setDrafting(true);
    setDraftErr(null);
    try {
      const r = await teamFetch<{ subject: string; body: string }>(`/leads/${lead.id}/draft`, { method: "POST", body: JSON.stringify({ kind, lang }) });
      onUpdated({ ...lead, email: { subject: r.subject, body: r.body } });
    } catch (e) {
      setDraftErr((e as Error).message);
    } finally {
      setDrafting(false);
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(`${lead.email.subject}\n\n${lead.email.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside className="rounded-xl border border-line bg-surface p-[18px] shadow-float xl:sticky xl:top-[72px]">
      <div className="flex items-start gap-3">
        <ScoreRing score={lead.score} size={64} stroke={5} />
        <div className="min-w-0">
          {lead.leadType && (
            <div className="mb-1">
              <TypeBadge type={lead.leadType} />
            </div>
          )}
          <div className="text-base font-semibold leading-snug tracking-tight">{lead.title}</div>
          <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
            <span>{lead.company}</span>
            <span>
              {flag(lead.country)} {lead.city}
            </span>
            <span>
              {lead.source} · {timeAgo(lead.postedMinutesAgo)}
            </span>
          </div>
        </div>
      </div>

      {live && <AlsoOn id={lead.id} />}
      <StatusBar lead={lead} live={live} onUpdated={onUpdated} />
      {live && <FollowUp lead={lead} onUpdated={onUpdated} />}

      <div className="mt-[18px]">
        <Label>Signals</Label>
        <div className="grid grid-cols-2 gap-2">
          <Signal label="Budget" value={lead.budgetLabel} />
          <Signal label="Remote" value={lead.remoteOk === true || lead.remoteOk === undefined ? `${lead.remote} ✓` : lead.remote} ok={lead.remoteOk === true || lead.remoteOk === undefined} />
          <Signal label={lead.companySize ? "Company size" : "Market"} value={lead.companySize ?? (lead.tier === "DOMESTIC" ? "Domestic" : (lead.tier ?? "Unknown"))} />
          {lead.deadline ? (
            <Signal
              label="Deadline"
              value={`${new Date(lead.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${(() => {
                const d = daysLeft(lead.deadline) ?? 0;
                return d < 0 ? "closed" : d === 0 ? "today" : `${d} days left`;
              })()}`}
              ok={(daysLeft(lead.deadline) ?? 0) > 14}
            />
          ) : (
            <Signal label="Urgency" value={lead.urgency} />
          )}
        </div>
      </div>

      <div className="mt-[18px]">
        <Label ai rules={lead.scoredBy === "rules"}>Why it fits</Label>
        <ul className="ml-4 list-disc space-y-1 text-[13px] leading-relaxed text-muted">
          {lead.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>

      <div className="mt-[18px]">
        <Label ai rules={lead.scoredBy === "rules"}>Suggested first email</Label>
        {live && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Segmented value={kind} onChange={setKind} options={[["email", "Email"], ["proposal", "Proposal"]]} />
            <Segmented value={lang} onChange={setLang} options={[["en", "EN"], ["sr", "SR"]]} />
            <button onClick={() => void draft()} disabled={drafting} className="ml-auto inline-flex h-[28px] items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-[12px] font-medium text-accent hover:opacity-90 disabled:opacity-60" title="Write it again from the lead and your organization (free AI models)">
              {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Write with AI
            </button>
          </div>
        )}
        {draftErr && <p className="mb-2 text-[12px] text-danger">{draftErr}</p>}
        <div className={`whitespace-pre-line rounded-[10px] border border-line bg-bg p-3 text-[12.5px] leading-relaxed text-muted ${drafting ? "opacity-50" : ""}`}>
          <div className="mb-1.5 font-medium text-fg">{lead.email.subject}</div>
          {lead.email.body}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={copy} className="inline-flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface text-[13px] font-medium hover:bg-surface-2">
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
        {lead.url && (
          <a href={lead.url} target="_blank" rel="noreferrer" className="inline-flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface text-[13px] font-medium hover:bg-surface-2">
            <ExternalLink size={14} /> {lead.leadType === "tender" ? "Notice" : lead.leadType === "intent" ? "Article" : "Post"}
          </a>
        )}
        <a
          href={`mailto:?subject=${encodeURIComponent(lead.email.subject)}&body=${encodeURIComponent(lead.email.body)}`}
          className="inline-flex h-[34px] flex-[1.4] items-center justify-center gap-1.5 rounded-lg bg-fg text-[13px] font-medium text-bg hover:opacity-90"
        >
          <Mail size={14} /> Open in mail
        </a>
      </div>
      <NotesPanel lead={lead} live={live} />
    </aside>
  );
}

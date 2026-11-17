import { useState } from "react";
import { Check, Copy, ExternalLink, Mail, Sparkles } from "lucide-react";
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

export function LeadDetail({ lead, live, onUpdated }: { lead: UiLead; live: boolean; onUpdated: (l: UiLead) => void }) {
  const [copied, setCopied] = useState(false);
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

      <StatusBar lead={lead} live={live} onUpdated={onUpdated} />

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
        <div className="rounded-[10px] border border-line bg-bg p-3 text-[12.5px] leading-relaxed text-muted">
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

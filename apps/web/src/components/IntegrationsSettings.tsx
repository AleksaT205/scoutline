import { useEffect, useState } from "react";
import { Bot, Check, GitBranch, Loader2, Mail, Send, ShieldCheck, Landmark, Plug } from "lucide-react";
import { teamFetch } from "../lib/team";
import { useSessionUser } from "../lib/session";

/** Bez automatskog popunjavanja (Chrome, 1Password, LastPass, Bitwarden): ovo su ključevi, ne prijava. */
const NO_AUTOFILL = { autoComplete: "new-password", "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": true, "data-form-type": "other", spellCheck: false } as const;

/** Settings → Integrations: lično (svako svoj GitHub) i firma (vlasnik: GitHub, Telegram, Email-in, SAM.gov). */
type Source = "app" | "server" | "none";
interface SecretView {
  set: boolean;
  hint?: string;
  readable?: boolean;
}
interface Workspace {
  canEdit: boolean;
  github: { token: SecretView; repo: string; source: Source; effectiveRepo: string };
  telegram: { botToken: SecretView; chatId: string; source: Source };
  imap: { host: string; port: number; user: string; mailbox: string; password: SecretView; source: Source; effectiveUser: string };
  sam: { apiKey: SecretView; source: Source };
  anthropic: { apiKey: SecretView; source: Source };
  figma: { token: SecretView; source: Source };
  claudeCode?: { token: SecretView; source: Source };
}
interface Mine {
  account: boolean;
  github?: SecretView & { login: string | null };
  agent?: "claude" | "codex";
  anthropic?: SecretView;
  figma?: SecretView;
  claudeCode?: SecretView;
}

const input = "h-[34px] w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-faint focus:border-accent/60 disabled:opacity-60";

function SourcePill({ source }: { source: Source }) {
  const m = { app: ["Connected", "bg-success-soft text-success ring-success/30"], server: ["From server settings", "bg-surface-2 text-muted ring-line"], none: ["Not connected", "bg-surface-2 text-faint ring-line"] }[source];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m[1]}`}>{m[0]}</span>;
}

function Note({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <div className={`mt-3 rounded-lg border px-3 py-2 text-[12.5px] ${msg.ok ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>{msg.text}</div>;
}

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  secret?: SecretView;
  value?: string;
  type?: string;
  half?: boolean;
}

/** Kartica jedne integracije firme: polja, Sačuvaj, Proveri vezu, Ukloni. */
function IntegrationCard({
  icon,
  title,
  desc,
  source,
  fields,
  canEdit,
  section,
  test,
  help,
  onSaved,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  source: Source;
  fields: Field[];
  canEdit: boolean;
  section: "github" | "telegram" | "imap" | "sam" | "anthropic" | "figma" | "claudeCode";
  test?: "github" | "telegram" | "imap";
  help?: React.ReactNode;
  onSaved: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setVals(Object.fromEntries(fields.filter((f) => !f.secret).map((f) => [f.key, f.value ?? ""]))), [JSON.stringify(fields.map((f) => f.value))]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (body: Record<string, unknown>, kind: "save" | "remove") => {
    setBusy(kind);
    setMsg(null);
    try {
      await teamFetch("/integrations", { method: "PUT", body: JSON.stringify({ [section]: body }) });
      setMsg({ ok: true, text: kind === "remove" ? "Removed. Server settings (if any) are used again." : "Saved — active within a minute, no redeploy needed." });
      setVals((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !fields.find((f) => f.key === k)?.secret)));
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted ring-1 ring-line">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium">{title}</span>
            <SourcePill source={source} />
          </div>
          <div className="text-[12.5px] text-muted">{desc}</div>
        </div>
      </div>
      <form autoComplete="off"
        className="grid gap-2.5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = {};
          for (const f of fields) if (vals[f.key] !== undefined && (!f.secret || vals[f.key]!.trim())) body[f.key] = vals[f.key];
          void save(body, "save");
        }}
      >
        {fields.map((f) => (
          <label key={f.key} className={f.half ? "" : "sm:col-span-2"}>
            <span className="mb-1 block text-[12px] text-muted">{f.label}</span>
            <input
              className={`${input} ${f.secret ? "num" : ""}`}
              type={f.secret ? "password" : (f.type ?? "text")}
              // Pregledač ne sme da upiše lozinku za prijavu u polja za ključeve (Chrome ignoriše "off" kod lozinki)
              {...NO_AUTOFILL}
              name={`integration-${section}-${f.key}`}
              disabled={!canEdit}
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              placeholder={f.secret?.set ? `Saved ${f.secret.hint ?? ""}${f.secret.readable === false ? " — can't be read, enter again" : ""} · leave empty to keep` : f.placeholder}
            />
          </label>
        ))}
        {help && <div className="text-[12px] leading-relaxed text-faint sm:col-span-2">{help}</div>}
        {canEdit && (
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button disabled={!!busy} className="inline-flex h-[32px] items-center gap-1.5 rounded-[7px] bg-fg px-3 text-[12.5px] font-medium text-bg disabled:opacity-50">
              {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
            </button>
            {test && (
              <button
                type="button"
                disabled={!!busy}
                onClick={async () => {
                  setBusy("test");
                  setMsg(null);
                  try {
                    const r = await teamFetch<{ ok: boolean; message: string }>(`/integrations/test/${test}`, { method: "POST", body: JSON.stringify(vals) });
                    setMsg({ ok: r.ok, text: r.message });
                  } catch (e) {
                    setMsg({ ok: false, text: (e as Error).message });
                  } finally {
                    setBusy(null);
                  }
                }}
                className="inline-flex h-[32px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-medium hover:bg-surface-2 disabled:opacity-50"
              >
                {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Test connection
              </button>
            )}
            {source === "app" && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => window.confirm(`Remove ${title} settings saved in the app?`) && void save(Object.fromEntries(fields.filter((f) => f.secret).map((f) => [f.key, null])), "remove")}
                className="ml-auto h-[32px] rounded-[7px] px-2 text-[12.5px] text-muted hover:text-danger"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </form>
      <Note msg={msg} />
    </section>
  );
}

function MyIntegrations() {
  const [me, setMe] = useState<Mine | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    teamFetch<Mine>("/integrations/me")
      .then(setMe)
      .catch(() => setMe({ account: false }));
  useEffect(() => {
    void load();
  }, []);
  const put = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await teamFetch<Mine>("/integrations/me", { method: "PUT", body: JSON.stringify(body) });
      setMe({ ...r, account: true });
      setToken("");
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  if (!me) return <div className="h-32 animate-pulse rounded-xl bg-surface-2" />;
  if (!me.account)
    return (
      <section className="rounded-xl border border-line bg-surface p-5 text-[13px] text-muted">Sign in with your own account (not the team password) to connect your personal GitHub and choose your AI agent.</section>
    );
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted ring-1 ring-line">
          <GitBranch size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium">Your GitHub</span>
            {me.github?.set ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success ring-1 ring-inset ring-success/30">Connected as {me.github.login ?? "?"}</span> : <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-faint ring-1 ring-inset ring-line">Not connected</span>}
          </div>
          <div className="text-[12.5px] text-muted">Issues you create and tasks you hand to Claude/Codex are opened under your name, in your repos. Without it, the workspace token is used.</div>
        </div>
      </div>
      <form autoComplete="off"
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) void put({ githubToken: token }, "GitHub connected.");
        }}
      >
        <input className={`${input} num min-w-[240px] flex-1`} type="password" {...NO_AUTOFILL} name="integration-personal-github" value={token} onChange={(e) => setToken(e.target.value)} placeholder={me.github?.set ? `Saved ${me.github.hint ?? ""} · paste a new token to replace` : "github_pat_…"} />
        <button disabled={busy || !token.trim()} className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-fg px-3 text-[12.5px] font-medium text-bg disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Connect
        </button>
        {me.github?.set && (
          <button type="button" disabled={busy} onClick={() => void put({ githubToken: null }, "Disconnected.")} className="h-[34px] rounded-[7px] px-2 text-[12.5px] text-muted hover:text-danger">
            Disconnect
          </button>
        )}
      </form>
      <p className="mt-2 text-[12px] leading-relaxed text-faint">
        GitHub → Settings → Developer settings → Fine-grained tokens → your repos (or All repositories) → permissions: <b className="text-muted">Contents, Issues, Pull requests, Actions, Workflows, Secrets — Read and write</b>. Then “Set up automatically” on a project does the rest. Stored encrypted; nobody can see it after saving.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Bot size={15} className="text-accent" />
        <span className="text-[13px]">Default AI agent</span>
        <div className="inline-flex rounded-lg border border-line bg-bg p-0.5 text-[12.5px]">
          {(["claude", "codex"] as const).map((a) => (
            <button key={a} type="button" disabled={busy} onClick={() => me.agent !== a && void put({ agent: a }, `Default agent: ${a === "claude" ? "Claude" : "Codex"}.`)} className={`h-[28px] rounded-md px-3 ${me.agent === a ? "bg-surface text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}>
              {a === "claude" ? "Claude (Anthropic)" : "Codex (OpenAI)"}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-faint">Shown first on every task. Uses your own subscription through GitHub.</span>
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium">Your Claude Code token</span>
          <span className="text-[12px] text-faint">for “Build with Claude” and “Assign to Claude” — work you start runs on your Claude Pro/Max subscription</span>
          {me.claudeCode?.set && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success ring-1 ring-inset ring-success/30">Saved {me.claudeCode.hint}</span>}
        </div>
        <ClaudeKeyForm saved={!!me.claudeCode?.set} busy={busy} placeholder="sk-ant-oat…" onSave={(k) => void put({ claudeCodeToken: k }, k ? "Claude Code token saved — use “Set up automatically” on a project's Code tab." : "Claude Code token removed.")} />
        <p className="mt-1.5 text-[12px] text-faint">
          In a terminal run <code className="num text-muted">claude setup-token</code>, sign in, and paste the token here. To switch accounts, paste a new one. Scoutline copies it into the repo (secret <code className="num">CLAUDE_CODE_OAUTH_TOKEN</code>) when you start a task.
        </p>
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium">Your Claude API key</span>
          <span className="text-[12px] text-faint">optional · for the AI Assistant with Claude models (billed to your Anthropic account)</span>
          {me.anthropic?.set && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success ring-1 ring-inset ring-success/30">Saved {me.anthropic.hint}</span>}
        </div>
        <ClaudeKeyForm saved={!!me.anthropic?.set} busy={busy} onSave={(k) => void put({ anthropicKey: k }, k ? "Claude key saved." : "Claude key removed.")} />
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium">Your Figma token</span>
          <span className="text-[12px] text-faint">optional · shows design previews in tasks</span>
          {me.figma?.set && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success ring-1 ring-inset ring-success/30">Saved {me.figma.hint}</span>}
        </div>
        <ClaudeKeyForm saved={!!me.figma?.set} busy={busy} placeholder="figd_…" validate={false} onSave={(k) => void put({ figmaToken: k }, k ? "Figma token saved." : "Figma token removed.")} />
        <p className="mt-1.5 text-[12px] text-faint">Figma → Settings → Security → Personal access tokens (scope: File content — read).</p>
        <p className="mt-1.5 text-[12px] text-faint">Without a key the Assistant uses free models. Your Claude subscription (Pro/Max) works for agents on GitHub, not for API calls.</p>
      </div>
      <Note msg={msg} />
    </section>
  );
}

function ClaudeKeyForm({ saved, busy, onSave, placeholder = "sk-ant-…" }: { saved: boolean; busy: boolean; onSave: (k: string | null) => void; placeholder?: string; validate?: boolean }) {
  const [k, setK] = useState("");
  return (
    <form autoComplete="off"
      className="mt-2 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (k.trim()) {
          onSave(k.trim());
          setK("");
        }
      }}
    >
      <input className={`${input} num min-w-[240px] flex-1`} type="password" {...NO_AUTOFILL} name="integration-personal-key" value={k} onChange={(e) => setK(e.target.value)} placeholder={saved ? "Saved · paste a new key to replace" : placeholder} />
      <button disabled={busy || !k.trim()} className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-fg px-3 text-[12.5px] font-medium text-bg disabled:opacity-50">
        <Check size={13} /> Save
      </button>
      {saved && (
        <button type="button" disabled={busy} onClick={() => onSave(null)} className="h-[34px] rounded-[7px] px-2 text-[12.5px] text-muted hover:text-danger">
          Remove
        </button>
      )}
    </form>
  );
}

export function IntegrationsSettings() {
  const user = useSessionUser();
  const [w, setW] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    teamFetch<Workspace>("/integrations")
      .then((d) => (setW(d), setError(null)))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    if (user?.role !== "viewer") void load();
  }, [user?.role]);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">Personal</div>
        <MyIntegrations />
      </div>
      {user?.role !== "viewer" && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-faint">
            Workspace
            {w && !w.canEdit && <span className="normal-case tracking-normal text-faint">· only the owner can change these</span>}
          </div>
          {error && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
          {!w ? (
            <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              <IntegrationCard
                icon={<GitBranch size={15} />}
                title="GitHub (workspace)"
                desc="Tasks page, pull request sync for projects, and the fallback for “Assign to Claude/Codex”."
                source={w.github.source}
                canEdit={w.canEdit}
                section="github"
                test="github"
                onSaved={load}
                fields={[
                  { key: "token", label: "Token", placeholder: "github_pat_…", secret: w.github.token },
                  { key: "repo", label: "Repo for the Tasks page (owner/name)", placeholder: w.github.effectiveRepo || "AleksaT205/scoutline", value: w.github.repo },
                ]}
              />
              <IntegrationCard
                icon={<Send size={15} />}
                title="Telegram"
                desc="New lead alerts, client requests and monitoring messages."
                source={w.telegram.source}
                canEdit={w.canEdit}
                section="telegram"
                test="telegram"
                onSaved={load}
                fields={[
                  { key: "botToken", label: "Bot token (from @BotFather)", placeholder: "1234567890:AA…", secret: w.telegram.botToken },
                  { key: "chatId", label: "Chat ID", placeholder: "-100… or your user ID", value: w.telegram.chatId, half: true },
                ]}
                help="Tip: add the bot to your team group, send any message there, then open api.telegram.org/bot<token>/getUpdates to see the chat ID."
              />
              <IntegrationCard
                icon={<Mail size={15} />}
                title="Email-in"
                desc="Turns alert emails from Upwork, PeoplePerHour, Malt and the procurement portal into leads."
                source={w.imap.source}
                canEdit={w.canEdit}
                section="imap"
                test="imap"
                onSaved={load}
                fields={[
                  { key: "host", label: "IMAP server", placeholder: "imap.gmail.com", value: w.imap.host || "imap.gmail.com", half: true },
                  { key: "user", label: "Email address", placeholder: "leads.yourcompany@gmail.com", value: w.imap.user, half: true },
                  { key: "password", label: "App password", placeholder: "16-letter Google app password", secret: w.imap.password },
                ]}
                help={
                  <>
                    Use a separate Gmail with 2-Step Verification → App passwords. Full guide: docs/EMAIL-IN.md.
                    {w.imap.effectiveUser && <> Currently reading: <b className="text-muted">{w.imap.effectiveUser}</b>.</>}
                  </>
                }
              />
              <IntegrationCard
                icon={<Landmark size={15} />}
                title="SAM.gov (US tenders)"
                desc="Optional. Free public API key from your sam.gov account (10 calls per day — checked once a day)."
                source={w.sam.source}
                canEdit={w.canEdit}
                section="sam"
                onSaved={load}
                fields={[{ key: "apiKey", label: "Public API key", placeholder: "Your SAM.gov API key", secret: w.sam.apiKey }]}
              />
              <IntegrationCard
                icon={<Bot size={15} />}
                title="Claude for the Assistant (workspace)"
                desc="Optional. Lets everyone use Claude models in the AI Assistant, billed to the company. Personal keys take priority."
                source={w.anthropic.source}
                canEdit={w.canEdit}
                section="anthropic"
                onSaved={load}
                fields={[{ key: "apiKey", label: "Anthropic API key", placeholder: "sk-ant-…", secret: w.anthropic.apiKey }]}
                help="Without it, the Assistant uses the free models (Groq, Gemini, OpenRouter). console.anthropic.com → API keys."
              />
              {w.claudeCode && (
                <IntegrationCard
                  icon={<Bot size={15} />}
                  title="Claude Code for agents (workspace)"
                  desc="Optional. A shared Claude Code token for people who haven't added their own — tasks then run on this subscription."
                  source={w.claudeCode.source}
                  canEdit={w.canEdit}
                  section="claudeCode"
                  onSaved={load}
                  fields={[{ key: "token", label: "Claude Code token", placeholder: "sk-ant-oat…", secret: w.claudeCode.token }]}
                  help="claude setup-token in a terminal → paste. Personal tokens (above) take priority."
                />
              )}
              <IntegrationCard
                icon={<Plug size={15} />}
                title="Figma (workspace)"
                desc="Optional. Design previews for Figma links in tasks, for everyone. Personal tokens take priority."
                source={w.figma.source}
                canEdit={w.canEdit}
                section="figma"
                onSaved={load}
                fields={[{ key: "token", label: "Figma personal access token", placeholder: "figd_…", secret: w.figma.token }]}
                help="Figma → Settings → Security → Personal access tokens · scope: File content (read)."
              />
            </div>
          )}
          <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-faint">
            <ShieldCheck size={13} /> Secrets are stored encrypted and never shown again. Values set here override the server settings (Coolify).
          </p>
        </div>
      )}
    </div>
  );
}

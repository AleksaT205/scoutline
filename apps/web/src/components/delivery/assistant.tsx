import { useEffect, useRef, useState } from "react";
import { Check, Copy, FileCode2, Loader2, MessagesSquare, Send, Sparkles, Wand2 } from "lucide-react";
import { useCached } from "../../lib/cache";
import { teamFetch } from "../../lib/team";
import { useProjects } from "../../lib/delivery";
import { CreateTasksButton } from "./tasks-from-text";
import { askConfirm } from "../../lib/confirm";
import { Dialog, ErrorNote, Menu, btnPrimary } from "./parts";

/** Faza 13: AI asistent — „pitaj projekat“ i brzi status izveštaj. */
interface ModelInfo {
  id: string;
  label: string;
  provider: "auto" | "free" | "anthropic";
  hint: string;
  available: boolean;
}
interface Turn {
  role: "user" | "assistant";
  content: string;
  meta?: { model: string; provider: string; tokens: { in: number; out: number }; sources?: Array<{ path: string; url: string }>; note?: string };
}

let modelsCache: Promise<{ models: ModelInfo[]; claudeKey: string | null }> | null = null;
const loadModels = () => (modelsCache ??= teamFetch<{ models: ModelInfo[]; claudeKey: string | null }>("/assistant/models").catch(() => ({ models: [], claudeKey: null })));

const MODEL_KEY = "scoutline-ai-model";
const savedModel = () => {
  try {
    return localStorage.getItem(MODEL_KEY) ?? "auto";
  } catch {
    return "auto";
  }
};

/** Izbor modela sa preporukom i cenom (besplatno / Claude). */
export function ModelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    void loadModels().then((d) => setModels(d.models));
  }, []);
  const cur = models.find((m) => m.id === value);
  return (
    <Menu
      label="Model"
      value={value}
      onChange={(v) => {
        onChange(v);
        try {
          localStorage.setItem(MODEL_KEY, v);
        } catch {
          /* bez pamćenja */
        }
      }}
      options={models.map((m) => ({
        value: m.id,
        label: `${m.label}${m.id === "auto" ? " · recommended" : ""}${m.available ? "" : " · add key"}`,
        hint: m.provider === "anthropic" ? "paid" : m.provider === "free" ? "free" : "",
        icon: m.provider === "anthropic" ? <Sparkles size={13} className="text-accent" /> : <Wand2 size={13} className="text-success" />,
      }))}
      className="h-[28px] border border-line px-2"
    >
      <Wand2 size={13} className="text-faint" />
      <span className="text-fg">{cur?.label ?? "Auto"}</span>
    </Menu>
  );
}

export function Md({ text }: { text: string }) {
  // Jednostavan prikaz: naslovi, liste, `kod`, **bold** — bez spoljne biblioteke
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/```[\w-]*\n([\s\S]*?)```/g, (_m, code: string) => `<pre class="my-2 overflow-x-auto rounded-lg border border-line bg-bg p-2.5 text-[12px] leading-relaxed"><code>${code}</code></pre>`)
    .replace(/`([^`\n]+)`/g, '<code class="rounded bg-surface-2 px-1 py-px text-[12px] text-fg">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b class="font-semibold text-fg">$1</b>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-accent underline-offset-2 hover:underline">$1</a>')
    .replace(/^-{3,}\s*$/gm, "")
    .replace(/^#{1,4} (.+)$/gm, '<div class="mt-2 font-semibold text-fg">$1</div>')
    .replace(/^\s*[-*] (.+)$/gm, '<div class="flex gap-2"><span class="text-faint">•</span><span>$1</span></div>')
    .replace(/\n{2,}/g, '<div class="h-2"></div>')
    .replace(/\n/g, "<br/>");
  return <div className="text-[13.5px] leading-relaxed text-muted" dangerouslySetInnerHTML={{ __html: html }} />;
}

const SUGGESTIONS = ["Where is the login handled and how does it work?", "Which tasks are blocked or overdue?", "How is this project deployed?", "What should we work on next?"];

/** Chat sa projektom: odgovori iz repoa i taskova, sa linkovima na fajlove. */
/** Potrošnja Ask AI ovog meseca: moja pitanja i tokeni, i koliko je išlo na Claude ključ (plaća se) a koliko na besplatne modele. */
function AskUsage({ refreshKey }: { refreshKey: number }) {
  const u = useCached<{ usage: Array<{ provider: string; mine: number; mineN: number; total: number; n: number }> }>("/assistant/usage", { staleMs: 5_000 });
  useEffect(() => {
    if (refreshKey) void u.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  const rows = u.data?.usage ?? [];
  if (!rows.length) return null;
  const sum = (k: "mine" | "mineN" | "total" | "n", p?: string) => rows.filter((r) => !p || r.provider === p).reduce((a, r) => a + (r[k] ?? 0), 0);
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line bg-bg px-4 py-1.5 text-[11.5px] text-muted">
      <span className="font-medium text-fg">This month</span>
      <span>
        You: <span className="num text-fg">{sum("mineN")}</span> questions · <span className="num text-fg">{k(sum("mine"))}</span> tokens
      </span>
      <span>
        Team: <span className="num">{sum("n")}</span> · <span className="num">{k(sum("total"))}</span> tokens
      </span>
      <span title="Claude answers use an API key (billed per token). Free models cost nothing.">
        Claude key: <span className="num text-fg">{k(sum("total", "anthropic"))}</span> tokens · free models: <span className="num">{k(sum("total", "free"))}</span>
      </span>
    </div>
  );
}

export function AskPanel({ projectId, hasRepo }: { projectId?: string; hasRepo?: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [model, setModel] = useState(savedModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTurns([]);
    teamFetch<{ items: Array<{ question: string; answer: string; model: string; provider: string; tokensIn: number; tokensOut: number; sources: Array<{ path: string; url: string }> | null }> }>(`/assistant/history${projectId ? `?projectId=${projectId}` : ""}`)
      .then((d) =>
        setTurns(
          d.items.slice(-6).flatMap((m) => [
            { role: "user" as const, content: m.question },
            { role: "assistant" as const, content: m.answer, meta: { model: m.model, provider: m.provider, tokens: { in: m.tokensIn, out: m.tokensOut }, sources: m.sources ?? [] } },
          ]),
        ),
      )
      .catch(() => undefined);
  }, [projectId]);
  useEffect(() => {
    // Telo u zagradama: novi Chrome vraća Promise iz scrollIntoView, a efekat sme da vrati samo funkciju
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: question }]);
    setQ("");
    try {
      const r = await teamFetch<{ answer: string; model: string; provider: string; tokens: { in: number; out: number }; sources: Array<{ path: string; url: string }>; note?: string }>("/assistant/ask", {
        method: "POST",
        body: JSON.stringify({ projectId, question, model, history }),
      });
      setTurns((t) => [...t, { role: "assistant", content: r.answer, meta: { model: r.model, provider: r.provider, tokens: r.tokens, sources: r.sources, note: r.note } }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[420px] flex-col rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <MessagesSquare size={15} className="text-accent" />
        <span className="text-[13.5px] font-medium">Ask the project</span>
        <span className="hidden text-[12px] text-faint sm:inline">{projectId ? (hasRepo ? "answers from the repo code + tasks" : "answers from tasks (add a GitHub repo for code answers)") : "general questions"}</span>
        <span className="ml-auto flex items-center gap-2">
          {turns.length > 0 && (
            <button
              onClick={async () => {
                if (!await askConfirm("Delete this chat? Your questions and answers here are removed.")) return;
                await teamFetch(`/assistant/history${projectId ? `?projectId=${projectId}` : ""}`, { method: "DELETE" }).catch((e) => setError((e as Error).message));
                setTurns([]);
              }}
              className="text-[12px] text-muted hover:text-danger"
            >
              Clear chat
            </button>
          )}
          <ModelPicker value={model} onChange={setModel} />
        </span>
      </div>
      <AskUsage refreshKey={turns.length} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" style={{ maxHeight: 560 }}>
        {turns.length === 0 && (
          <div className="py-6 text-center">
            <div className="text-[13.5px] font-medium">Ask anything about this project</div>
            <p className="mt-1 text-[12.5px] text-muted">Where something is in the code, how it works, what's blocked, what to do next.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => void ask(s)} className="rounded-full border border-line bg-bg px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13.5px] text-fg">
              {t.content}
            </div>
          ) : (
            <div key={i} className="max-w-[95%]">
              <Md text={t.content} />
              {t.meta?.sources && t.meta.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.meta.sources.map((s) => (
                    <a key={s.path} href={s.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate rounded-md border border-line bg-bg px-2 py-0.5 text-[11.5px] text-muted hover:text-fg">
                      <FileCode2 size={11} /> <span className="truncate">{s.path}</span>
                    </a>
                  ))}
                </div>
              )}
              {projectId && <div className="mt-1.5"><CreateTasksButton projectId={projectId} text={t.content} /></div>}
              {t.meta && (
                <div className="mt-1.5 text-[11px] text-faint">
                  {t.meta.provider === "anthropic" ? "Claude" : "Free model"} · {t.meta.model} · {(t.meta.tokens.in + t.meta.tokens.out).toLocaleString()} tokens
                  {t.meta.note && <span className="text-warning"> · {t.meta.note}</span>}
                </div>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="inline-flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 size={13} className="animate-spin" /> Reading the project…
          </div>
        )}
        <div ref={end} />
      </div>
      {error && (
        <div className="px-4 pb-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question… (e.g. where is the payment logic?)" className="h-[38px] min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/60" />
        <button disabled={busy || !q.trim()} className={btnPrimary} aria-label="Send">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>
    </div>
  );
}

/** Brzi status izveštaj (tim / klijent). Bez AI-a vraća čist izveštaj iz podataka. */
export function StatusDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const [audience, setAudience] = useState<"team" | "client">("team");
  const [days, setDays] = useState(7);
  const [model, setModel] = useState(savedModel);
  const [text, setText] = useState<string | null>(null);
  const [meta, setMeta] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText(null);
      setError(null);
    }
  }, [open]);
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await teamFetch<{ text: string; model: string; provider: string; tokens: { in: number; out: number }; ai: boolean; note?: string }>("/assistant/status", { method: "POST", body: JSON.stringify({ projectId, audience, days, model }) });
      setText(r.text);
      setMeta(r.ai ? `${r.provider === "anthropic" ? "Claude" : "Free model"} · ${r.model} · ${(r.tokens.in + r.tokens.out).toLocaleString()} tokens` : `Made from project data (AI unavailable: ${r.note ?? "—"})`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const seg = (on: boolean) => `h-[28px] rounded-md px-3 text-[12.5px] ${on ? "bg-surface-2 text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`;
  return (
    <Dialog open={open} onClose={onClose} title="Status update" width={640}>
      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
            <button className={seg(audience === "team")} onClick={() => setAudience("team")}>
              For the team
            </button>
            <button className={seg(audience === "client")} onClick={() => setAudience("client")}>
              For the client
            </button>
          </div>
          <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
            {[7, 14, 30].map((d) => (
              <button key={d} className={seg(days === d)} onClick={() => setDays(d)}>
                {d} days
              </button>
            ))}
          </div>
          <span className="ml-auto">
            <ModelPicker value={model} onChange={setModel} />
          </span>
        </div>
        {text ? (
          <div className="rounded-xl border border-line bg-bg p-3.5">
            <Md text={text} />
            <div className="mt-2 text-[11px] text-faint">{meta}</div>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Summarizes what was done, what's in progress, what's overdue and what's next. The client version hides task keys, names and tasks labeled “internal”.</p>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          {text && (
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
            >
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button onClick={() => void generate()} disabled={busy} className={btnPrimary}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {text ? "Regenerate" : "Generate"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Delivery → Assistant: chat sa izborom projekta. */
export function AssistantPage() {
  const projects = useProjects();
  const [pid, setPid] = useState<string>("");
  useEffect(() => {
    if (!pid && projects.data?.length) setPid(projects.data.find((p) => p.status === "active")?.id ?? projects.data[0]!.id);
  }, [projects.data, pid]);
  const p = projects.data?.find((x) => x.id === pid);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
          <p className="mt-0.5 text-[13.5px] text-muted">Ask where something is and how it works — answers come from the project's code and tasks.</p>
        </div>
        <div className="sm:ml-auto">
          <Menu label="Project" value={pid} onChange={setPid} options={[{ value: "", label: "No project (general)" }, ...(projects.data ?? []).map((x) => ({ value: x.id, label: x.name, hint: x.key }))]} className="h-[32px] border border-line px-2.5">
            <span className="text-faint">Project</span>
            <span className="max-w-[220px] truncate text-fg">{p?.name ?? "General"}</span>
          </Menu>
        </div>
      </div>
      <AskPanel key={pid} projectId={pid || undefined} hasRepo={!!p?.repoUrl} />
      <p className="mt-3 text-[12px] text-faint">
        Saves tokens: only the relevant files are read, free models are used first, and Claude caches the project context between questions. For code answers the GitHub token needs “Contents: Read”.
      </p>
    </>
  );
}

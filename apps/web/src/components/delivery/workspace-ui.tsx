import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, PenTool, Pencil, Plus, Sparkles, Terminal, Trash2, X } from "lucide-react";
import { teamFetch } from "../../lib/team";
import { canEdit, useSessionUser } from "../../lib/session";
import { Dialog, ErrorNote, btnPrimary, btnSecondary, field } from "./parts";

/** Faza 15 — Skills (PR u repo), Pokreni lokalno, Figma u tasku. */
const small = "inline-flex h-[28px] items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50";

interface Skill {
  id: string;
  name: string;
  description: string | null;
  path: string;
  content: string;
  builtin: boolean;
  createdBy?: string | null;
}

function SkillEditor({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: Partial<Skill> & { id?: string }; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", description: "", path: "", content: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setError(null);
      setF({ name: initial?.name ?? "", description: initial?.description ?? "", path: initial?.path ?? ".claude/skills/my-skill/SKILL.md", content: initial?.content ?? "---\nname: my-skill\ndescription: When to use this skill.\n---\n\nSteps the agent should follow…\n" });
    }
  }, [open, initial]);
  const editing = initial?.id && !initial.builtin;
  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit skill" : "New skill"} width={680}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await teamFetch(editing ? `/delivery/skills/${initial!.id}` : "/delivery/skills", { method: editing ? "PATCH" : "POST", body: JSON.stringify(f) });
            onSaved();
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-2.5 px-4 py-4 sm:grid-cols-2">
          <input className={`${field} h-[34px]`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name (e.g. Skill: Next.js conventions)" />
          <input className={`${field} num h-[34px]`} value={f.path} onChange={(e) => setF({ ...f, path: e.target.value })} placeholder=".claude/skills/name/SKILL.md" />
          <input className={`${field} h-[34px] sm:col-span-2`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Short description (shown in the library)" />
          <textarea className={`${field} num h-72 resize-y py-2 text-[12.5px] leading-relaxed sm:col-span-2`} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />
          <p className="text-[12px] text-faint sm:col-span-2">Claude Code skills live in <code className="num">.claude/skills/&lt;name&gt;/SKILL.md</code> with a name and description at the top. AGENTS.md / CLAUDE.md work for any agent.</p>
          {error && (
            <div className="sm:col-span-2">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button disabled={busy} className={btnPrimary}>
            {busy && <Loader2 size={14} className="animate-spin" />} Save to library
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Biblioteka skills-a + „Add to project“ (otvara PR u repou). */
export function SkillsView({ projectId, repo }: { projectId: string; repo: string }) {
  const user = useSessionUser();
  const [list, setList] = useState<Skill[] | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [edit, setEdit] = useState<Partial<Skill> | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const load = () => {
    teamFetch<{ skills: Skill[] }>("/delivery/skills")
      .then((d) => setList(d.skills))
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
    teamFetch<{ installed: string[] }>(`/delivery/projects/${projectId}/skills?repo=${encodeURIComponent(repo)}`)
      .then((d) => setInstalled(d.installed))
      .catch(() => setInstalled([]));
  };
  useEffect(load, [projectId, repo]); // eslint-disable-line react-hooks/exhaustive-deps
  const install = async (body: object) => {
    setBusy("install");
    setMsg(null);
    try {
      const r = await teamFetch<{ url: string }>(`/delivery/projects/${projectId}/skills/install?repo=${encodeURIComponent(repo)}`, { method: "POST", body: JSON.stringify(body) });
      setMsg({ ok: true, text: "Pull request opened — merge it on GitHub (or in Code → Pull requests).", url: r.url });
      setPicked(new Set());
      setDraft(null);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  if (!list) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] text-muted">Rules and skills for Claude Code, Codex and other agents. Picked files are added to <b className="text-fg">{repo}</b> through a pull request.</p>
        {canEdit(user) && (
          <div className="flex gap-1.5 sm:ml-auto">
            <button
              onClick={async () => {
                setBusy("draft");
                setMsg(null);
                try {
                  const r = await teamFetch<{ content: string }>(`/delivery/projects/${projectId}/skills/draft-agents?repo=${encodeURIComponent(repo)}`, { method: "POST", body: "{}" });
                  setDraft(r.content);
                } catch (e) {
                  setMsg({ ok: false, text: (e as Error).message });
                } finally {
                  setBusy(null);
                }
              }}
              className={small}
              disabled={!!busy}
              title="AI reads the repo and writes a project-specific AGENTS.md"
            >
              {busy === "draft" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} className="text-accent" />} Draft AGENTS.md with AI
            </button>
            <button onClick={() => setEdit({})} className={small}>
              <Plus size={12} /> New skill
            </button>
          </div>
        )}
      </div>
      {msg && (
        <div className={`rounded-lg border px-3 py-2 text-[12.5px] ${msg.ok ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>
          {msg.text}{" "}
          {msg.url && (
            <a href={msg.url} target="_blank" rel="noreferrer" className="font-medium underline">
              Open PR
            </a>
          )}
        </div>
      )}
      {draft !== null && (
        <section className="rounded-xl border border-accent/40 bg-surface p-3">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
            <Sparkles size={14} className="text-accent" /> AGENTS.md draft — edit if needed
            <button onClick={() => setDraft(null)} className="ml-auto text-faint hover:text-fg" aria-label="Close draft">
              <X size={14} />
            </button>
          </div>
          <textarea className={`${field} num h-72 resize-y py-2 text-[12.5px] leading-relaxed`} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex justify-end">
            <button disabled={!!busy} onClick={() => void install({ files: [{ path: "AGENTS.md", content: draft, name: "AGENTS.md (AI draft)" }] })} className={btnPrimary}>
              {busy === "install" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Open PR with AGENTS.md
            </button>
          </div>
        </section>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((s) => {
          const has = installed.includes(s.path);
          const on = picked.has(s.id);
          return (
            <label key={s.id} className={`flex cursor-pointer gap-2.5 rounded-xl border bg-surface p-3 ${on ? "border-accent/60 bg-accent-soft" : "border-line"}`}>
              <input
                type="checkbox"
                disabled={!canEdit(user)}
                checked={on}
                onChange={() => {
                  const n = new Set(picked);
                  if (n.has(s.id)) n.delete(s.id);
                  else n.add(s.id);
                  setPicked(n);
                }}
                className="mt-1 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-medium">{s.name}</span>
                  {has && <span className="rounded-full bg-success-soft px-1.5 py-px text-[10.5px] text-success ring-1 ring-inset ring-success/30">in repo</span>}
                  {!s.builtin && <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] text-muted ring-1 ring-inset ring-line">team</span>}
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">{s.description}</span>
                <span className="num mt-1 block truncate text-[11px] text-faint">{s.path}</span>
              </span>
              {canEdit(user) && (
                <span className="flex flex-col gap-1">
                  <button type="button" onClick={(e) => (e.preventDefault(), setEdit(s.builtin ? { ...s, id: undefined, name: `${s.name} (copy)`, builtin: false } : s))} className="text-faint hover:text-fg" aria-label={s.builtin ? `Duplicate ${s.name}` : `Edit ${s.name}`} title={s.builtin ? "Duplicate & edit" : "Edit"}>
                    <Pencil size={12} />
                  </button>
                  {!s.builtin && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        if (!window.confirm(`Delete “${s.name}” from the library?`)) return;
                        await teamFetch(`/delivery/skills/${s.id}`, { method: "DELETE" });
                        load();
                      }}
                      className="text-faint hover:text-danger"
                      aria-label={`Delete ${s.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {canEdit(user) && (
        <div className="sticky bottom-3 flex justify-end">
          <button disabled={!picked.size || !!busy} onClick={() => void install({ ids: [...picked] })} className={`${btnPrimary} shadow-float`}>
            {busy === "install" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add {picked.size || ""} to project (PR)
          </button>
        </div>
      )}
      <SkillEditor open={edit !== null} onClose={() => setEdit(null)} initial={edit ?? undefined} onSaved={load} />
    </div>
  );
}

/** Pokreni lokalno: VS Code / Cursor / Codespaces + komande. */
export function RunLocallyView({ projectId, repo }: { projectId: string; repo: string }) {
  const [d, setD] = useState<{ stack: string; links: Record<string, string>; steps: Array<{ label: string; cmd: string }>; devcontainer?: boolean; error?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    teamFetch<typeof d>(`/delivery/projects/${projectId}/dev?repo=${encodeURIComponent(repo)}`)
      .then(setD)
      .catch((e) => setErr((e as Error).message));
  }, [projectId, repo]);
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!d) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" />;
  const all = d.steps.map((s) => s.cmd.replace(/\s+#.*$/, "")).join(" && ");
  const copy = async (k: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(k);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
        <div className="text-[13px] font-semibold">Open the code</div>
        <p className="text-[12px] text-muted">A web app can't start programs on your computer, so these open your editor and clone the repo for you.</p>
        {[
          ["vscode", "Open in VS Code", "Clones and opens the repo"],
          ["cursor", "Open in Cursor", "Same, in Cursor"],
          ["codespaces", "Run in GitHub Codespaces", d.devcontainer ? "Cloud dev environment (uses the repo's devcontainer)" : "Cloud dev environment, nothing to install"],
          ["githubDev", "Browse in github.dev", "Quick read-only editor in the browser"],
        ].map(([k = "", label, hint]) => (
          <a key={k} href={d.links[k]} target={k === "vscode" || k === "cursor" ? undefined : "_blank"} rel="noreferrer" className="flex items-center gap-2.5 rounded-lg border border-line bg-bg px-3 py-2 hover:border-accent/50">
            <ExternalLink size={13} className="text-faint" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{label}</span>
              <span className="block text-[11.5px] text-faint">{hint}</span>
            </span>
          </a>
        ))}
      </section>
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
          <Terminal size={14} /> Run it locally <span className="font-normal text-faint">· {d.stack}</span>
          <button onClick={() => void copy("all", all)} className="ml-auto inline-flex items-center gap-1 text-[12px] font-normal text-muted hover:text-fg">
            {copied === "all" ? <Check size={12} className="text-success" /> : <Copy size={12} />} Copy all
          </button>
        </div>
        <ol className="mt-2 space-y-2">
          {d.steps.map((s, i) => (
            <li key={i}>
              <div className="mb-0.5 text-[11.5px] text-faint">
                {i + 1}. {s.label}
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                <code className="num min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12.5px] text-fg">{s.cmd}</code>
                <button onClick={() => void copy(String(i), s.cmd)} className="text-faint hover:text-fg" aria-label={`Copy ${s.label}`}>
                  {copied === String(i) ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                </button>
              </div>
            </li>
          ))}
        </ol>
        {d.error && <p className="mt-2 text-[12px] text-warning">{d.error}</p>}
        <p className="mt-3 text-[12px] text-faint">Previews per pull request: turn on Deploy Previews in Netlify or Preview Deployments in Coolify — the link then shows on each PR in Code → Pull requests.</p>
      </section>
    </div>
  );
}

/** Figma dizajn u detalju taska. */
interface FigmaLink {
  id: string;
  url: string;
  title: string | null;
  kind: string;
}
function FigmaThumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    teamFetch<{ url: string | null; reason?: string }>(`/delivery/figma/${id}/image`)
      .then((d) => (setSrc(d.url), setReason(d.reason ?? null)))
      .catch(() => setSrc(null));
  }, [id]);
  if (src === undefined) return <div className="h-28 animate-pulse rounded-lg bg-surface-2" />;
  if (!src) return <div className="grid h-20 place-items-center rounded-lg border border-dashed border-line px-3 text-center text-[11.5px] text-faint">{reason ?? "Preview unavailable"}</div>;
  return <img src={src} alt="Figma design preview" className="max-h-64 w-full rounded-lg border border-line bg-white object-contain" loading="lazy" />;
}

export function FigmaBox({ issueId, links, onChanged }: { issueId: string; links: FigmaLink[]; onChanged: () => void }) {
  const user = useSessionUser();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const figma = links.filter((l) => l.kind === "figma");
  return (
    <div className="mt-3 rounded-xl border border-line bg-bg p-3">
      <div className="flex items-center gap-2 text-[12.5px]">
        <PenTool size={14} className="text-accent" />
        <span className="font-medium">Design</span>
        <span className="text-[11.5px] text-faint">{figma.length ? `${figma.length} Figma frame(s)` : "link a Figma frame"}</span>
      </div>
      <div className="mt-2 space-y-2">
        {figma.map((l) => (
          <div key={l.id} className="space-y-1">
            <FigmaThumb id={l.id} />
            <div className="flex items-center gap-2 text-[12px]">
              <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-muted hover:text-fg">
                {l.title ?? "Figma design"} ↗
              </a>
              {canEdit(user) && (
                <button
                  onClick={async () => {
                    await teamFetch(`/delivery/figma/${l.id}`, { method: "DELETE" });
                    onChanged();
                  }}
                  className="text-faint hover:text-danger"
                  aria-label="Remove Figma link"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {canEdit(user) && (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              await teamFetch(`/delivery/issues/${issueId}/figma`, { method: "POST", body: JSON.stringify({ url }) });
              setUrl("");
              onChanged();
            } catch (er) {
              setErr((er as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a Figma link (right-click a frame → Copy link)" className="h-[30px] min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60" />
          <button disabled={busy || !url.trim()} className={small}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
          </button>
        </form>
      )}
      {err && <p className="mt-1 text-[12px] text-danger">{err}</p>}
    </div>
  );
}

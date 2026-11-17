import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { teamFetch } from "./team";

/**
 * Glas → tekst za AI polja (srpski i engleski).
 * 1) Prepoznavanje u pregledaču (Chrome, Edge, Safari) — besplatno, tekst se pojavljuje dok pričaš.
 * 2) Rezerva (Firefox ili kad pregledač ne zna jezik): snimak → server → Groq Whisper.
 * Tekst se samo upisuje u polje — isto radi za Claude, Codex i Assistant.
 */
export type VoiceLang = "sr" | "en";
const LANG_KEY = "voice-lang";
const savedLang = (): VoiceLang => {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === "en" ? "en" : "sr";
  } catch {
    return "sr";
  }
};

interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
const SpeechCtor = (): (new () => SpeechRec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const BLOCKED = "__mic_blocked__";
/** Traži mikrofon odmah (pregledač tada sam pokaže prozor „Allow“). Ako je ranije odbijen — vraća false. */
let micReason = ""; // poslednji razlog zašto mikrofon ne radi (prikazuje se u uputstvu)
async function askMic(): Promise<boolean> {
  micReason = "";
  try {
    const st = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (st?.state === "denied") {
      micReason = "denied";
      return false;
    }
  } catch {
    /* neki pregledači ne znaju za ovo pitanje — samo probaj */
  }
  if (!navigator.mediaDevices?.getUserMedia) return true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) {
    micReason = (e as DOMException).name || "error";
    return false;
  }
}
const isSafari = () => /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const join = (a: string, b: string) => (b ? (a && !/\s$/.test(a) ? `${a} ${b}` : `${a}${b}`) : a);

type State = "idle" | "listening" | "recording" | "transcribing";

export function useVoice(value: string, onChange: (v: string) => void) {
  const [state, setState] = useState<State>("idle");
  const [lang, setLangState] = useState<VoiceLang>(savedLang);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SpeechRec | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const base = useRef("");
  const latest = useRef(value);
  latest.current = value;
  const fallback = useRef(false); // pregledač ne zna jezik / nema servis → snimak na server

  const setLang = (l: VoiceLang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ništa */
    }
  };

  const stopAll = () => {
    rec.current?.stop();
    if (media.current && media.current.state !== "inactive") media.current.stop();
  };
  useEffect(() => () => {
    rec.current?.abort();
    if (media.current && media.current.state !== "inactive") media.current.stop();
  }, []);

  const record = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice input isn't supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(BLOCKED);
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t));
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mr.mimeType || type || "audio/webm" });
      if (blob.size < 800) return setState("idle");
      setState("transcribing");
      try {
        const audio = await new Promise<string>((ok, fail) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result));
          r.onerror = () => fail(new Error("read"));
          r.readAsDataURL(blob);
        });
        const r = await teamFetch<{ text: string }>("/assistant/transcribe", { method: "POST", body: JSON.stringify({ audio, mime: blob.type, lang }) });
        if (r.text) onChange(join(latest.current, r.text));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setState("idle");
      }
    };
    media.current = mr;
    mr.start();
    setState("recording");
    // Najviše 2 minuta po snimku
    window.setTimeout(() => mr.state !== "inactive" && mr.stop(), 120_000);
  };

  const start = async () => {
    setError(null);
    if (!(await askMic())) return setError(BLOCKED);
    const Ctor = SpeechCtor();
    if (!Ctor || fallback.current) return void record();
    const r = new Ctor();
    r.lang = lang === "sr" ? "sr-RS" : "en-US";
    r.continuous = true;
    r.interimResults = true;
    base.current = latest.current;
    let finals = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i]![0].transcript;
        if (e.results[i]!.isFinal) finals = join(finals, t.trim());
        else interim = join(interim, t.trim());
      }
      onChange(join(base.current, join(finals, interim)));
    };
    r.onerror = (e) => {
      // Pregledač ne zna srpski / nema servis za prepoznavanje → odmah pređi na snimak
      if (["language-not-supported", "service-not-allowed", "network"].includes(e.error)) {
        fallback.current = true;
        rec.current = null;
        setState("idle");
        void record();
      } else if (e.error === "not-allowed" || e.error === "service-not-allowed") setError(BLOCKED);
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Voice input stopped (${e.error}).`);
    };
    r.onend = () => {
      if (rec.current === r) {
        rec.current = null;
        setState((s) => (s === "listening" ? "idle" : s));
      }
    };
    rec.current = r;
    try {
      r.start();
      setState("listening");
    } catch {
      fallback.current = true;
      void record();
    }
  };

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), error === BLOCKED ? 30_000 : 6000);
    return () => window.clearTimeout(t);
  }, [error]);

  const toggle = () => (state === "listening" || state === "recording" ? stopAll() : state === "idle" ? void start() : undefined);
  return { state, lang, setLang, error, blocked: error === BLOCKED, clearError: () => setError(null), toggle, active: state !== "idle" };
}

/** Dugme mikrofona + SR/EN. Stavi ga pored polja; tekst se dopisuje u polje. */
export function VoiceButton({ value, onChange, className = "", size = "md" }: { value: string; onChange: (v: string) => void; className?: string; size?: "sm" | "md" }) {
  const v = useVoice(value, onChange);
  const live = v.state === "listening" || v.state === "recording";
  return (
    <span className={`inline-flex shrink-0 items-center ${/\babsolute\b/.test(className) ? "" : "relative"} ${className}`}>
      <span className={`inline-flex ${size === "sm" ? "h-[28px]" : "h-[34px]"} items-stretch overflow-hidden rounded-md border border-line bg-surface`}>
        <button
          type="button"
          onClick={v.toggle}
          disabled={v.state === "transcribing"}
          className={`grid ${size === "sm" ? "w-[28px]" : "w-[34px]"} place-items-center ${live ? "bg-danger/10 text-danger" : "text-muted hover:text-fg"} disabled:opacity-60`}
          aria-label={live ? "Stop voice input" : "Talk instead of typing"}
          title={live ? "Stop" : `Talk instead of typing (${v.lang === "sr" ? "Serbian" : "English"})`}
        >
          {v.state === "transcribing" ? <Loader2 size={14} className="animate-spin" /> : live ? <Square size={11} className="animate-pulse fill-current" /> : <Mic size={15} />}
        </button>
        <button
          type="button"
          onClick={() => v.setLang(v.lang === "sr" ? "en" : "sr")}
          disabled={v.active}
          className="border-l border-line px-1.5 font-mono text-[11px] font-semibold tracking-wide text-muted hover:text-fg disabled:opacity-50"
          aria-label={`Voice language: ${v.lang === "sr" ? "Serbian" : "English"}. Click to switch.`}
          title="Language you speak — click to switch"
        >
          {v.lang.toUpperCase()}
        </button>
      </span>
      {v.blocked ? (
        <span role="alertdialog" aria-label="Turn on the microphone" className="absolute right-0 top-full z-20 mt-1.5 w-[280px] rounded-lg border border-line bg-surface p-3 text-left text-[12px] leading-relaxed text-muted shadow-float">
          <span className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-fg">
            <Mic size={13} className="text-danger" /> Microphone isn't available
            {micReason && <span className="ml-auto font-mono text-[11px] font-normal text-faint">{micReason}</span>}
          </span>
          {micReason === "NotFoundError" || micReason === "OverconstrainedError" ? (
            <>No microphone found. Plug one in, or pick the right one in <b className="text-fg">chrome://settings/content/microphone</b> (the menu at the top), then reload.</>
          ) : micReason === "NotReadableError" || micReason === "AbortError" ? (
            <>The microphone is busy or macOS blocks it. Close other apps using it (Zoom, Meet…), and check <b className="text-fg">System Settings → Privacy &amp; Security → Microphone → Google Chrome</b> is on, then restart Chrome.</>
          ) : micReason === "NotAllowedError" ? (
            <>
              The browser blocked the request without asking. Look for a <b className="text-fg">crossed-out mic icon at the right end of the address bar</b> → <b className="text-fg">Always allow</b>. If there's none, check <b className="text-fg">System Settings → Privacy &amp; Security → Microphone → Google Chrome</b>, restart Chrome and try again.
            </>
          ) : isIOS() ? (
            <>iPhone: <b className="text-fg">Settings → Safari → Microphone → Allow</b>, then reload this page.</>
          ) : isSafari() ? (
            <>Safari menu → <b className="text-fg">Settings for This Website → Microphone → Allow</b>, then reload.</>
          ) : (
            <>
              Click the <b className="text-fg">icon left of the address bar</b> (🔒 or ⚙︎) → <b className="text-fg">Microphone → Allow</b>, then reload the page.
            </>
          )}
          <span className="mt-2 flex gap-2">
            <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-fg px-2.5 py-1 text-[12px] font-medium text-bg hover:opacity-90">
              Reload
            </button>
            <button type="button" onClick={v.clearError} className="rounded-md border border-line px-2.5 py-1 text-[12px] hover:text-fg">
              Close
            </button>
          </span>
        </span>
      ) : (
        v.error && (
          <span role="status" className="absolute right-0 top-full z-10 mt-1 w-max max-w-[260px] rounded-md border border-danger/40 bg-surface px-2 py-1 text-[12px] text-danger shadow-float">
            {v.error}
          </span>
        )
      )}
    </span>
  );
}

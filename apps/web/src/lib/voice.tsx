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
      setError("Allow microphone access in the browser to talk.");
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

  const start = () => {
    setError(null);
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
      } else if (e.error === "not-allowed") setError("Allow microphone access in the browser to talk.");
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
    const t = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(t);
  }, [error]);

  const toggle = () => (state === "listening" || state === "recording" ? stopAll() : state === "idle" ? start() : undefined);
  return { state, lang, setLang, error, toggle, active: state !== "idle" };
}

/** Dugme mikrofona + SR/EN. Stavi ga pored polja; tekst se dopisuje u polje. */
export function VoiceButton({ value, onChange, className = "", size = "md" }: { value: string; onChange: (v: string) => void; className?: string; size?: "sm" | "md" }) {
  const v = useVoice(value, onChange);
  const live = v.state === "listening" || v.state === "recording";
  return (
    <span className={`inline-flex shrink-0 items-center ${/\babsolute\b/.test(className) ? "" : "relative"} ${className}`}>
      <span className={`inline-flex ${size === "sm" ? "h-[30px]" : "h-[34px]"} items-stretch overflow-hidden rounded-md border border-line bg-surface`}>
        <button
          type="button"
          onClick={v.toggle}
          disabled={v.state === "transcribing"}
          className={`grid ${size === "sm" ? "w-[30px]" : "w-[34px]"} place-items-center ${live ? "bg-danger/10 text-danger" : "text-muted hover:text-fg"} disabled:opacity-60`}
          aria-label={live ? "Stop voice input" : "Talk instead of typing"}
          title={live ? "Stop" : `Talk instead of typing (${v.lang === "sr" ? "Serbian" : "English"})`}
        >
          {v.state === "transcribing" ? <Loader2 size={14} className="animate-spin" /> : live ? <Square size={11} className="animate-pulse fill-current" /> : <Mic size={15} />}
        </button>
        <button
          type="button"
          onClick={() => v.setLang(v.lang === "sr" ? "en" : "sr")}
          disabled={v.active}
          className="border-l border-line px-1.5 font-mono text-[10.5px] font-semibold tracking-wide text-muted hover:text-fg disabled:opacity-50"
          aria-label={`Voice language: ${v.lang === "sr" ? "Serbian" : "English"}. Click to switch.`}
          title="Language you speak — click to switch"
        >
          {v.lang.toUpperCase()}
        </button>
      </span>
      {v.error && (
        <span role="status" className="absolute right-0 top-full z-10 mt-1 w-max max-w-[260px] rounded-md border border-danger/40 bg-surface px-2 py-1 text-[11.5px] text-danger shadow-float">
          {v.error}
        </span>
      )}
    </span>
  );
}

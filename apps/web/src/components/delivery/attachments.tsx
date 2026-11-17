import { useCallback, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { teamFetch } from "../../lib/team";

/**
 * Slike u razgovoru sa Claude-om: zalepi (Cmd+V), izaberi sa računara ili prevuci.
 * Slika se odmah otpremi u Scoutline (do 5 MB, PNG/JPG/WebP/GIF) i šalje se uz poruku.
 */
export interface Attached {
  key: string;
  name: string;
  preview: string; // lokalni prikaz (object URL)
  id?: string; // posle otpremanja
  error?: string;
}
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function useImageAttachments(projectId: string) {
  const [items, setItems] = useState<Attached[]>([]);
  const add = useCallback(
    (files: FileList | File[]) => {
      for (const f of Array.from(files).slice(0, 6)) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const preview = URL.createObjectURL(f);
        if (!TYPES.includes(f.type)) {
          setItems((cur) => [...cur, { key, name: f.name, preview, error: "Only PNG, JPG, WebP or GIF." }]);
          continue;
        }
        if (f.size > 5 * 1024 * 1024) {
          setItems((cur) => [...cur, { key, name: f.name, preview, error: "Over 5 MB." }]);
          continue;
        }
        setItems((cur) => [...cur, { key, name: f.name || "screenshot.png", preview }]);
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const r = await teamFetch<{ id: string }>(`/delivery/projects/${projectId}/attachments`, { method: "POST", body: JSON.stringify({ name: f.name || "screenshot.png", mime: f.type, data: String(reader.result) }) });
            setItems((cur) => cur.map((x) => (x.key === key ? { ...x, id: r.id } : x)));
          } catch (e) {
            setItems((cur) => cur.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x)));
          }
        };
        reader.readAsDataURL(f);
      }
    },
    [projectId],
  );
  const remove = (key: string) => setItems((cur) => cur.filter((x) => x.key !== key));
  const clear = () => setItems([]);
  const ids = items.filter((x) => x.id).map((x) => x.id!);
  const uploading = items.some((x) => !x.id && !x.error);
  /** Za polje za unos: Cmd+V sa slikom. */
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      add(files);
    }
  };
  /** Za formu: prevlačenje slike. */
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.items).some((i) => i.type.startsWith("image/"))) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    },
  };
  return { items, add, remove, clear, ids, uploading, onPaste, dropProps };
}

/** Dugme „Add image“ (otvara izbor fajla) — slike sa računara. */
export function AttachButton({ onFiles, className }: { onFiles: (f: FileList) => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" onClick={() => input.current?.click()} className={className ?? "inline-flex h-[32px] items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-muted hover:text-fg"} title="Add an image from your computer (or paste one with ⌘V)" aria-label="Add image">
        <ImagePlus size={14} /> <span className="hidden sm:inline">Image</span>
      </button>
    </>
  );
}

/** Sličice izabranih slika sa ✕. */
export function AttachedThumbs({ items, onRemove }: { items: Attached[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((x) => (
        <div key={x.key} className={`relative size-16 overflow-hidden rounded-lg border ${x.error ? "border-danger/60" : "border-line"} bg-bg`} title={x.error ?? x.name}>
          <img src={x.preview} alt={x.name} className={`size-full object-cover ${x.id ? "" : "opacity-60"}`} />
          {!x.id && !x.error && (
            <span className="absolute inset-0 grid place-items-center">
              <Loader2 size={16} className="animate-spin text-white drop-shadow" />
            </span>
          )}
          {x.error && <span className="absolute inset-x-0 bottom-0 bg-danger/90 px-1 text-[9.5px] leading-tight text-white">{x.error}</span>}
          <button type="button" onClick={() => onRemove(x.key)} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label={`Remove ${x.name}`}>
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Slike iz teksta poruke (markdown ![..](url)) → sličice; vraća i tekst bez njih. */
export function splitImages(text: string): { text: string; images: string[] } {
  const images: string[] = [];
  const rest = text.replace(/!\[[^\]]*\]\((https?:\/\/[^\s)"'<>]+)\)/g, (_m, url: string) => {
    images.push(url);
    return "";
  });
  return { text: rest.replace(/\n{3,}/g, "\n\n").trim(), images };
}

export function MessageImages({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-bg">
          <img src={u} alt="Attached image" className="max-h-40 max-w-[240px] object-contain" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

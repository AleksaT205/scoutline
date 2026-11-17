/**
 * Isti oglas iz dva izvora (npr. tender na EU TED i Find a Tender): normalizovan naslov.
 * Bez dijakritika, malim slovima, samo slova i brojevi; izbačeni brojevi referenci i reči bez značenja.
 */
const STOP = new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "with", "za", "i", "u", "na", "od", "sa", "der", "die", "das", "und", "de", "la", "le", "et"]);
export function titleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "dj")
    .toLowerCase()
    .replace(/\b\d{4}\s*\/\s*s\s*\d+[-\d]*/g, " ") // EU referenca „2026/S 221-712345“
    .replace(/\b[a-z]{0,4}[-/]?\d[\d\-/.]*\b/g, " ") // ostali brojevi referenci (TED-123, 45/2026)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(" ")
    .trim()
    .slice(0, 200);
}

/** Duplikat se traži samo za dovoljno opisne naslove (ili kad je ista firma) — „Web developer“ nije dovoljno. */
export const titleKeyIsSpecific = (key: string) => key.length >= 28 && key.split(" ").length >= 4;

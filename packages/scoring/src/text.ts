/** HTML → čitljiv tekst (dovoljno za ocenjivanje). */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&#x2F;": "/", "&nbsp;": " " };

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[#\w]+;/g, (e) => ENTITIES[e] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Naslov stranice: og:title, pa <title>. */
export function htmlTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const t = og?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return t ? htmlToText(t).slice(0, 200) : null;
}

/** Samo glavni deo stranice (bez skripti, stilova, menija) — manje šuma za AI. */
export function mainText(html: string): string {
  const cleaned = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const main = cleaned.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? cleaned;
  return htmlToText(main).slice(0, 20_000);
}

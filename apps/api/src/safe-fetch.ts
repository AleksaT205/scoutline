import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Bezbedno preuzimanje stranice koju je korisnik naveo (link oglasa).
 * Sprečava da se preko API-ja čitaju interni servisi (localhost, kućna mreža, Tailscale, Docker mreža).
 */
const PRIVATE_V4 = [
  [0x0a000000, 8], // 10.0.0.0/8
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0x64400000, 10], // 100.64.0.0/10 (Tailscale / CGNAT)
  [0x00000000, 8], // 0.0.0.0/8
] as const;

function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
    return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivate(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

export async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http/https links are allowed");
  if (url.username || url.password) throw new Error("Links with credentials are not allowed");
  const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error("This address is not allowed");
}

const MAX_BYTES = 2_000_000;

export async function safeFetchHtml(input: string): Promise<{ html: string; finalUrl: string }> {
  let url = new URL(input);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ScoutlineBot/0.1)", Accept: "text/html,application/xhtml+xml,text/plain" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`The page returned HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new Error("The link is not a web page");
    const reader = res.body?.getReader();
    if (!reader) return { html: "", finalUrl: url.toString() };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { html: new TextDecoder().decode(Buffer.concat(chunks)), finalUrl: url.toString() };
  }
  throw new Error("Too many redirects");
}

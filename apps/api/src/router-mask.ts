/**
 * Lagano maskiranje tajni pre slanja na besplatne nivoe (T5).
 * Samo očigledni formati (API ključevi, tokeni, privatni ključevi, lozinke u .env obliku, lozinke u URL-u).
 * Radi nad dekodiranim stringovima u JSON-u (ne nad sirovim telom), pa ne kvari escape-ove.
 * Isto ulaz → isti izlaz (keš prompta i dalje radi).
 */

const MASK = "[REDACTED]";

// Poznati formati — visoka sigurnost
const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:ant-[a-z0-9]+-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, // Anthropic / OpenAI
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, // Stripe
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
];
// Lozinka u URL-u: scheme://user:lozinka@host
const URL_CREDS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]{3,})@/gi;
// Authorization: Bearer <token>
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/-]{20,}=*)/g;
// .env oblik: NAZIV_SA_SECRET/TOKEN/PASSWORD/KEY = vrednost (samo velika slova u nazivu, kao u .env fajlovima)
const ENV_LINE = /^(\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|AUTH_?KEY|DSN)[A-Z0-9_]*\s*[=:]\s*)(["']?)([^\s"'#]+)\2(?=\s|$|#)/gm;

/** Vrednost iz .env reda liči na tajnu (a ne na kod ili referencu na env). */
function looksSecret(v: string): boolean {
  if (v === MASK || v.length < 8) return false;
  if (/^[$%{<]|\(|process\.env|os\.environ|import\.meta|^env\(|^(true|false|null|none|changeme|your[-_])/i.test(v)) return false;
  return v.length >= 20 || (/[A-Za-z]/.test(v) && /\d/.test(v) && v.length >= 12);
}

export function maskText(s: string): { text: string; count: number } {
  let count = 0;
  let t = s;
  for (const p of TOKEN_PATTERNS)
    t = t.replace(p, () => {
      count++;
      return MASK;
    });
  t = t.replace(URL_CREDS, (_m, pre: string) => {
    count++;
    return `${pre}${MASK}@`;
  });
  t = t.replace(BEARER, (_m, pre: string) => {
    count++;
    return `${pre}${MASK}`;
  });
  t = t.replace(ENV_LINE, (m, pre: string, q: string, v: string) => {
    if (!looksSecret(v)) return m;
    count++;
    return `${pre}${q}${MASK}${q}`;
  });
  return { text: t, count };
}

// Polja koja se ne diraju: potpisi razmišljanja, šifrovan sadržaj, base64 podaci, identifikatori
const SKIP_KEYS = new Set(["signature", "encrypted_content", "data", "model", "id", "tool_use_id", "tool_call_id", "type", "role", "cache_control"]);

/** Maskira sve stringove u JSON vrednosti (rekurzivno). Vraća novu vrednost i broj zamena. */
export function maskSecrets<T>(value: T): { value: T; count: number } {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = maskText(v);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SKIP_KEYS.has(k) ? x : walk(x);
      return out;
    }
    return v;
  };
  const out = walk(value) as T;
  return { value: out, count };
}

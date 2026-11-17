// Podešavanje može da se promeni u radu (Settings → Integrations) — zato promenljive, ne konstante
let TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
let CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
export function setTelegramConfig(c: { token: string; chatId: string }) {
  TOKEN = c.token;
  CHAT_ID = c.chatId;
}
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "https://scoutline-app.netlify.app";

export const telegramConfigured = () => Boolean(TOKEN && CHAT_ID);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const flag = (cc: string | null) => (cc ? cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0))) : "🌍");

export interface NotifyLead {
  score: number;
  title: string;
  company: string | null;
  country: string | null;
  tier: string | null;
  budgetEur: number | null;
  source: string;
  url: string;
  why: string[] | null;
  leadType?: string | null;
  deadline?: Date | null;
}

export async function sendLeadToTelegram(l: NotifyLead): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const budget = l.budgetEur ? ` · €${l.budgetEur >= 1000 ? `${Math.round(l.budgetEur / 1000)}k` : l.budgetEur}` : "";
  const TYPE: Record<string, string> = { tender: "🏛 Tender", project: "🧩 Project", intent: "📈 Intent", hiring_signal: "👤 Hiring" };
  const days = l.deadline ? Math.ceil((l.deadline.getTime() - Date.now()) / 86_400_000) : null;
  const deadline = days !== null ? ` · ⏳ ${days}d left` : "";
  const text = [
    `${l.leadType ? `${TYPE[l.leadType] ?? ""} · ` : ""}🎯 <b>${l.score}</b> · ${flag(l.country)} ${l.tier === "DOMESTIC" ? "SR" : (l.tier ?? "")}${budget}${deadline}`,
    `<b>${esc(l.title)}</b>`,
    `${esc(l.company ?? "Unknown company")} · ${esc(l.source)}`,
    l.why?.[0] ? `\n💡 ${esc(l.why[0])}` : "",
    `\n<a href="${esc(l.url)}">Open post</a> · <a href="${esc(DASHBOARD_URL)}">Dashboard</a>`,
  ]
    .filter(Boolean)
    .join("\n");
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) console.warn(`[telegram] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.ok;
}

/** Običan tekst na Telegram (sistemska upozorenja: worker stao, izvor ne radi…). */
export async function sendTelegramText(text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return !!res?.ok;
}

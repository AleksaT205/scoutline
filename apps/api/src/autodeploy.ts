import { eq } from "drizzle-orm";
import { ghFetch, settings, type Db } from "@radar/db";
import { sendTelegramText } from "@radar/scoring";
import { runtime } from "./runtime.js";

/**
 * Auto-deploy bez javnog domena: server na 2 minuta proveri `main` na GitHub-u. Kad je novi commit i CI na njemu
 * prođe (testovi + build), pozove Coolify API da uradi Redeploy. Ako CI padne — ne deploy-uje i javi na Telegram.
 *
 * Env (Coolify → Environment Variables): COOLIFY_API_URL (npr. http://192.168.x.x:8000), COOLIFY_API_TOKEN
 * (Coolify → Keys & Tokens → API tokens, dozvola „deploy“). COOLIFY_RESOURCE_UUID i SOURCE_COMMIT daje Coolify sam.
 * Repo: DEPLOY_REPO (ili GITHUB_REPO), grana: DEPLOY_BRANCH (podrazumevano main).
 */
type State = { lastTriggered?: string; lastTriggeredAt?: string; reportedFail?: string; lastCheck?: string; note?: string };
const KEY = "autodeploy";
const cfg = () => ({
  url: (process.env.COOLIFY_API_URL ?? "").replace(/\/+$/, ""),
  token: process.env.COOLIFY_API_TOKEN ?? "",
  uuid: process.env.COOLIFY_RESOURCE_UUID ?? "",
  repo: process.env.DEPLOY_REPO || process.env.GITHUB_REPO || "",
  branch: process.env.DEPLOY_BRANCH || "main",
  deployed: process.env.SOURCE_COMMIT ?? "",
});
export const autodeployMissing = () => {
  const c = cfg();
  return [!c.url && "COOLIFY_API_URL", !c.token && "COOLIFY_API_TOKEN", !c.uuid && "COOLIFY_RESOURCE_UUID", !c.repo && "DEPLOY_REPO"].filter(Boolean) as string[];
};

async function readState(db: Db): Promise<State> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  return (row?.value as State | undefined) ?? {};
}
async function writeState(db: Db, s: State) {
  await db.insert(settings).values({ key: KEY, value: s }).onConflictDoUpdate({ target: settings.key, set: { value: s, updatedAt: new Date() } });
}

export async function autodeployStatus(db: Db) {
  const c = cfg();
  const s = await readState(db);
  return { enabled: autodeployMissing().length === 0, missing: autodeployMissing(), repo: c.repo || null, branch: c.branch, deployed: c.deployed || s.lastTriggered || null, ...s };
}

/** Jedna provera (pozadinski posao je zove na 2 minuta). */
export async function autodeployTick(db: Db) {
  if (autodeployMissing().length) return;
  const c = cfg();
  const tok = (await runtime(db)).githubToken;
  if (!tok) return;
  const s = await readState(db);
  const head = await ghFetch(tok, `/repos/${c.repo}/commits/${encodeURIComponent(c.branch)}`);
  if (!head.ok) return writeState(db, { ...s, lastCheck: new Date().toISOString(), note: `GitHub: HTTP ${head.status} (does the token see ${c.repo}?)` });
  const commit = (await head.json()) as { sha: string; commit: { message: string; committer?: { date?: string } } };
  const sha = commit.sha;
  const title = commit.commit.message.split("\n")[0]!.slice(0, 120);
  // Već radi ova verzija, ili je deploy za nju već pokrenut
  if (c.deployed && sha.startsWith(c.deployed.slice(0, 7))) return writeState(db, { ...s, lastCheck: new Date().toISOString(), note: "Up to date" });
  if (s.lastTriggered === sha) return writeState(db, { ...s, lastCheck: new Date().toISOString(), note: "Deploy started — waiting for the new version" });
  // CI na tom commit-u
  const checks = await ghFetch(tok, `/repos/${c.repo}/commits/${sha}/check-runs?per_page=50`);
  const runs = checks.ok ? ((await checks.json()) as { check_runs: Array<{ name: string; status: string; conclusion: string | null }> }).check_runs : [];
  const age = Date.now() - Date.parse(commit.commit.committer?.date ?? new Date().toISOString());
  if (runs.some((r) => r.status !== "completed")) return writeState(db, { ...s, lastCheck: new Date().toISOString(), note: `CI is running for ${sha.slice(0, 7)}` });
  const failed = runs.filter((r) => r.conclusion && !["success", "skipped", "neutral"].includes(r.conclusion));
  if (failed.length) {
    if (s.reportedFail !== sha) await sendTelegramText(`🔴 <b>CI failed</b> on ${c.branch} — not deploying.\n${sha.slice(0, 7)} ${title}\nFailed: ${failed.map((f) => f.name).join(", ")}`).catch(() => false);
    return writeState(db, { ...s, reportedFail: sha, lastCheck: new Date().toISOString(), note: `CI failed for ${sha.slice(0, 7)} — not deployed` });
  }
  // Bez CI-ja: sačekaj 10 min (da CI stigne da se pojavi), pa deploy
  if (!runs.length && age < 10 * 60_000) return writeState(db, { ...s, lastCheck: new Date().toISOString(), note: `Waiting for CI on ${sha.slice(0, 7)}` });
  const res = await fetch(`${c.url}/api/v1/deploy?uuid=${encodeURIComponent(c.uuid)}&force=false`, { headers: { Authorization: `Bearer ${c.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch((e) => ({ ok: false, status: 0, text: async () => (e as Error).message }) as Response);
  if (!res.ok) {
    const why = (await res.text()).slice(0, 160);
    return writeState(db, { ...s, lastCheck: new Date().toISOString(), note: `Coolify didn't start the deploy (HTTP ${res.status}): ${why}` });
  }
  await writeState(db, { ...s, lastTriggered: sha, lastTriggeredAt: new Date().toISOString(), lastCheck: new Date().toISOString(), note: "Deploy started" });
  await sendTelegramText(`🚀 <b>Deploying</b> ${sha.slice(0, 7)} — ${title}\nCI passed. Coolify is redeploying the server.`).catch(() => false);
}

export function startAutodeploy(getDb: () => Db) {
  if (autodeployMissing().length) return;
  const tick = () => void autodeployTick(getDb()).catch((e) => console.warn("[autodeploy]", (e as Error).message));
  setTimeout(tick, 30_000);
  setInterval(tick, 120_000);
}

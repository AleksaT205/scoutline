import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { ghFetch, projectRepoNames, projects, userGithubToken, type Db } from "@radar/db";
import { runtime } from "./runtime.js";

/**
 * „Run in browser“ bez spoljnog servisa: sajt (HTML/CSS/JS) iz repoa, za bilo koju granu.
 * Link je potpisan i važi 24 h (otvara se u novom tabu ili u kartici, bez prijave).
 * Fajlovi se čitaju preko GitHub API-ja tokenom osobe koja je napravila link (radi i za privatne repoe).
 * Sigurnost: odgovor ide sa CSP „sandbox“ — stranica nema pristup ničemu iz aplikacije.
 */
interface Guards {
  readGuard: MiddlewareHandler;
}
type Actor = { id: string | null; name: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 24 * 3_600_000;
const secret = () => process.env.SESSION_SECRET || createHash("sha256").update(`scoutline-preview:${process.env.API_TOKEN ?? "dev"}`).digest("hex");
const sign = (data: string) => createHmac("sha256", `preview:${secret()}`).update(data).digest("base64url").slice(0, 32);

interface Key {
  r: string; // owner/repo
  ref: string; // grana
  u: string | null; // ko je napravio link (njegov GitHub token)
  e: number; // ističe
}
const encode = (k: Key) => {
  const data = Buffer.from(JSON.stringify(k)).toString("base64url");
  return `${data}.${sign(data)}`;
};
const decode = (key: string): Key | null => {
  const [data, sig] = key.split(".");
  if (!data || !sig) return null;
  const want = sign(data);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const k = JSON.parse(Buffer.from(data, "base64url").toString()) as Key;
    return k.e > Date.now() ? k : null;
  } catch {
    return null;
  }
};

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  webmanifest: "application/manifest+json",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
};
const typeOf = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 20px;color:#333"><h2 style="margin:0 0 8px">${title}</h2>${body}</body>`;

export function previewRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };

  // POST /delivery/projects/:id/preview?repo=&ref= → { url } (potpisan link, 24 h)
  app.post("/delivery/projects/:id/preview", g.readGuard, async (c) => {
    const id = c.req.param("id")!;
    if (!UUID.test(id)) return c.json({ error: "Project not found." }, 404);
    const [p] = await getDb().select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!p) return c.json({ error: "Project not found." }, 404);
    const names = await projectRepoNames(getDb(), p);
    const want = c.req.query("repo") ?? names[0];
    const full = names.find((n) => n.toLowerCase() === (want ?? "").toLowerCase());
    if (!full) return c.json({ error: "Link a GitHub repo to the project first." }, 400);
    const ref = (c.req.query("ref") ?? "").trim().slice(0, 200) || "HEAD";
    // Iza Tailscale Funnel-a / proxy-ja: prava adresa i https
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
    const proto = c.req.header("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
    const base = `${proto}://${host}`;
    return c.json({ url: `${base}/preview/${encode({ r: full, ref, u: actor(c).id, e: Date.now() + TTL })}/` });
  });

  // GET /preview/:key/* — fajl iz repoa (index.html za folder)
  app.get("/preview/:key/*", async (c) => {
    const k = decode(c.req.param("key")!);
    if (!k) return c.html(page("Preview link expired", "<p>Open the preview again from Scoutline (Code → Run locally).</p>"), 410);
    const prefix = `/preview/${c.req.param("key")}/`;
    let path = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length)).replace(/^\/+/, "");
    if (path.includes("..")) return c.text("Bad path", 400);
    if (!path || path.endsWith("/")) path += "index.html";
    const tok = (await userGithubToken(getDb(), k.u)) ?? (await runtime(getDb())).githubToken;
    const enc = path.split("/").map(encodeURIComponent).join("/");
    const r = await ghFetch(tok, `/repos/${k.r}/contents/${enc}?ref=${encodeURIComponent(k.ref)}`, { headers: { Accept: "application/vnd.github.raw" } });
    const headers = {
      "Content-Type": typeOf(path),
      "Cache-Control": "private, max-age=30",
      // Stranica iz repoa radi u „sandbox“ (bez pristupa aplikaciji), može da se prikaže u kartici Scoutline-a
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
      "Cross-Origin-Resource-Policy": "cross-origin",
    };
    if (r.ok) {
      // Folder (GitHub vrati listu) → idi na folder/ da proradi index.html
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("application/json") && !path.endsWith(".json")) {
        const list = (await r.json().catch(() => null)) as unknown;
        if (Array.isArray(list)) return c.redirect(`${prefix}${path}/`);
      }
      return new Response(r.body, { status: 200, headers });
    }
    if (r.status === 404 && path.endsWith("index.html")) {
      return c.html(
        page(
          "Nothing to show here yet",
          `<p>There's no <code>${path}</code> in <b>${k.r}</b> (${k.ref === "HEAD" ? "main branch" : k.ref}).</p><p>This preview shows plain websites (HTML, CSS, JS). Apps that need a build step (React, Next, Vue…) run in StackBlitz or Codespaces — use those buttons in Scoutline.</p>`,
        ),
        404,
      );
    }
    return c.text(r.status === 404 ? "Not found" : `GitHub: HTTP ${r.status}`, r.status === 404 ? 404 : 502);
  });

  return app;
}

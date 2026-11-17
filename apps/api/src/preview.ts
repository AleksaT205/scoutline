import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { attachments, ghFetch, projectRepoNames, projects, userGithubToken, type Db } from "@radar/db";
import { runtime } from "./runtime.js";

/**
 * „Run in browser“ bez spoljnog servisa: sajt (HTML/CSS/JS) iz repoa, za bilo koju granu.
 * Link je potpisan i važi 24 h (otvara se u novom tabu ili u kartici, bez prijave).
 * Fajlovi se čitaju preko GitHub API-ja tokenom osobe koja je napravila link (radi i za privatne repoe).
 * Sigurnost: odgovor ide sa CSP „sandbox“ — stranica nema pristup ničemu iz aplikacije.
 */
interface Guards {
  readGuard: MiddlewareHandler;
  require: (min: "viewer" | "member" | "owner") => MiddlewareHandler;
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

/** Javna adresa API-ja (iza Tailscale Funnel-a / proxy-ja: prava adresa i https). */
export const publicBase = (c: Context) => {
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
  const proto = c.req.header("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
};
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
/** Potpisan, nepogodiv link ka slici (bez prijave — da je Claude u GitHub Actions može preuzeti). */
export const attachmentUrl = (base: string, id: string, mime: string) => `${base}/files/${id}/${sign(`file:${id}`)}.${IMAGE_TYPES[mime] ?? "bin"}`;

export function previewRoutes(getDb: () => Db, g: Guards) {
  const app = new Hono();
  const actor = (c: Context) => (c.get("actor" as never) as Actor | undefined) ?? { id: null, name: "team" };

  // POST /delivery/projects/:id/attachments { name, mime, data (base64) } → { id, url } — slika za razgovor sa Claude-om
  app.post("/delivery/projects/:id/attachments", g.require("member"), async (c) => {
    const id = c.req.param("id")!;
    if (!UUID.test(id)) return c.json({ error: "Project not found." }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; mime?: string; data?: string };
    const mime = String(b.mime ?? "");
    if (!IMAGE_TYPES[mime]) return c.json({ error: "Only PNG, JPG, WebP or GIF images." }, 400);
    const data = Buffer.from(String(b.data ?? "").replace(/^data:[^,]+,/, ""), "base64");
    if (!data.length) return c.json({ error: "Empty image." }, 400);
    if (data.length > 5 * 1024 * 1024) return c.json({ error: "Image is over 5 MB." }, 400);
    const [row] = await getDb()
      .insert(attachments)
      .values({ projectId: id, mime, name: String(b.name ?? "image").slice(0, 120), size: data.length, data, createdBy: actor(c).name })
      .returning({ id: attachments.id });
    return c.json({ id: row!.id, url: attachmentUrl(publicBase(c), row!.id, mime) }, 201);
  });

  // GET /files/:id/:sig.ext — slika (javno, ali samo sa potpisom)
  app.get("/files/:id/:file", async (c) => {
    const id = c.req.param("id")!;
    const sig = c.req.param("file")!.replace(/\.[a-z]+$/, "");
    if (!UUID.test(id) || sig.length !== 32 || !timingSafeEqual(Buffer.from(sig), Buffer.from(sign(`file:${id}`)))) return c.text("Not found", 404);
    const [row] = await getDb().select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (!row) return c.text("Not found", 404);
    return new Response(new Uint8Array(row.data), {
      headers: {
        "Content-Type": row.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  });

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

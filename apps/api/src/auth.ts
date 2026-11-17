import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { invites, shareLinks, users, type Db } from "@radar/db";

/**
 * Faza 5 — nalozi i uloge.
 *  owner  → sve, uključujući tim i pozivnice
 *  member → rad sa leadovima, router, podešavanja
 *  viewer → samo čitanje
 * API_TOKEN (stara timska lozinka) i dalje radi kao "owner" ključ — za skripte i za prvo podešavanje.
 */
export type Role = "owner" | "member" | "viewer";
/**
 * Owner nalog iz podešavanja servera (Coolify → Environment): OWNER_EMAIL + OWNER_PASSWORD.
 * Pri svakom startu: ako nalog ne postoji — napravi ga kao owner; ako postoji — lozinka i uloga se usklade sa env-om.
 * Najlakši način da se dobije (ili povrati) prijava bez pozivnica. Ko menja env servera ionako ima pun pristup.
 */
export async function ensureEnvOwner(db: Db) {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD ?? "";
  if (!email || !password) return;
  if (!/^\S+@\S+\.\S+$/.test(email)) return console.warn("[owner] OWNER_EMAIL nije ispravan email — preskačem");
  if (password.length < 8) return console.warn("[owner] OWNER_PASSWORD mora imati bar 8 znakova — preskačem");
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) {
    await db.insert(users).values({ email, name: email.split("@")[0]!, passwordHash: await hashPassword(password), role: "owner" });
    return console.log(`[owner] napravljen owner nalog ${email}`);
  }
  const same = await verifyPassword(password, u.passwordHash);
  if (same && u.role === "owner") return;
  await db
    .update(users)
    .set({ ...(same ? {} : { passwordHash: await hashPassword(password), tokenVersion: u.tokenVersion + 1 }), role: "owner", access: "all", updatedAt: new Date() })
    .where(eq(users.id, u.id));
  console.log(`[owner] nalog ${email} usklađen sa OWNER_EMAIL/OWNER_PASSWORD`);
}

/** Email demo naloga (nije pravi sandučić — služi samo za prijavu). */
export const DEMO_EMAIL = "demo@scoutline.demo";

export interface Actor {
  id: string | null; // null = API_TOKEN
  email: string;
  name: string;
  role: Role;
  access?: string; // all | sales | delivery
}
const RANK: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const got = await scrypt(pw, Buffer.from(salt, "base64"), 64);
  const want = Buffer.from(key, "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => process.env.SESSION_SECRET || sha256(`scoutline-session:${process.env.API_TOKEN ?? "dev"}`);
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const SESSION_DAYS = 30;

function signSession(userId: string, version: number): string {
  const body = b64(JSON.stringify({ uid: userId, v: version, exp: Date.now() + SESSION_DAYS * 86_400_000 }));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `s1.${body}.${sig}`;
}
function readSession(token: string): { uid: string; v: number } | null {
  const [prefix, body, sig] = token.split(".");
  if (prefix !== "s1" || !body || !sig) return null;
  const want = createHmac("sha256", secret()).update(body).digest("base64url");
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString()) as { uid: string; v: number; exp: number };
  return data.exp > Date.now() ? data : null;
}

function bearer(c: Context) {
  return c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}
function isApiToken(got: string) {
  const expected = process.env.API_TOKEN;
  if (!expected || !got) return false;
  return timingSafeEqual(createHash("sha256").update(got).digest(), createHash("sha256").update(expected).digest());
}

export function auth(getDb: () => Db) {
  let usersExistCache: boolean | null = null;
  const usersExist = async () => {
    if (usersExistCache) return true; // kad se prvi nalog napravi, ostaje true
    const [row] = await getDb().select({ n: count() }).from(users);
    usersExistCache = (row?.n ?? 0) > 0;
    return usersExistCache;
  };

  async function actorFrom(c: Context): Promise<Actor | null> {
    const token = bearer(c);
    if (!token) return null;
    if (isApiToken(token)) return { id: null, email: "team-password", name: "Team password", role: "owner" };
    const session = readSession(token);
    if (!session) return null;
    const [u] = await getDb().select().from(users).where(eq(users.id, session.uid)).limit(1);
    if (!u || u.tokenVersion !== session.v) return null;
    return { id: u.id, email: u.email, name: u.name, role: u.role, access: u.access };
  }

  /** Zahteva prijavu sa najmanje datom ulogom. */
  const require =
    (min: Role): MiddlewareHandler =>
    async (c, next) => {
      const actor = await actorFrom(c);
      if (!actor) {
        if (!process.env.API_TOKEN && !(await usersExist())) return c.json({ error: "Editing is disabled: set API_TOKEN on the server." }, 503);
        return c.json({ error: "Please sign in.", code: "auth_required" }, 401);
      }
      if (RANK[actor.role] < RANK[min]) return c.json({ error: "Your role doesn't allow this action." }, 403);
      c.set("actor" as never, actor as never);
      await next();
    };

  /** Deo aplikacije: korisnik sa pristupom samo „sales“ ne vidi Delivery i obrnuto (vlasnik vidi sve). */
  const space =
    (s: "sales" | "delivery"): MiddlewareHandler =>
    async (c, next) => {
      const a = await actorFrom(c);
      if (a?.id && a.role !== "owner" && a.access && a.access !== "all" && a.access !== s)
        return c.json({ error: `Your account has access to ${a.access === "sales" ? "Sales" : "Delivery"} only.` }, 403);
      await next();
    };

  /** Čitanje podataka: dok nema naloga je javno (kao ranije); posle toga traži prijavu. */
  const readGuard: MiddlewareHandler = async (c, next) => {
    if (!(await usersExist())) return next();
    return require("viewer")(c, next);
  };

  const routes = new Hono();

  routes.get("/state", async (c) => c.json({ hasUsers: await usersExist() }));

  // Prvi nalog (owner) — potvrđuje se starom timskom lozinkom
  routes.post("/setup", async (c) => {
    if (await usersExist()) return c.json({ error: "Setup is already done — sign in instead." }, 409);
    const input = await c.req.json<{ email?: string; name?: string; password?: string; teamPassword?: string }>().catch(() => null);
    if (!isApiToken(input?.teamPassword ?? "")) return c.json({ error: "Wrong team password." }, 401);
    const email = input?.email?.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: "Enter a valid email." }, 400);
    if ((input?.password ?? "").length < 8) return c.json({ error: "Password must be at least 8 characters." }, 400);
    const [u] = await getDb()
      .insert(users)
      .values({ email, name: input?.name?.trim() || email.split("@")[0]!, passwordHash: await hashPassword(input!.password!), role: "owner", lastLoginAt: new Date() })
      .returning();
    usersExistCache = true;
    return c.json({ token: signSession(u!.id, u!.tokenVersion), user: publicUser(u!) }, 201);
  });

  // Zaštita od pogađanja lozinke: najviše 10 pokušaja po emailu u 15 minuta
  const attempts = new Map<string, { n: number; until: number }>();
  routes.post("/login", async (c) => {
    const input = await c.req.json<{ email?: string; password?: string }>().catch(() => null);
    const email = input?.email?.trim().toLowerCase() ?? "";
    const a = attempts.get(email);
    if (a && a.until > Date.now() && a.n >= 10) return c.json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    const [u] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
    // Ista poruka i za nepostojeći email i za pogrešnu lozinku
    if (!u || !(await verifyPassword(input?.password ?? "", u.passwordHash))) {
      const cur = attempts.get(email);
      attempts.set(email, cur && cur.until > Date.now() ? { n: cur.n + 1, until: cur.until } : { n: 1, until: Date.now() + 15 * 60_000 });
      return c.json({ error: "Wrong email or password." }, 401);
    }
    attempts.delete(email);
    await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    return c.json({ token: signSession(u.id, u.tokenVersion), user: publicUser(u) });
  });

  // Zaboravljena lozinka: bez email servera — nova lozinka se potvrđuje timskom lozinkom (API_TOKEN),
  // isto kao prvo podešavanje. Ko ima API_TOKEN već ima pun pristup, pa ovo ne otvara ništa novo.
  routes.post("/recover", async (c) => {
    const input = await c.req.json<{ email?: string; password?: string; teamPassword?: string }>().catch(() => null);
    const email = input?.email?.trim().toLowerCase() ?? "";
    const key = `recover:${email}`;
    const a = attempts.get(key);
    if (a && a.until > Date.now() && a.n >= 10) return c.json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    if (!isApiToken(input?.teamPassword ?? "")) {
      const cur = attempts.get(key);
      attempts.set(key, cur && cur.until > Date.now() ? { n: cur.n + 1, until: cur.until } : { n: 1, until: Date.now() + 15 * 60_000 });
      return c.json({ error: "Wrong team password." }, 401);
    }
    if ((input?.password ?? "").length < 8) return c.json({ error: "New password must be at least 8 characters." }, 400);
    const [u] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
    if (!u) return c.json({ error: "No account with this email." }, 404);
    const [updated] = await getDb()
      .update(users)
      .set({ passwordHash: await hashPassword(input!.password!), tokenVersion: u.tokenVersion + 1, lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, u.id))
      .returning();
    attempts.delete(key);
    attempts.delete(email);
    return c.json({ token: signSession(updated!.id, updated!.tokenVersion), user: publicUser(updated!) });
  });

  routes.get("/me", require("viewer"), (c) => c.json({ user: c.get("actor" as never) }));

  // Promena profila / lozinke
  routes.patch("/me", require("viewer"), async (c) => {
    const actor = c.get("actor" as never) as Actor;
    if (!actor.id) return c.json({ error: "Sign in with your account to edit your profile." }, 400);
    const input = await c.req.json<{ name?: string; currentPassword?: string; newPassword?: string }>().catch(() => null);
    const [u] = await getDb().select().from(users).where(eq(users.id, actor.id)).limit(1);
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input?.name?.trim()) patch.name = input.name.trim();
    if (input?.newPassword) {
      if (input.newPassword.length < 8) return c.json({ error: "New password must be at least 8 characters." }, 400);
      if (!(await verifyPassword(input.currentPassword ?? "", u!.passwordHash))) return c.json({ error: "Current password is wrong." }, 401);
      patch.passwordHash = await hashPassword(input.newPassword);
      patch.tokenVersion = u!.tokenVersion + 1; // odjava sa ostalih uređaja
    }
    const [updated] = await getDb().update(users).set(patch).where(eq(users.id, actor.id)).returning();
    return c.json({ user: publicUser(updated!), token: signSession(updated!.id, updated!.tokenVersion) });
  });

  // Prihvatanje pozivnice → novi nalog
  routes.get("/invite/:token", async (c) => {
    const inv = await findInvite(getDb(), c.req.param("token")!);
    return inv ? c.json({ email: inv.email, role: inv.role }) : c.json({ error: "This invite link is invalid or expired." }, 404);
  });
  routes.post("/invite/:token", async (c) => {
    const db = getDb();
    const inv = await findInvite(db, c.req.param("token")!);
    if (!inv) return c.json({ error: "This invite link is invalid or expired." }, 404);
    const input = await c.req.json<{ email?: string; name?: string; password?: string }>().catch(() => null);
    const email = (inv.email ?? input?.email ?? "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: "Enter a valid email." }, 400);
    if ((input?.password ?? "").length < 8) return c.json({ error: "Password must be at least 8 characters." }, 400);
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (exists) return c.json({ error: "An account with this email already exists — sign in instead." }, 409);
    const [u] = await db
      .insert(users)
      .values({ email, name: input?.name?.trim() || email.split("@")[0]!, passwordHash: await hashPassword(input!.password!), role: inv.role, lastLoginAt: new Date() })
      .returning();
    await db.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, inv.id));
    usersExistCache = true;
    return c.json({ token: signSession(u!.id, u!.tokenVersion), user: publicUser(u!) }, 201);
  });

  // ── Tim (owner upravlja, member vidi) ──────────────────────────────────────
  const team = new Hono();
  team.get("/", require("member"), async (c) => {
    const db = getDb();
    const list = await db.select().from(users).orderBy(users.createdAt);
    const pending = await db
      .select()
      .from(invites)
      .where(and(isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt));
    return c.json({
      users: list.map(publicUser),
      invites: pending.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt })),
    });
  });
  team.post("/invites", require("owner"), async (c) => {
    const input = await c.req.json<{ email?: string; role?: Role }>().catch(() => null);
    const role: Role = input?.role && RANK[input.role] !== undefined ? input.role : "member";
    const token = randomBytes(24).toString("base64url");
    const actor = c.get("actor" as never) as Actor;
    await getDb()
      .insert(invites)
      .values({ tokenHash: sha256(token), email: input?.email?.trim().toLowerCase() || null, role, createdBy: actor.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    return c.json({ token, role, expiresInDays: 7 }, 201);
  });
  // Demo nalog jednim klikom (Settings → Team): Member sa pristupom svemu, nasumična lozinka koju vidi samo vlasnik.
  // Ponovni klik = nova lozinka (stara prijava prestaje da važi). Uklanja se kao svaki član.
  team.post("/demo", require("owner"), async (c) => {
    const db = getDb();
    const password = `demo-${randomBytes(8).toString("base64url").replace(/[-_]/g, "x")}`;
    const [existing] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
    if (existing) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(password), tokenVersion: existing.tokenVersion + 1, role: existing.role === "owner" ? "member" : existing.role, access: "all", updatedAt: new Date() })
        .where(eq(users.id, existing.id));
      return c.json({ email: DEMO_EMAIL, password, created: false });
    }
    await db.insert(users).values({ email: DEMO_EMAIL, name: "Demo", passwordHash: await hashPassword(password), role: "member", access: "all" });
    usersExistCache = true;
    return c.json({ email: DEMO_EMAIL, password, created: true }, 201);
  });
  team.delete("/invites/:id", require("owner"), async (c) => {
    await getDb().update(invites).set({ expiresAt: new Date() }).where(eq(invites.id, c.req.param("id")!));
    return c.json({ ok: true });
  });
  team.patch("/users/:id", require("owner"), async (c) => {
    const input = await c.req.json<{ role?: Role; access?: string }>().catch(() => null);
    const db = getDb();
    // Pristup delu aplikacije (Sales / Delivery / oba)
    if (input?.access !== undefined && !input.role) {
      if (!["all", "sales", "delivery"].includes(input.access)) return c.json({ error: "Access must be all, sales or delivery." }, 400);
      const [u] = await db.update(users).set({ access: input.access, updatedAt: new Date() }).where(eq(users.id, c.req.param("id")!)).returning();
      return u ? c.json({ user: publicUser(u) }) : c.json({ error: "User not found." }, 404);
    }
    if (!input?.role || RANK[input.role] === undefined) return c.json({ error: "Role must be owner, member or viewer." }, 400);
    if (input.role !== "owner") {
      const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, "owner"));
      if (owners.length === 1 && owners[0]!.id === c.req.param("id")) return c.json({ error: "The team needs at least one owner." }, 400);
    }
    const [u] = await db.update(users).set({ role: input.role, updatedAt: new Date() }).where(eq(users.id, c.req.param("id")!)).returning();
    return u ? c.json({ user: publicUser(u) }) : c.json({ error: "User not found." }, 404);
  });
  team.delete("/users/:id", require("owner"), async (c) => {
    const actor = c.get("actor" as never) as Actor;
    if (actor.id === c.req.param("id")) return c.json({ error: "You can't remove yourself." }, 400);
    await getDb().delete(users).where(eq(users.id, c.req.param("id")!));
    return c.json({ ok: true });
  });

  // Linkovi samo za pregled
  team.get("/shares", require("member"), async (c) => {
    const list = await getDb().select().from(shareLinks).where(isNull(shareLinks.revokedAt)).orderBy(desc(shareLinks.createdAt));
    return c.json({ shares: list.map(({ tokenHash: _t, ...s }) => s) });
  });
  team.post("/shares", require("member"), async (c) => {
    const input = await c.req.json<{ label?: string; minScore?: number; days?: number }>().catch(() => null);
    const token = randomBytes(24).toString("base64url");
    const actor = c.get("actor" as never) as Actor;
    const days = Number(input?.days) > 0 ? Math.min(Number(input!.days), 365) : null;
    const [s] = await getDb()
      .insert(shareLinks)
      .values({
        tokenHash: sha256(token),
        label: input?.label?.trim() || "Shared view",
        minScore: Math.max(0, Math.min(100, Number(input?.minScore) || 0)),
        createdBy: actor.id,
        expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
      })
      .returning();
    const { tokenHash: _t, ...share } = s!;
    return c.json({ token, share }, 201);
  });
  team.delete("/shares/:id", require("member"), async (c) => {
    await getDb().update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, c.req.param("id")!));
    return c.json({ ok: true });
  });

  /** Proveri link za pregled (javni pristup). */
  async function findShare(token: string) {
    const [s] = await getDb()
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.tokenHash, sha256(token)), isNull(shareLinks.revokedAt)))
      .limit(1);
    if (!s || (s.expiresAt && s.expiresAt < new Date())) return null;
    await getDb().update(shareLinks).set({ lastViewedAt: new Date() }).where(eq(shareLinks.id, s.id));
    return s;
  }

  return { require, readGuard, space, routes, team, findShare, actorFrom, usersExist };
}

function publicUser(u: typeof users.$inferSelect) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, access: u.access, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt };
}

async function findInvite(db: Db, token: string) {
  const [inv] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
    .limit(1);
  return inv ?? null;
}

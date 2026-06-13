import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AuthContext } from "../auth/context.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { generateSecret, otpauthUri, verifyTotp, qrDataUrl } from "../auth/totp.js";
import { isLocal } from "../auth/origin.js";

export const CLIENT_IP = "clientIp";
const COOKIE = "tormod_session";
const SECS_PER_DAY = 86_400;

interface Registration {
  username: string;
  email: string;
  password: string;
}

function validateRegistration(body: Record<string, unknown>): Registration | null {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (username.length < 3 || !email.includes("@") || password.length < 8) return null;
  return { username, email, password };
}

function clientIp(c: { get: (k: string) => unknown }): string {
  return (c.get(CLIENT_IP) as string) ?? "";
}

function bearerToken(c: { req: { header: (k: string) => string | undefined } }): string | undefined {
  const h = c.req.header("Authorization");
  if (!h || !h.startsWith("Bearer ")) return undefined;
  return h.slice(7) || undefined;
}

function wantsToken(c: { req: { header: (k: string) => string | undefined } }): boolean {
  return c.req.header("X-Tormod-Client") === "native";
}

function originIsLocal(c: { get: (k: string) => unknown }, ctx: AuthContext): boolean {
  return isLocal(clientIp(c), ctx.config.trustedCidrs);
}

function sessionCookieOpts(ctx: AuthContext, maxAgeSec: number) {
  return {
    httpOnly: true as const,
    secure: ctx.config.cookieSecure,
    sameSite: "Strict" as const,
    path: "/api",
    maxAge: maxAgeSec,
  };
}

function requireCsrf(c: { req: { method: string; header: (k: string) => string | undefined } }): boolean {
  const m = c.req.method;
  if (m === "GET" || m === "HEAD") return true;
  return c.req.header("X-Tormod") === "1";
}

export function sessionMiddleware(ctx: AuthContext) {
  return async (c: any, next: () => Promise<void>) => {
    const id = bearerToken(c) ?? getCookie(c, COOKIE);
    if (!id || !ctx.sessions.validate(id)) return c.json({ error: "unauthorized" }, 401);
    await next();
  };
}

export function registerAuthRoutes(app: Hono<any>, ctx: AuthContext): void {
  app.use("/api/auth/*", async (c, next) => {
    if (!requireCsrf(c)) return c.json({ error: "forbidden" }, 403);
    await next();
  });

  const issue = (c: any): string => {
    const ttlSec = ctx.config.sessionTtlDays * SECS_PER_DAY;
    const { id } = ctx.sessions.issue();
    setCookie(c, COOKIE, id, sessionCookieOpts(ctx, ttlSec));
    return id;
  };

  app.get("/api/auth/status", (c) => {
    return c.json({
      registered: ctx.users.hasUser(),
      external: !originIsLocal(c, ctx),
      totpEnabled: ctx.users.getCredentials()?.totpEnabled ?? false,
    });
  });

  app.post("/api/auth/register", async (c) => {
    if (ctx.users.hasUser()) return c.json({ error: "already registered" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = validateRegistration(body);
    if (!input) return c.json({ error: "invalid input" }, 400);
    ctx.users.create({
      username: input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });
    const id = issue(c);
    return c.json(wantsToken(c) ? { ok: true, token: id } : { ok: true }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const ip = clientIp(c);
    if (!ctx.throttle.checkIp(ip)) return c.json({ error: "too many attempts" }, 429);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const totp = typeof body.totp === "string" ? body.totp : "";

    const creds = ctx.users.getCredentials();
    const generic = () => c.json({ error: "invalid credentials" }, 401);

    if (!creds || creds.username !== username) return generic();
    if (ctx.throttle.isLocked(username)) return c.json({ error: "account temporarily locked" }, 429);

    const passwordOk = await verifyPassword(creds.passwordHash, password);
    const local = originIsLocal(c, ctx);

    if (!local && !creds.totpEnabled) {
      return c.json({ error: "2fa required: connect via lan/vpn to enroll first" }, 403);
    }

    let ok = passwordOk;
    if (!local && creds.totpEnabled) {
      ok = passwordOk && !!creds.totpSecret && verifyTotp(totp, creds.totpSecret);
    }

    if (!ok) {
      ctx.throttle.recordFailure(username);
      return generic();
    }
    ctx.throttle.recordSuccess(username);
    const id = issue(c);
    return c.json(wantsToken(c) ? { ok: true, token: id } : { ok: true });
  });

  app.post("/api/auth/logout", sessionMiddleware(ctx), (c) => {
    const id = getCookie(c, COOKIE);
    if (id) ctx.sessions.revoke(id);
    deleteCookie(c, COOKIE, { path: "/api" });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", sessionMiddleware(ctx), (c) => {
    const p = ctx.users.profile();
    if (!p) return c.json({ error: "no user" }, 404);
    return c.json(p);
  });

  const localOnly = async (c: any, next: () => Promise<void>) => {
    if (!originIsLocal(c, ctx)) return c.json({ error: "2fa management is local-only" }, 403);
    await next();
  };

  app.post("/api/auth/totp/enroll", sessionMiddleware(ctx), localOnly, async (c) => {
    const profile = ctx.users.profile();
    if (!profile) return c.json({ error: "no user" }, 404);
    const secret = generateSecret();
    ctx.users.setTotpSecret(secret);
    const uri = otpauthUri(profile.username, secret);
    return c.json({ secret, otpauthUri: uri, qrDataUrl: await qrDataUrl(uri) });
  });

  app.post("/api/auth/totp/confirm", sessionMiddleware(ctx), localOnly, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    const creds = ctx.users.getCredentials();
    if (!creds?.totpSecret || !verifyTotp(token, creds.totpSecret)) {
      return c.json({ error: "invalid code" }, 400);
    }
    ctx.users.enableTotp();
    return c.json({ ok: true });
  });

  app.post("/api/auth/totp/disable", sessionMiddleware(ctx), localOnly, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    const creds = ctx.users.getCredentials();
    if (!creds || !(await verifyPassword(creds.passwordHash, password))) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    ctx.users.disableTotp();
    return c.json({ ok: true });
  });
}

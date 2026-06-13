import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { registerAuthRoutes, sessionMiddleware, CLIENT_IP } from "./auth.js";
import { UserStore } from "../auth/users.js";
import { AuthSessionStore } from "../auth/authSessions.js";
import { Throttle } from "../auth/throttle.js";
import type { AuthContext } from "../auth/context.js";
import { generateSync } from "otplib";

type Env = { Variables: { [CLIENT_IP]: string } };

function build(ip = "192.168.0.10"): Hono<Env> {
  const ctx: AuthContext = {
    users: UserStore.open(":memory:"),
    sessions: AuthSessionStore.open(":memory:", 30),
    throttle: new Throttle(),
    config: { trustedProxy: null, trustedCidrs: ["192.168.0.0/24", "10.0.0.0/24"], cookieSecure: false, sessionTtlDays: 30 },
  };
  const app = new Hono<Env>();
  app.use("*", async (c, next) => { c.set(CLIENT_IP, c.req.header("x-test-ip") ?? ip); await next(); });
  registerAuthRoutes(app, ctx);
  app.use("/api/protected", sessionMiddleware(ctx));
  app.get("/api/protected", (c) => c.json({ ok: true }));
  return app;
}

const J = { "Content-Type": "application/json", "X-Tormod": "1" };

function cookieFrom(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  return set.split(";")[0] ?? "";
}

describe("auth routes", () => {
  it("status reports unregistered, local origin", async () => {
    const res = await build().request("/api/auth/status");
    expect(await res.json()).toEqual({ registered: false, external: false, totpEnabled: false });
  });

  it("registers once, then refuses a second registration", async () => {
    const app = build();
    const r1 = await app.request("/api/auth/register", {
      method: "POST", headers: J,
      body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    expect(r1.status).toBe(201);
    expect(cookieFrom(r1)).toContain("tormod_session=");
    const r2 = await app.request("/api/auth/register", {
      method: "POST", headers: J,
      body: JSON.stringify({ username: "loki", email: "l@x.dev", password: "whatever123" }),
    });
    expect(r2.status).toBe(403);
  });

  it("logs in locally with just the password and reaches a protected route", async () => {
    const app = build();
    await app.request("/api/auth/register", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    const login = await app.request("/api/auth/login", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", password: "hunter2hunter2" }),
    });
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login);
    const prot = await app.request("/api/protected", { headers: { ...J, Cookie: cookie } });
    expect(prot.status).toBe(200);
  });

  it("rejects a wrong password with a generic 401", async () => {
    const app = build();
    await app.request("/api/auth/register", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    const res = await app.request("/api/auth/login", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", password: "wrong" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid credentials" });
  });

  it("blocks the protected route without a session cookie", async () => {
    const res = await build().request("/api/protected", { headers: J });
    expect(res.status).toBe(401);
  });

  it("external login is refused when totp is not enrolled", async () => {
    const app = build();
    await app.request("/api/auth/register", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    const res = await app.request("/api/auth/login", {
      method: "POST", headers: { ...J, "x-test-ip": "203.0.113.9" },
      body: JSON.stringify({ username: "odin", password: "hunter2hunter2" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain("2fa");
  });

  it("enrolls totp locally then requires the code on external login", async () => {
    const app = build();
    await app.request("/api/auth/register", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    const login = await app.request("/api/auth/login", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", password: "hunter2hunter2" }),
    });
    const cookie = cookieFrom(login);

    const enroll = await app.request("/api/auth/totp/enroll", { method: "POST", headers: { ...J, Cookie: cookie } });
    const { secret } = (await enroll.json()) as { secret: string; otpauthUri: string; qrDataUrl: string };
    const confirm = await app.request("/api/auth/totp/confirm", {
      method: "POST", headers: { ...J, Cookie: cookie }, body: JSON.stringify({ token: generateSync({ secret }) }),
    });
    expect(confirm.status).toBe(200);

    const extNoCode = await app.request("/api/auth/login", {
      method: "POST", headers: { ...J, "x-test-ip": "203.0.113.9" },
      body: JSON.stringify({ username: "odin", password: "hunter2hunter2" }),
    });
    expect(extNoCode.status).toBe(401);

    const extWithCode = await app.request("/api/auth/login", {
      method: "POST", headers: { ...J, "x-test-ip": "203.0.113.9" },
      body: JSON.stringify({ username: "odin", password: "hunter2hunter2", totp: generateSync({ secret }) }),
    });
    expect(extWithCode.status).toBe(200);
  });

  it("accepts a bearer token on a protected route", async () => {
    const app = build();
    const reg = await app.request("/api/auth/register", {
      method: "POST", headers: J,
      body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    const token = cookieFrom(reg).split("=")[1] ?? "";
    const prot = await app.request("/api/protected", { headers: { ...J, Authorization: `Bearer ${token}` } });
    expect(prot.status).toBe(200);
  });

  it("rejects an invalid bearer token", async () => {
    const prot = await build().request("/api/protected", { headers: { ...J, Authorization: "Bearer nope" } });
    expect(prot.status).toBe(401);
  });

  it("returns a token in the body for a native client and it authenticates", async () => {
    const app = build();
    const reg = await app.request("/api/auth/register", {
      method: "POST", headers: { ...J, "X-Tormod-Client": "native" },
      body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    const { token } = (await reg.json()) as { token?: string };
    expect(typeof token).toBe("string");
    const prot = await app.request("/api/protected", { headers: { ...J, Authorization: `Bearer ${token}` } });
    expect(prot.status).toBe(200);
  });

  it("login returns a token for a native client", async () => {
    const app = build();
    await app.request("/api/auth/register", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    const login = await app.request("/api/auth/login", {
      method: "POST", headers: { ...J, "X-Tormod-Client": "native" },
      body: JSON.stringify({ username: "odin", password: "hunter2hunter2" }),
    });
    expect(typeof (await login.json() as { token?: string }).token).toBe("string");
  });

  it("omits the token for a normal (web) client", async () => {
    const app = build();
    const reg = await app.request("/api/auth/register", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    expect(await reg.json()).toEqual({ ok: true });
  });

  it("rejects a mutation missing the CSRF header", async () => {
    const app = build();
    const res = await app.request("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    expect(res.status).toBe(403);
  });
});

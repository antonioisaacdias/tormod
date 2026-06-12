import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { SessionManager } from "../session/manager.js";
import { FakeBrainAdapter } from "../brain/fake.js";
import { Audit } from "../audit/audit.js";
import { SettingsStore } from "../settings/store.js";
import { UserStore } from "../auth/users.js";
import { AuthSessionStore } from "../auth/authSessions.js";
import { Throttle } from "../auth/throttle.js";
import type { AuthContext } from "../auth/context.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function ctx(): AuthContext {
  return {
    users: UserStore.open(":memory:"),
    sessions: AuthSessionStore.open(":memory:", 30),
    throttle: new Throttle(),
    config: { trustedProxy: null, trustedCidrs: ["127.0.0.0/8", "::1/128"], cookieSecure: false, sessionTtlDays: 30 },
  };
}

function appWith(auth: AuthContext) {
  const settings = SettingsStore.open(":memory:");
  const mgr = new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"), undefined, settings);
  return createApp(mgr, { auth, settings });
}

const J = { "Content-Type": "application/json", "X-Tormod": "1" };

async function authedApp() {
  const auth = ctx();
  const a = appWith(auth);
  const reg = await a.request("/api/auth/register", {
    method: "POST", headers: J, body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
  });
  const cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { app: a, headers: { ...J, Cookie: cookie } };
}

describe("createApp — auth", () => {
  it("rejects requests without a session", async () => {
    const a = appWith(ctx());
    const res = await a.request("/api/sessions", { method: "GET" });
    expect(res.status).toBe(401);
  });
  it("accepts requests with a valid session cookie", async () => {
    const { app, headers } = await authedApp();
    const res = await app.request("/api/sessions", { headers });
    expect(res.status).toBe(200);
  });
});

describe("createApp — sessions", () => {
  it("creates then lists a session", async () => {
    const { app, headers } = await authedApp();
    const created = await app.request("/api/sessions", {
      method: "POST", headers,
      body: JSON.stringify({ title: "hi" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toMatch(/.+/);

    const listed = await app.request("/api/sessions", { headers });
    const sessions = (await listed.json()) as Array<{ id: string }>;
    expect(sessions.map((s) => s.id)).toContain(id);
  });

  it("posting a message returns 202", async () => {
    const { app, headers } = await authedApp();
    const created = await app.request("/api/sessions", {
      method: "POST", headers, body: "{}",
    });
    const { id } = (await created.json()) as { id: string };
    const res = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST", headers,
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(202);
  });
});

describe("createApp — settings", () => {
  it("GET /api/settings returns defaults; PUT updates", async () => {
    const settings = SettingsStore.open(":memory:");
    const auth = ctx();
    const a = createApp(
      new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"), undefined, settings),
      { auth, settings },
    );
    const reg = await a.request("/api/auth/register", {
      method: "POST", headers: J, body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    const cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const h = { ...J, Cookie: cookie };

    const got = await a.request("/api/settings", { headers: h });
    expect(got.status).toBe(200);
    expect(((await got.json()) as { maxLiveSessions: number }).maxLiveSessions).toBe(5);

    const put = await a.request("/api/settings", { method: "PUT", headers: h, body: JSON.stringify({ maxLiveSessions: 3 }) });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { maxLiveSessions: number }).maxLiveSessions).toBe(3);
  });

  it("settings routes require auth", async () => {
    const settings = SettingsStore.open(":memory:");
    const a = createApp(
      new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"), undefined, settings),
      { auth: ctx(), settings },
    );
    const res = await a.request("/api/settings");
    expect(res.status).toBe(401);
  });
});

describe("createApp — static web", () => {
  function appWithWeb() {
    const dir = mkdtempSync(join(tmpdir(), "tormod-web-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Tormod</title><div id=root></div>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    const settings = SettingsStore.open(":memory:");
    const mgr = new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"), undefined, settings);
    return createApp(mgr, { auth: ctx(), settings, webDist: dir });
  }

  it("serves index.html at the root", async () => {
    const res = await appWithWeb().request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Tormod");
  });

  it("serves static assets", async () => {
    const res = await appWithWeb().request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  it("falls back to index.html for an unknown client route", async () => {
    const res = await appWithWeb().request("/some/spa/route");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Tormod");
  });

  it("keeps /api gated even with static serving on", async () => {
    const res = await appWithWeb().request("/api/sessions");
    expect(res.status).toBe(401);
  });
});

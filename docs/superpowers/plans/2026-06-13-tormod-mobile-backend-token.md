# Mobile MVP — Plano 1: Backend (token seam + CORS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Hono backend authenticate decoupled clients via an `Authorization: Bearer <session id>` header (alongside the existing cookie) and accept cross-origin requests from the Capacitor app, without changing any web behaviour.

**Architecture:** Additive only. The Bearer token *is* the opaque `auth_sessions` id that already backs the cookie — `sessionMiddleware` reads it from the header or the cookie. `login`/`register` return that id in the body when the caller is the native client (`X-Tormod-Client: native`). A `hono/cors` middleware allows the configured native origin (`http://localhost`). Same-origin web traffic never triggers CORS and keeps using the cookie.

**Tech Stack:** Node + Hono, TypeScript (strict, ESM with `.js` import specifiers), better-sqlite3, Vitest.

**Series:** This is Plan 1 of the mobile MVP (spec: `docs/superpowers/specs/2026-06-13-tormod-mobile-capacitor-design.md`, milestone 0.5.0). Phase B (frontend platform seam + server-address screen) and Phase C (Capacitor shell + SSE spike) are separate plans, written after this lands.

---

## File structure

- `apps/server/src/http/auth.ts` — **modify.** Add `bearerToken()` and `wantsToken()` module helpers; make `sessionMiddleware` accept Bearer; make `issue()` return the id; make `login`/`register` return the token for native clients.
- `apps/server/src/http/auth.test.ts` — **modify.** New tests for Bearer acceptance and token-in-body.
- `apps/server/src/http/app.ts` — **modify.** Add `corsOrigins` to `AppOptions`; mount `hono/cors` on `/api/*`.
- `apps/server/src/http/app.test.ts` — **modify.** New tests for the CORS preflight.
- `apps/server/src/server.ts` — **modify.** Read `TORMOD_CORS_ORIGINS`, pass to `createApp`.
- `README.md` — **modify.** Document token auth + the new env var.

Run all server commands from `apps/server` (`cd /home/odin/tormod/apps/server`). Branch: `feat/mobile-capacitor`.

---

### Task 1: Accept a Bearer token in `sessionMiddleware`

**Files:**
- Modify: `apps/server/src/http/auth.ts`
- Test: `apps/server/src/http/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two `it(...)` blocks inside the `describe("auth routes", ...)` block in `apps/server/src/http/auth.test.ts` (the `build()` helper exposes `/api/protected`; the session id is the value of the `tormod_session` cookie):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/http/auth.test.ts -t "bearer"`
Expected: the "accepts a bearer token" test FAILS (got 401, expected 200) — the middleware only reads the cookie today.

- [ ] **Step 3: Implement Bearer extraction**

In `apps/server/src/http/auth.ts`, add this module-level helper next to the other helpers (e.g. just after `clientIp`):

```ts
function bearerToken(c: { req: { header: (k: string) => string | undefined } }): string | undefined {
  const h = c.req.header("Authorization");
  if (!h || !h.startsWith("Bearer ")) return undefined;
  return h.slice(7).trim() || undefined;
}
```

Then change `sessionMiddleware` so it reads the Bearer token first, falling back to the cookie:

```ts
export function sessionMiddleware(ctx: AuthContext) {
  return async (c: any, next: () => Promise<void>) => {
    const id = bearerToken(c) ?? getCookie(c, COOKIE);
    if (!id || !ctx.sessions.validate(id)) return c.json({ error: "unauthorized" }, 401);
    await next();
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/http/auth.test.ts`
Expected: all auth-route tests PASS (the new two plus the existing ones — cookie auth must still work).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/http/auth.ts apps/server/src/http/auth.test.ts
git commit -m "feat(auth): accept bearer token in session middleware"
```

---

### Task 2: Return the session token to native clients

**Files:**
- Modify: `apps/server/src/http/auth.ts`
- Test: `apps/server/src/http/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these three `it(...)` blocks inside `describe("auth routes", ...)` in `apps/server/src/http/auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/http/auth.test.ts -t "native"`
Expected: the two "native" tests FAIL — `token` is `undefined` (the handlers return only `{ ok: true }`).

- [ ] **Step 3: Implement the token-return path**

In `apps/server/src/http/auth.ts`:

(a) Add a module-level helper next to `bearerToken`:

```ts
function wantsToken(c: { req: { header: (k: string) => string | undefined } }): boolean {
  return c.req.header("X-Tormod-Client") === "native";
}
```

(b) Make the inner `issue` helper **return the id** (it currently returns `void`). Change it to:

```ts
  const issue = (c: any): string => {
    const ttlSec = ctx.config.sessionTtlDays * SECS_PER_DAY;
    const { id } = ctx.sessions.issue();
    setCookie(c, COOKIE, id, sessionCookieOpts(ctx, ttlSec));
    return id;
  };
```

(c) In the `register` handler, replace `issue(c); return c.json({ ok: true }, 201);` with:

```ts
    const id = issue(c);
    return c.json(wantsToken(c) ? { ok: true, token: id } : { ok: true }, 201);
```

(d) In the `login` handler, replace the success tail `ctx.throttle.recordSuccess(username); issue(c); return c.json({ ok: true });` with:

```ts
    ctx.throttle.recordSuccess(username);
    const id = issue(c);
    return c.json(wantsToken(c) ? { ok: true, token: id } : { ok: true });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/http/auth.test.ts`
Expected: all auth-route tests PASS (native tokens work; the web client still gets exactly `{ ok: true }`).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/http/auth.ts apps/server/src/http/auth.test.ts
git commit -m "feat(auth): return session token to native clients on login/register"
```

---

### Task 3: Allow the native origin via CORS

**Files:**
- Modify: `apps/server/src/http/app.ts`
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/src/http/app.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block at the end of `apps/server/src/http/app.test.ts` (it reuses the file's existing `ctx()` helper; it builds the app directly so it can pass `corsOrigins`):

```ts
describe("createApp — CORS for the native client", () => {
  function corsApp() {
    const settings = SettingsStore.open(":memory:");
    const mgr = new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"), undefined, settings);
    return createApp(mgr, { auth: ctx(), settings, corsOrigins: ["http://localhost"] });
  }

  it("allows the configured native origin on a preflight", async () => {
    const res = await corsApp().request("/api/sessions", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost", "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost");
  });

  it("does not allow a foreign origin", async () => {
    const res = await corsApp().request("/api/sessions", {
      method: "OPTIONS",
      headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("http://evil.example");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/http/app.test.ts -t "CORS"`
Expected: TypeScript/test failure — `corsOrigins` is not a valid `AppOptions` field, and no `Access-Control-Allow-Origin` header is emitted.

- [ ] **Step 3: Implement the CORS middleware**

In `apps/server/src/http/app.ts`:

(a) Add the import at the top, next to the other `hono` imports:

```ts
import { cors } from "hono/cors";
```

(b) Add `corsOrigins` to the options interface:

```ts
export interface AppOptions {
  auth: AuthContext;
  settings: SettingsStore;
  webDist?: string;
  corsOrigins?: string[];
}
```

(c) Mount CORS on `/api/*` **immediately after** the `app.use("*", ...)` client-IP middleware and **before** `registerAuthRoutes(...)` (preflight must be handled before auth/CSRF):

```ts
  if (opts.corsOrigins && opts.corsOrigins.length > 0) {
    app.use(
      "/api/*",
      cors({
        origin: opts.corsOrigins,
        allowHeaders: ["Content-Type", "Authorization", "X-Tormod", "X-Tormod-Client"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      }),
    );
  }
```

- [ ] **Step 4: Wire the env var in `server.ts`**

In `apps/server/src/server.ts`, add this just before the `createApp(...)` call:

```ts
const corsOrigins = (process.env.TORMOD_CORS_ORIGINS ?? "http://localhost")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
```

Then change the `createApp` call to pass it:

```ts
const app = createApp(manager, { auth, settings, webDist: process.env.TORMOD_WEB_DIST, corsOrigins });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/http/app.test.ts`
Expected: all `createApp` tests PASS, including the two CORS tests.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: every test PASSES and `tsc` reports no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/http/app.ts apps/server/src/http/app.test.ts apps/server/src/server.ts
git commit -m "feat(http): enable CORS for the native app origin"
```

---

### Task 4: Document token auth and the CORS env var

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the API auth note**

In `README.md`, in the "HTTP API (current)" section, change the sentence:

> All routes live under `/api`. Everything except `/api/auth/{status,login,register}` requires a valid session cookie; mutations require the `X-Tormod: 1` header (CSRF defense).

to:

> All routes live under `/api`. Everything except `/api/auth/{status,login,register}` requires a valid session — carried as the `tormod_session` httpOnly cookie (web, same-origin) or an `Authorization: Bearer <session id>` header (native client). Mutations require the `X-Tormod: 1` header (CSRF defense). Native clients send `X-Tormod-Client: native` on `login`/`register` to receive the session id in the response body.

- [ ] **Step 2: Add the env var**

In `README.md`, in the "Environment variables" table, add this row after `TORMOD_COOKIE_SECURE`:

```markdown
| `TORMOD_CORS_ORIGINS` | `http://localhost` | comma-separated origins allowed by CORS (the Capacitor app's WebView origin) |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document token auth and TORMOD_CORS_ORIGINS"
```

---

## Verification (end of plan)

- [ ] From `apps/server`: `npx vitest run` — all green.
- [ ] From `apps/server`: `npx tsc --noEmit` — no errors.
- [ ] Manual smoke (real server): start with `TORMOD_BRAIN=fake TORMOD_COOKIE_SECURE=false node dist/server.js` after `npx tsc`, then:
  - `curl -s -X POST localhost:8790/api/auth/register -H 'Content-Type: application/json' -H 'X-Tormod: 1' -H 'X-Tormod-Client: native' -d '{"username":"t","email":"t@x.dev","password":"hunter2hunter2"}'` returns `{"ok":true,"token":"..."}`.
  - `curl -s localhost:8790/api/sessions -H "Authorization: Bearer <token>"` returns the session list (200), proving header auth end to end.

## Out of scope (later plans)

- Frontend platform seam (`apiBase`/auth mode) + server-address screen — **Plan 2**.
- Capacitor `android/` project + SSE WebView spike + APK build — **Plan 3**.
- Push notifications — phase 2 (0.6.0), its own spec + plan.

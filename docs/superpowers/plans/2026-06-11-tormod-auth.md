# Tormod Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static bearer token with single-user auth — first-run registration, password login, stateful httpOnly-cookie sessions, and origin-adaptive TOTP 2FA (skipped on LAN/VPN, required externally).

**Architecture:** A new `src/auth/` module owns users, sessions, password/TOTP/origin/throttle helpers (all on the existing SQLite file). HTTP routes under `/api/auth/*` plus a session-cookie middleware replace the static-token middleware. The frontend drops all token handling, authenticates purely via cookie (`credentials:'include'`), and swaps `TokenGate` for an `AuthGate` (register/login) plus a 2FA section in settings.

**Tech Stack:** Node 22, Hono, better-sqlite3, `@node-rs/argon2` (Argon2id), `otplib` (TOTP), `qrcode` (QR), React 19 + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-tormod-auth-design.md`

**Conventions to follow (from the codebase):**
- SQLite stores: `private constructor(db)`, `static open(path)`, `db.pragma("journal_mode = WAL")`, prepared statements, `:memory:` in tests.
- No code comments except where an invariant is non-obvious (the repo keeps comments sparse; match it).
- Tests: vitest `describe/it/expect`; Hono routes tested via `app.request(path, init)`.
- better-sqlite3 is synchronous; Argon2id is async → keep password verification in the route layer, stores stay sync.
- Commit messages: Conventional Commits, English, **never** mention AI/Claude.

---

## File Structure

**Backend — create:**
- `apps/server/src/auth/password.ts` — Argon2id hash/verify wrapper.
- `apps/server/src/auth/totp.ts` — TOTP secret/uri/verify + QR data-url.
- `apps/server/src/auth/origin.ts` — resolve client IP + trusted-CIDR check.
- `apps/server/src/auth/throttle.ts` — in-memory IP + username rate limiting.
- `apps/server/src/auth/users.ts` — `UserStore` (single-user table).
- `apps/server/src/auth/authSessions.ts` — `AuthSessionStore` (opaque session ids, hashed).
- `apps/server/src/auth/context.ts` — `AuthContext` interface + `authConfigFromEnv()`.
- `apps/server/src/http/auth.ts` — `registerAuthRoutes(app, ctx)` + `sessionMiddleware(ctx)`.
- Test files alongside each: `*.test.ts`.

**Backend — modify:**
- `apps/server/src/http/app.ts` — drop static token middleware; mount auth routes + session middleware.
- `apps/server/src/http/app.test.ts` — switch from bearer header to cookie auth.
- `apps/server/src/server.ts` — drop `TORMOD_TOKEN` requirement; build `AuthContext`, pass to `createApp`.
- `apps/server/package.json` — new deps.

**Frontend — create:**
- `apps/web/src/lib/auth.ts` — auth API client (cookie-based).
- `apps/web/src/components/auth/AuthGate.tsx` — register/login gate.
- `apps/web/src/components/settings/TwoFactorSection.tsx` — enroll/disable TOTP.

**Frontend — modify:**
- `apps/web/src/lib/api.ts` — remove token/Authorization; keep `X-Tormod` on mutations.
- `apps/web/src/app/App.tsx` — replace `TokenGate` with `AuthGate`.
- `apps/web/src/components/settings/SettingsDrawer.tsx` — mount `TwoFactorSection`.
- `apps/web/src/lib/serverTypes.ts` — add auth DTO types.

---

## Phase 1 — Backend foundation (stores + helpers)

### Task 1: Install dependencies

**Files:**
- Modify: `apps/server/package.json`

- [ ] **Step 1: Install**

Run:
```bash
cd apps/server && npm install @node-rs/argon2 otplib qrcode && npm install -D @types/qrcode
```
Expected: deps added, no build errors (`@node-rs/argon2` ships prebuilt binaries — no compiler).

- [ ] **Step 2: Verify Argon2id loads**

Run:
```bash
cd apps/server && node -e "const a=require('@node-rs/argon2'); a.hash('x').then(h=>console.log(h.startsWith('$argon2id$')))"
```
Expected: prints `true`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/package.json apps/server/package-lock.json
git commit -m "build(server): add argon2, otplib, qrcode for auth"
```

---

### Task 2: Password hashing (Argon2id)

**Files:**
- Create: `apps/server/src/auth/password.ts`
- Test: `apps/server/src/auth/password.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes to an argon2id string and verifies the correct password", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword(h, "battery staple")).toBe(false);
  });

  it("returns false on a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/auth/password.test.ts`
Expected: FAIL — `./password.js` not found.

- [ ] **Step 3: Implement**

```ts
import { hash, verify, Algorithm } from "@node-rs/argon2";

const OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/auth/password.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/password.ts apps/server/src/auth/password.test.ts
git commit -m "feat(auth): argon2id password hashing helper"
```

---

### Task 3: TOTP helper

**Files:**
- Create: `apps/server/src/auth/totp.ts`
- Test: `apps/server/src/auth/totp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { authenticator } from "otplib";
import { generateSecret, otpauthUri, verifyTotp, qrDataUrl } from "./totp.js";

describe("totp", () => {
  it("verifies a freshly generated code and rejects a wrong one", () => {
    const secret = generateSecret();
    const code = generateSync({ secret });
    expect(verifyTotp(code, secret)).toBe(true);
    expect(verifyTotp("000000", secret)).toBe(false);
  });

  it("builds an otpauth uri carrying issuer and account", () => {
    const uri = otpauthUri("odin", "JBSWY3DPEHPK3PXP");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("Tormod");
    expect(uri).toContain("odin");
  });

  it("renders the uri to a png data url", async () => {
    const url = await qrDataUrl("otpauth://totp/Tormod:odin?secret=JBSWY3DPEHPK3PXP&issuer=Tormod");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/auth/totp.test.ts`
Expected: FAIL — `./totp.js` not found.

- [ ] **Step 3: Implement**

```ts
import { authenticator } from "otplib";
import QRCode from "qrcode";

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function otpauthUri(username: string, secret: string): string {
  return authenticator.keyuri(username, "Tormod", secret);
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

export function qrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/auth/totp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/totp.ts apps/server/src/auth/totp.test.ts
git commit -m "feat(auth): totp secret/uri/verify and qr helper"
```

---

### Task 4: Origin resolution + trusted CIDR check

**Files:**
- Create: `apps/server/src/auth/origin.ts`
- Test: `apps/server/src/auth/origin.test.ts`

**Notes:** Handles IPv4, IPv4-mapped IPv6 (`::ffff:192.168.0.10`), and exact IPv6 loopback `::1`. `X-Forwarded-For` is honored **only** when the socket peer equals the trusted proxy IP (the security invariant from the spec).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveClientIp, isLocal } from "./origin.js";

const CIDRS = ["192.168.0.0/24", "10.0.0.0/24", "127.0.0.1/32", "::1/128"];

describe("resolveClientIp", () => {
  it("uses the socket peer when there is no trusted proxy", () => {
    expect(resolveClientIp("203.0.113.5", "192.168.0.9", null)).toBe("203.0.113.5");
  });

  it("honors XFF only when the peer is the trusted proxy", () => {
    expect(resolveClientIp("10.0.0.1", "203.0.113.5", "10.0.0.1")).toBe("203.0.113.5");
    expect(resolveClientIp("203.0.113.9", "192.168.0.9", "10.0.0.1")).toBe("203.0.113.9");
  });

  it("takes the left-most XFF entry", () => {
    expect(resolveClientIp("10.0.0.1", "203.0.113.5, 10.0.0.1", "10.0.0.1")).toBe("203.0.113.5");
  });
});

describe("isLocal", () => {
  it("matches LAN, VPN and loopback", () => {
    expect(isLocal("192.168.0.10", CIDRS)).toBe(true);
    expect(isLocal("10.0.0.11", CIDRS)).toBe(true);
    expect(isLocal("127.0.0.1", CIDRS)).toBe(true);
    expect(isLocal("::1", CIDRS)).toBe(true);
    expect(isLocal("::ffff:192.168.0.10", CIDRS)).toBe(true);
  });

  it("rejects public addresses", () => {
    expect(isLocal("203.0.113.5", CIDRS)).toBe(false);
    expect(isLocal("8.8.8.8", CIDRS)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/auth/origin.test.ts`
Expected: FAIL — `./origin.js` not found.

- [ ] **Step 3: Implement**

```ts
export function resolveClientIp(
  socketIp: string,
  xff: string | undefined,
  trustedProxy: string | null,
): string {
  if (trustedProxy && socketIp === trustedProxy && xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return socketIp;
}

function normalize(ip: string): string {
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function matchCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (range.includes(":") || ip.includes(":")) return ip === range;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function isLocal(ip: string, cidrs: string[]): boolean {
  const norm = normalize(ip);
  return cidrs.some((c) => matchCidr(norm, c) || matchCidr(ip, c));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/auth/origin.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/origin.ts apps/server/src/auth/origin.test.ts
git commit -m "feat(auth): client ip resolution and trusted-cidr check"
```

---

### Task 5: Rate limiting (IP + username)

**Files:**
- Create: `apps/server/src/auth/throttle.ts`
- Test: `apps/server/src/auth/throttle.test.ts`

**Notes:** In-memory (single daemon). IP: 5 attempts / 60s → block 15 min. Username: 5 consecutive failures → lock 10 min; a success clears the username counter. Time is injected (`now` param) so tests are deterministic.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { Throttle } from "./throttle.js";

describe("Throttle", () => {
  it("blocks an IP after 5 attempts within the window", () => {
    const t = new Throttle();
    for (let i = 0; i < 5; i++) expect(t.checkIp("1.2.3.4", i * 1000)).toBe(true);
    expect(t.checkIp("1.2.3.4", 5000)).toBe(false);
  });

  it("unblocks the IP after the 15 minute block elapses", () => {
    const t = new Throttle();
    for (let i = 0; i < 6; i++) t.checkIp("1.2.3.4", 0);
    expect(t.checkIp("1.2.3.4", 0)).toBe(false);
    expect(t.checkIp("1.2.3.4", 15 * 60_000 + 1)).toBe(true);
  });

  it("locks a username after 5 failures and a success clears it", () => {
    const t = new Throttle();
    for (let i = 0; i < 5; i++) t.recordFailure("odin", 0);
    expect(t.isLocked("odin", 0)).toBe(true);
    expect(t.isLocked("odin", 10 * 60_000 + 1)).toBe(false);
    t.recordFailure("odin", 0);
    t.recordSuccess("odin");
    expect(t.isLocked("odin", 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/auth/throttle.test.ts`
Expected: FAIL — `./throttle.js` not found.

- [ ] **Step 3: Implement**

```ts
const IP_WINDOW_MS = 60_000;
const IP_MAX = 5;
const IP_BLOCK_MS = 15 * 60_000;
const USER_MAX = 5;
const USER_LOCK_MS = 10 * 60_000;

interface IpState {
  hits: number[];
  blockedUntil: number;
}
interface UserState {
  failures: number;
  lockedUntil: number;
}

export class Throttle {
  private ips = new Map<string, IpState>();
  private users = new Map<string, UserState>();

  /** Returns true if the attempt is allowed; false if the IP is rate-limited. */
  checkIp(ip: string, now: number = Date.now()): boolean {
    const s = this.ips.get(ip) ?? { hits: [], blockedUntil: 0 };
    if (now < s.blockedUntil) {
      this.ips.set(ip, s);
      return false;
    }
    s.hits = s.hits.filter((t) => now - t < IP_WINDOW_MS);
    if (s.hits.length >= IP_MAX) {
      s.blockedUntil = now + IP_BLOCK_MS;
      this.ips.set(ip, s);
      return false;
    }
    s.hits.push(now);
    this.ips.set(ip, s);
    return true;
  }

  isLocked(username: string, now: number = Date.now()): boolean {
    const s = this.users.get(username);
    return !!s && now < s.lockedUntil;
  }

  recordFailure(username: string, now: number = Date.now()): void {
    const s = this.users.get(username) ?? { failures: 0, lockedUntil: 0 };
    s.failures += 1;
    if (s.failures >= USER_MAX) s.lockedUntil = now + USER_LOCK_MS;
    this.users.set(username, s);
  }

  recordSuccess(username: string): void {
    this.users.delete(username);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/auth/throttle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/throttle.ts apps/server/src/auth/throttle.test.ts
git commit -m "feat(auth): in-memory ip and username rate limiting"
```

---

### Task 6: UserStore

**Files:**
- Create: `apps/server/src/auth/users.ts`
- Test: `apps/server/src/auth/users.test.ts`

**Notes:** Single-user table (`CHECK (id = 1)`). Store stays synchronous; it holds the **already-hashed** password (Argon2id hashing happens in the route). `getCredentials()` exposes the hash + TOTP state for the route to verify.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { UserStore } from "./users.js";

describe("UserStore", () => {
  it("reports no user, then a user after create", () => {
    const s = UserStore.open(":memory:");
    expect(s.hasUser()).toBe(false);
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    expect(s.hasUser()).toBe(true);
  });

  it("returns credentials for the single user", () => {
    const s = UserStore.open(":memory:");
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    const c = s.getCredentials();
    expect(c).toEqual({ username: "odin", passwordHash: "$argon2id$h", totpSecret: null, totpEnabled: false });
  });

  it("returns the public profile", () => {
    const s = UserStore.open(":memory:");
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    expect(s.profile()).toEqual({ username: "odin", email: "o@x.dev", totpEnabled: false });
  });

  it("sets a pending totp secret then enables and disables it", () => {
    const s = UserStore.open(":memory:");
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    s.setTotpSecret("SECRET");
    expect(s.getCredentials().totpSecret).toBe("SECRET");
    expect(s.getCredentials().totpEnabled).toBe(false);
    s.enableTotp();
    expect(s.getCredentials().totpEnabled).toBe(true);
    s.disableTotp();
    expect(s.getCredentials()).toMatchObject({ totpSecret: null, totpEnabled: false });
  });

  it("rejects a second user", () => {
    const s = UserStore.open(":memory:");
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    expect(() => s.create({ username: "loki", email: "l@x.dev", passwordHash: "$argon2id$h2" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/auth/users.test.ts`
Expected: FAIL — `./users.js` not found.

- [ ] **Step 3: Implement**

```ts
import Database from "better-sqlite3";

export interface NewUser {
  username: string;
  email: string;
  passwordHash: string;
}

export interface Credentials {
  username: string;
  passwordHash: string;
  totpSecret: string | null;
  totpEnabled: boolean;
}

export interface Profile {
  username: string;
  email: string;
  totpEnabled: boolean;
}

interface Row {
  username: string;
  email: string;
  pw_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
}

export class UserStore {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): UserStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        pw_hash TEXT NOT NULL,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
    return new UserStore(db);
  }

  hasUser(): boolean {
    const row = this.db.prepare(`SELECT 1 FROM users WHERE id = 1`).get();
    return !!row;
  }

  create(user: NewUser): void {
    this.db
      .prepare(
        `INSERT INTO users (id, username, email, pw_hash, totp_enabled, created_at)
         VALUES (1, @username, @email, @passwordHash, 0, @createdAt)`,
      )
      .run({ ...user, createdAt: Date.now() });
  }

  private row(): Row | undefined {
    return this.db
      .prepare(`SELECT username, email, pw_hash, totp_secret, totp_enabled FROM users WHERE id = 1`)
      .get() as Row | undefined;
  }

  getCredentials(): Credentials | null {
    const r = this.row();
    if (!r) return null;
    return {
      username: r.username,
      passwordHash: r.pw_hash,
      totpSecret: r.totp_secret,
      totpEnabled: r.totp_enabled === 1,
    };
  }

  profile(): Profile | null {
    const r = this.row();
    if (!r) return null;
    return { username: r.username, email: r.email, totpEnabled: r.totp_enabled === 1 };
  }

  setTotpSecret(secret: string): void {
    this.db.prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = 1`).run(secret);
  }

  enableTotp(): void {
    this.db.prepare(`UPDATE users SET totp_enabled = 1 WHERE id = 1`).run();
  }

  disableTotp(): void {
    this.db.prepare(`UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = 1`).run();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/auth/users.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/users.ts apps/server/src/auth/users.test.ts
git commit -m "feat(auth): single-user store with totp state"
```

---

### Task 7: AuthSessionStore

**Files:**
- Create: `apps/server/src/auth/authSessions.ts`
- Test: `apps/server/src/auth/authSessions.test.ts`

**Notes:** `issue()` returns the **raw** id once; the DB stores only `sha256(id)`. `validate()` is time-injected for deterministic expiry tests. Named `auth_sessions` to avoid confusion with the chat `SessionStore`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { AuthSessionStore } from "./authSessions.js";

describe("AuthSessionStore", () => {
  it("issues a session that validates, then expires", () => {
    const s = AuthSessionStore.open(":memory:", 1); // 1-day ttl
    const { id, expiresAt } = s.issue(0);
    expect(id.length).toBeGreaterThan(20);
    expect(s.validate(id, 0)).toBe(true);
    expect(s.validate(id, expiresAt + 1)).toBe(false);
  });

  it("never stores the raw id", () => {
    const s = AuthSessionStore.open(":memory:", 1);
    const { id } = s.issue(0);
    expect(s.debugStoredKeys()).not.toContain(id);
  });

  it("revokes a session", () => {
    const s = AuthSessionStore.open(":memory:", 1);
    const { id } = s.issue(0);
    s.revoke(id);
    expect(s.validate(id, 0)).toBe(false);
  });

  it("revokeAll invalidates every session", () => {
    const s = AuthSessionStore.open(":memory:", 1);
    const a = s.issue(0);
    const b = s.issue(0);
    s.revokeAll();
    expect(s.validate(a.id, 0)).toBe(false);
    expect(s.validate(b.id, 0)).toBe(false);
  });

  it("rejects an unknown id", () => {
    const s = AuthSessionStore.open(":memory:", 1);
    expect(s.validate("nope", 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/auth/authSessions.test.ts`
Expected: FAIL — `./authSessions.js` not found.

- [ ] **Step 3: Implement**

```ts
import Database from "better-sqlite3";
import { randomBytes, createHash } from "node:crypto";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class AuthSessionStore {
  private constructor(
    private readonly db: Database.Database,
    private readonly ttlMs: number,
  ) {}

  static open(path: string, ttlDays: number): AuthSessionStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
    `);
    return new AuthSessionStore(db, ttlDays * 24 * 60 * 60 * 1000);
  }

  issue(now: number = Date.now()): { id: string; expiresAt: number } {
    const id = randomBytes(32).toString("base64url");
    const expiresAt = now + this.ttlMs;
    this.db
      .prepare(`INSERT INTO auth_sessions (id_hash, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?)`)
      .run(sha256(id), now, expiresAt, now);
    return { id, expiresAt };
  }

  validate(id: string, now: number = Date.now()): boolean {
    const row = this.db
      .prepare(`SELECT expires_at FROM auth_sessions WHERE id_hash = ?`)
      .get(sha256(id)) as { expires_at: number } | undefined;
    if (!row || now >= row.expires_at) return false;
    this.db.prepare(`UPDATE auth_sessions SET last_seen = ? WHERE id_hash = ?`).run(now, sha256(id));
    return true;
  }

  revoke(id: string): void {
    this.db.prepare(`DELETE FROM auth_sessions WHERE id_hash = ?`).run(sha256(id));
  }

  revokeAll(): void {
    this.db.prepare(`DELETE FROM auth_sessions`).run();
  }

  debugStoredKeys(): string[] {
    return (this.db.prepare(`SELECT id_hash FROM auth_sessions`).all() as { id_hash: string }[]).map(
      (r) => r.id_hash,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/auth/authSessions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/authSessions.ts apps/server/src/auth/authSessions.test.ts
git commit -m "feat(auth): stateful session store with hashed ids"
```

---

## Phase 2 — HTTP wiring

### Task 8: AuthContext + env config

**Files:**
- Create: `apps/server/src/auth/context.ts`
- Test: `apps/server/src/auth/context.test.ts`

**Notes:** Bundles the stores, helpers, and resolved config so routes/middleware take one object. `authConfigFromEnv()` parses env with the spec defaults.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { authConfigFromEnv } from "./context.js";

describe("authConfigFromEnv", () => {
  it("applies defaults when env is empty", () => {
    const c = authConfigFromEnv({});
    expect(c.trustedProxy).toBeNull();
    expect(c.trustedCidrs).toContain("192.168.0.0/24");
    expect(c.trustedCidrs).toContain("10.0.0.0/24");
    expect(c.cookieSecure).toBe(true);
    expect(c.sessionTtlDays).toBe(30);
  });

  it("reads overrides", () => {
    const c = authConfigFromEnv({
      TORMOD_TRUSTED_PROXY: "10.0.0.1",
      TORMOD_TRUSTED_CIDRS: "172.16.0.0/12",
      TORMOD_COOKIE_SECURE: "false",
      TORMOD_SESSION_TTL_DAYS: "7",
    });
    expect(c.trustedProxy).toBe("10.0.0.1");
    expect(c.trustedCidrs).toEqual(["172.16.0.0/12"]);
    expect(c.cookieSecure).toBe(false);
    expect(c.sessionTtlDays).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/auth/context.test.ts`
Expected: FAIL — `./context.js` not found.

- [ ] **Step 3: Implement**

```ts
import type { UserStore } from "./users.js";
import type { AuthSessionStore } from "./authSessions.js";
import type { Throttle } from "./throttle.js";

export interface AuthConfig {
  trustedProxy: string | null;
  trustedCidrs: string[];
  cookieSecure: boolean;
  sessionTtlDays: number;
}

export interface AuthContext {
  users: UserStore;
  sessions: AuthSessionStore;
  throttle: Throttle;
  config: AuthConfig;
}

const DEFAULT_CIDRS = ["192.168.0.0/24", "10.0.0.0/24", "127.0.0.1/32", "::1/128"];

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
  const cidrs = env.TORMOD_TRUSTED_CIDRS
    ? env.TORMOD_TRUSTED_CIDRS.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_CIDRS;
  const ttl = Number(env.TORMOD_SESSION_TTL_DAYS);
  return {
    trustedProxy: env.TORMOD_TRUSTED_PROXY?.trim() || null,
    trustedCidrs: cidrs,
    cookieSecure: env.TORMOD_COOKIE_SECURE !== "false",
    sessionTtlDays: Number.isFinite(ttl) && ttl > 0 ? ttl : 30,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/auth/context.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/context.ts apps/server/src/auth/context.test.ts
git commit -m "feat(auth): auth context bundle and env config"
```

---

### Task 9: Auth routes + session middleware

**Files:**
- Create: `apps/server/src/http/auth.ts`
- Test: `apps/server/src/http/auth.test.ts`

**Notes:** This is the largest task — implement and test the full gate. Helpers `registerAuthRoutes(app, ctx)` and `sessionMiddleware(ctx)` are consumed by `app.ts` in Task 10. The test builds a tiny Hono app wiring just these, injecting client IP via a header shim so origin is testable without real sockets.

The route reads the client IP from `c.get("clientIp")` (a value the real app sets from `getConnInfo`; the test sets it via a pre-middleware). Cookie name: `tormod_session`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { registerAuthRoutes, sessionMiddleware, CLIENT_IP } from "./auth.js";
import { UserStore } from "../auth/users.js";
import { AuthSessionStore } from "../auth/authSessions.js";
import { Throttle } from "../auth/throttle.js";
import type { AuthContext } from "../auth/context.js";
import { generateSync } from "otplib";

function build(ip = "192.168.0.10"): Hono {
  const ctx: AuthContext = {
    users: UserStore.open(":memory:"),
    sessions: AuthSessionStore.open(":memory:", 30),
    throttle: new Throttle(),
    config: { trustedProxy: null, trustedCidrs: ["192.168.0.0/24", "10.0.0.0/24"], cookieSecure: false, sessionTtlDays: 30 },
  };
  const app = new Hono();
  app.use("*", async (c, next) => { c.set(CLIENT_IP, c.req.header("x-test-ip") ?? ip); await next(); });
  registerAuthRoutes(app, ctx);
  app.use("/api/protected", sessionMiddleware(ctx));
  app.get("/api/protected", (c) => c.json({ ok: true }));
  return app;
}

const J = { "Content-Type": "application/json", "X-Tormod": "1" };

function cookieFrom(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  return set.split(";")[0];
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
    expect((await res.json()).error).toContain("2fa");
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

  it("rejects a mutation missing the CSRF header", async () => {
    const app = build();
    const res = await app.request("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "odin", email: "o@x.dev", password: "hunter2hunter2" }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/http/auth.test.ts`
Expected: FAIL — `./auth.js` not found.

- [ ] **Step 3: Implement**

```ts
import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AuthContext } from "../auth/context.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { generateSecret, otpauthUri, verifyTotp, qrDataUrl } from "../auth/totp.js";
import { isLocal } from "../auth/origin.js";

export const CLIENT_IP = "clientIp";
const COOKIE = "tormod_session";

function clientIp(c: { get: (k: string) => unknown }): string {
  return (c.get(CLIENT_IP) as string) ?? "";
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
    const id = getCookie(c, COOKIE);
    if (!id || !ctx.sessions.validate(id)) return c.json({ error: "unauthorized" }, 401);
    await next();
  };
}

export function registerAuthRoutes(app: Hono, ctx: AuthContext): void {
  app.use("/api/auth/*", async (c, next) => {
    if (!requireCsrf(c)) return c.json({ error: "forbidden" }, 403);
    await next();
  });

  const issue = (c: any) => {
    const ttlSec = ctx.config.sessionTtlDays * 24 * 60 * 60;
    const { id } = ctx.sessions.issue();
    setCookie(c, COOKIE, id, sessionCookieOpts(ctx, ttlSec));
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
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (username.length < 3 || !email.includes("@") || password.length < 8) {
      return c.json({ error: "invalid input" }, 400);
    }
    ctx.users.create({ username, email, passwordHash: await hashPassword(password) });
    issue(c);
    return c.json({ ok: true }, 201);
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
    issue(c);
    return c.json({ ok: true });
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
    const secret = generateSecret();
    ctx.users.setTotpSecret(secret);
    const uri = otpauthUri(ctx.users.profile()!.username, secret);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/http/auth.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/http/auth.ts apps/server/src/http/auth.test.ts
git commit -m "feat(auth): register/login/logout/totp routes with adaptive 2fa gate"
```

---

### Task 10: Rewire `app.ts` (drop static token, mount auth)

**Files:**
- Modify: `apps/server/src/http/app.ts`
- Modify: `apps/server/src/http/app.test.ts`

**Notes:** `createApp` now takes `{ auth: AuthContext, settings }` and sets `clientIp` from `getConnInfo` (real socket) before routing. The whole `/api/*` surface (except the auth public routes) sits behind `sessionMiddleware`. Existing session/settings tests switch to cookie auth via a register+login helper.

- [ ] **Step 1: Update `app.ts`**

Replace the top of the file and the auth middleware. New `app.ts`:

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { SessionManager } from "../session/manager.js";
import type { SettingsStore } from "../settings/store.js";
import type { AuthContext } from "../auth/context.js";
import { registerAuthRoutes, sessionMiddleware, CLIENT_IP } from "./auth.js";
import { resolveClientIp } from "../auth/origin.js";

export interface AppOptions {
  auth: AuthContext;
  settings: SettingsStore;
}

export function createApp(manager: SessionManager, opts: AppOptions): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const info = getConnInfo(c);
    const socketIp = info.remote.address ?? "";
    const xff = c.req.header("x-forwarded-for");
    c.set(CLIENT_IP, resolveClientIp(socketIp, xff, opts.auth.config.trustedProxy));
    await next();
  });

  registerAuthRoutes(app, opts.auth);

  // Everything else under /api requires a valid session cookie.
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    return sessionMiddleware(opts.auth)(c, next);
  });

  app.get("/api/sessions", (c) => c.json(manager.list()));
  // ... (rest of the existing routes unchanged below) ...
```

Keep every existing route from `app.get("/api/sessions", ...)` downward **exactly as-is**. Only the imports, `AppOptions`, and the two leading middlewares change (the old static-token `app.use("/api/*", ...)` block is deleted).

- [ ] **Step 2: Update `app.test.ts`**

Replace the harness so tests authenticate via cookie. New top of `app.test.ts`:

```ts
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
  const cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];
  return { app: a, headers: { ...J, Cookie: cookie } };
}
```

Then update each existing test:
- The "auth" describe block becomes: unauthenticated `/api/sessions` → 401; authenticated → 200.
- Every other test replaces `auth`/`{ ...auth, ... }` with the `headers` from `authedApp()`.

Full replacement for the two auth tests:

```ts
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
```

For the sessions/settings describe blocks, change each `app()` call to `await authedApp()` and use its `headers`. Example for the "creates then lists" test:

```ts
it("creates then lists a session", async () => {
  const { app, headers } = await authedApp();
  const created = await app.request("/api/sessions", {
    method: "POST", headers, body: JSON.stringify({ title: "hi" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const listed = await app.request("/api/sessions", { headers });
  const sessions = (await listed.json()) as Array<{ id: string }>;
  expect(sessions.map((s) => s.id)).toContain(id);
});
```

Apply the same `authedApp()` + `headers` substitution to every remaining test in the file (messages 202, settings GET/PUT). Delete the old `function app()` and `const auth` helpers.

- [ ] **Step 3: Run the http tests**

Run: `cd apps/server && npx vitest run src/http/`
Expected: PASS — `app.test.ts` and `auth.test.ts` green.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/http/app.ts apps/server/src/http/app.test.ts
git commit -m "feat(auth): session-cookie middleware replaces static token"
```

---

### Task 11: Wire `server.ts`

**Files:**
- Modify: `apps/server/src/server.ts`

**Notes:** Drop the `TORMOD_TOKEN` requirement; build the `AuthContext` from the stores + env. Keep the existing brain/manager wiring.

- [ ] **Step 1: Edit `server.ts`**

Remove the `token` block (lines reading `process.env.TORMOD_TOKEN` and the `process.exit(1)`), and replace the `createApp` wiring:

```ts
import { UserStore } from "./auth/users.js";
import { AuthSessionStore } from "./auth/authSessions.js";
import { Throttle } from "./auth/throttle.js";
import { authConfigFromEnv } from "./auth/context.js";
```

Then, where the app is built:

```ts
const config = authConfigFromEnv(process.env);
const auth = {
  users: UserStore.open(auditPath),
  sessions: AuthSessionStore.open(auditPath, config.sessionTtlDays),
  throttle: new Throttle(),
  config,
};
const settings = SettingsStore.open(settingsPath);
const manager = new SessionManager(brain, Audit.open(auditPath), SessionStore.open(auditPath), settings);
const app = createApp(manager, { auth, settings });
```

Delete:
```ts
const token = process.env.TORMOD_TOKEN;
if (!token) {
  console.error("TORMOD_TOKEN is required");
  process.exit(1);
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd apps/server && npx tsc`
Expected: exit 0, no errors.

- [ ] **Step 3: Full server test suite**

Run: `cd apps/server && npx vitest run`
Expected: PASS — all prior tests + the new auth tests green.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/server.ts
git commit -m "feat(auth): build auth context in server entrypoint, drop static token"
```

---

## Phase 3 — Frontend

### Task 12: Auth client + api.ts cleanup

**Files:**
- Create: `apps/web/src/lib/auth.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/serverTypes.ts`

**Notes:** All requests become cookie-based (`credentials:'include'`) with `X-Tormod: 1` on mutations. Drop `getToken/setToken/TOKEN_KEY/authHeaders`. The `UnauthorizedError` plumbing stays (now triggered by 401 without a valid cookie).

- [ ] **Step 1: Add auth DTO types to `serverTypes.ts`**

Append:

```ts
export interface AuthStatus {
  registered: boolean
  external: boolean
  totpEnabled: boolean
}

export interface AuthProfile {
  username: string
  email: string
  totpEnabled: boolean
}

export interface TotpEnrollment {
  secret: string
  otpauthUri: string
  qrDataUrl: string
}
```

- [ ] **Step 2: Rewrite `api.ts` header handling**

Replace the token section (lines 3-15) with:

```ts
const MUTATION_HEADERS: HeadersInit = { 'Content-Type': 'application/json', 'X-Tormod': '1' }

function jsonHeaders(): HeadersInit {
  return MUTATION_HEADERS
}
```

Then across `api.ts`: replace every `headers: authHeaders()` with `headers: jsonHeaders()`, add `credentials: 'include'` to **every** `fetch` call (REST and the `readSSE` fetch), and delete `getToken`, `setToken`, `TOKEN_KEY`. GET calls can pass `{ credentials: 'include' }` with no headers (cookie carries auth); keep `jsonHeaders()` only where a JSON body is sent. Example for `listSessions` and `sendMessage`:

```ts
export async function listSessions(): Promise<SessionMeta[]> {
  const res = await expectOk(await fetch('/api/sessions', { credentials: 'include' }))
  return res.json() as Promise<SessionMeta[]>
}

export async function sendMessage(id: string, text: string): Promise<void> {
  await expectOk(
    await fetch(`/api/sessions/${id}/messages`, {
      method: 'POST', headers: jsonHeaders(), credentials: 'include', body: JSON.stringify({ text }),
    }),
  )
}
```

And `readSSE`:

```ts
const res = await fetch(path, { credentials: 'include', signal })
```

- [ ] **Step 3: Create `lib/auth.ts`**

```ts
import type { AuthStatus, AuthProfile, TotpEnrollment } from './serverTypes'

const MUT: HeadersInit = { 'Content-Type': 'application/json', 'X-Tormod': '1' }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new AuthError(body.error ?? `failed: ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function getStatus(): Promise<AuthStatus> {
  return json(await fetch('/api/auth/status', { credentials: 'include' }))
}

export async function register(body: { username: string; email: string; password: string }): Promise<void> {
  await json(await fetch('/api/auth/register', { method: 'POST', headers: MUT, credentials: 'include', body: JSON.stringify(body) }))
}

export async function login(body: { username: string; password: string; totp?: string }): Promise<void> {
  await json(await fetch('/api/auth/login', { method: 'POST', headers: MUT, credentials: 'include', body: JSON.stringify(body) }))
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: MUT, credentials: 'include' })
}

export async function getProfile(): Promise<AuthProfile> {
  return json(await fetch('/api/auth/me', { credentials: 'include' }))
}

export async function enrollTotp(): Promise<TotpEnrollment> {
  return json(await fetch('/api/auth/totp/enroll', { method: 'POST', headers: MUT, credentials: 'include' }))
}

export async function confirmTotp(token: string): Promise<void> {
  await json(await fetch('/api/auth/totp/confirm', { method: 'POST', headers: MUT, credentials: 'include', body: JSON.stringify({ token }) }))
}

export async function disableTotp(password: string): Promise<void> {
  await json(await fetch('/api/auth/totp/disable', { method: 'POST', headers: MUT, credentials: 'include', body: JSON.stringify({ password }) }))
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc -b`
Expected: no **new** errors in `api.ts`/`auth.ts` (the 3 pre-existing StatusLine/main.tsx errors noted in the project memory may remain — do not let new ones appear).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/auth.ts apps/web/src/lib/api.ts apps/web/src/lib/serverTypes.ts
git commit -m "feat(web): cookie-based auth client, drop bearer token plumbing"
```

---

### Task 13: AuthGate (register / login) replaces TokenGate

**Files:**
- Create: `apps/web/src/components/auth/AuthGate.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Notes:** On mount, `getStatus()`. `!registered` → register form; `registered` → login form. Login shows the TOTP field only when `external && totpEnabled`; when `external && !totpEnabled`, blocks with the enroll-from-LAN message. On success, calls `onAuthed()` (App re-fetches sessions). Uses the existing `Button`/input styles from `TokenGate`.

- [ ] **Step 1: Create `AuthGate.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { getStatus, register, login, AuthError } from '@/lib/auth'
import type { AuthStatus } from '@/lib/serverTypes'

const input =
  'rounded-xl border border-border bg-surface px-4 py-3 text-sm text-frost outline-none focus:border-arc/50'

export function AuthGate({ onAuthed }: { onAuthed: () => void }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)

  useEffect(() => {
    getStatus().then(setStatus).catch(() => setStatus({ registered: false, external: false, totpEnabled: false }))
  }, [])

  if (!status) {
    return <div className="grid h-full place-items-center bg-ink text-faint">Carregando…</div>
  }
  if (!status.registered) return <RegisterForm onDone={onAuthed} />
  return <LoginForm status={status} onDone={onAuthed} />
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await register({ username, email, password })
      onDone()
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'falha no cadastro')
    } finally {
      setBusy(false)
    }
  }

  const valid = username.trim().length >= 3 && email.includes('@') && password.length >= 8

  return (
    <div className="grid h-full place-items-center bg-ink text-frost">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3 px-6">
        <h1 className="text-lg font-bold">Tormod — primeiro acesso</h1>
        <p className="text-sm text-faint">Crie o usuário que vai operar o homelab.</p>
        <input className={input} placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <input className={input} type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" placeholder="senha (mín. 8)" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={!valid || busy}>{busy ? 'Criando…' : 'Criar conta'}</Button>
      </form>
    </div>
  )
}

function LoginForm({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const needsTotp = status.external && status.totpEnabled
  const blocked = status.external && !status.totpEnabled

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login({ username, password, ...(needsTotp ? { totp } : {}) })
      onDone()
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'falha no login')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center bg-ink text-frost">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3 px-6">
        <h1 className="text-lg font-bold">Tormod</h1>
        {blocked ? (
          <p className="text-sm text-amber-400">
            2FA não configurado. Conecte pela LAN/VPN para configurar o segundo fator antes de acessar externamente.
          </p>
        ) : (
          <>
            <input className={input} placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            <input className={input} type="password" placeholder="senha" value={password} onChange={(e) => setPassword(e.target.value)} />
            {needsTotp && (
              <input className={input} inputMode="numeric" placeholder="código 2FA (6 dígitos)" value={totp} onChange={(e) => setTotp(e.target.value)} />
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" disabled={busy || !username || !password}>{busy ? 'Entrando…' : 'Entrar'}</Button>
          </>
        )}
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Wire into `App.tsx`**

Replace the `unauthorized` branch and remove the `TokenGate` function + `setToken` import. The `useSessions` hook still exposes `unauthorized`/`refresh`. Change:

```tsx
// import { setToken } from '@/lib/api'   ← delete
import { AuthGate } from '@/components/auth/AuthGate'
```

```tsx
  if (unauthorized) {
    return <AuthGate onAuthed={() => void refresh()} />
  }
```

Delete the entire `function TokenGate(...) { ... }` block at the bottom of the file.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc -b`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/auth/AuthGate.tsx apps/web/src/app/App.tsx
git commit -m "feat(web): register/login gate with origin-adaptive 2fa field"
```

---

### Task 14: 2FA section in Settings

**Files:**
- Create: `apps/web/src/components/settings/TwoFactorSection.tsx`
- Modify: `apps/web/src/components/settings/SettingsDrawer.tsx`

**Notes:** Loads `getProfile()`; if `totpEnabled`, shows a disable form (password). Otherwise an "enroll" button → calls `enrollTotp()`, shows the QR (`qrDataUrl` as `<img>`) + a confirm field → `confirmTotp(token)`. 2FA management is local-only on the server; if a request 403s, surface the "only from LAN/VPN" hint.

- [ ] **Step 1: Create `TwoFactorSection.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { getProfile, enrollTotp, confirmTotp, disableTotp, AuthError } from '@/lib/auth'
import type { TotpEnrollment } from '@/lib/serverTypes'

const input = 'rounded-lg border border-border bg-surface px-3 py-2 text-sm text-frost outline-none focus:border-arc/50'

export function TwoFactorSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function load() {
    getProfile().then((p) => setEnabled(p.totpEnabled)).catch(() => setEnabled(null))
  }
  useEffect(load, [])

  async function startEnroll() {
    setError('')
    try {
      setEnrollment(await enrollTotp())
    } catch (err) {
      setError(err instanceof AuthError && err.status === 403 ? 'Configure o 2FA conectado pela LAN/VPN.' : 'falha ao iniciar 2FA')
    }
  }

  async function confirm() {
    setError('')
    try {
      await confirmTotp(token)
      setEnrollment(null)
      setToken('')
      load()
    } catch {
      setError('código inválido')
    }
  }

  async function disable() {
    setError('')
    try {
      await disableTotp(password)
      setPassword('')
      load()
    } catch {
      setError('senha inválida')
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-frost">Autenticação em dois fatores (2FA)</h3>
      {enabled === null && <p className="text-sm text-faint">—</p>}

      {enabled === true && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-faint">2FA ativo. Exigido em acessos externos.</p>
          <input className={input} type="password" placeholder="senha para desativar" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="ghost" onClick={disable} disabled={!password}>Desativar 2FA</Button>
        </div>
      )}

      {enabled === false && !enrollment && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-faint">Recomendado antes de expor o Tormod à internet.</p>
          <Button onClick={startEnroll}>Configurar 2FA</Button>
        </div>
      )}

      {enrollment && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-faint">Escaneie no app autenticador (Aegis, Bitwarden, Google Authenticator):</p>
          <img src={enrollment.qrDataUrl} alt="QR code 2FA" className="size-44 rounded-lg bg-white p-2" />
          <input className={input} inputMode="numeric" placeholder="código de 6 dígitos" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button onClick={confirm} disabled={token.length < 6}>Confirmar</Button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  )
}
```

- [ ] **Step 2: Mount it in `SettingsDrawer.tsx`**

Add the import and render the section (place near the bottom of the drawer's content, before the closing container):

```tsx
import { TwoFactorSection } from './TwoFactorSection'
```

```tsx
        <TwoFactorSection />
```

(Insert it inside the existing settings content stack, following the established spacing of the other sections.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc -b`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/TwoFactorSection.tsx apps/web/src/components/settings/SettingsDrawer.tsx
git commit -m "feat(web): 2fa enrollment and disable in settings"
```

---

## Phase 4 — Integration & verification

### Task 15: Live smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Rebuild + restart backend**

Run:
```bash
cd apps/server && npx tsc
# stop the old daemon if running, then:
TORMOD_BRAIN=claude TORMOD_CWD=/home/odin TORMOD_COOKIE_SECURE=false PORT=8790 node dist/server.js &
```
Expected: `Tormod server listening on http://127.0.0.1:8790` — and it starts **without** `TORMOD_TOKEN`.

- [ ] **Step 2: Status before registration**

Run: `curl -s 127.0.0.1:8790/api/auth/status`
Expected: `{"registered":false,"external":false,"totpEnabled":false}`

- [ ] **Step 3: Register and capture cookie**

Run:
```bash
curl -s -i -X POST 127.0.0.1:8790/api/auth/register \
  -H 'Content-Type: application/json' -H 'X-Tormod: 1' \
  -d '{"username":"odin","email":"odin@diaslabs.dev","password":"trocar-depois-123"}'
```
Expected: `201`, a `Set-Cookie: tormod_session=...; HttpOnly; SameSite=Strict; Path=/api`.

- [ ] **Step 4: Authenticated request with the cookie**

Run:
```bash
COOKIE=$(curl -s -i -X POST 127.0.0.1:8790/api/auth/login -H 'Content-Type: application/json' -H 'X-Tormod: 1' -d '{"username":"odin","password":"trocar-depois-123"}' | grep -i set-cookie | sed 's/.*\(tormod_session=[^;]*\).*/\1/')
curl -s 127.0.0.1:8790/api/sessions -H "Cookie: $COOKIE"
```
Expected: `200` with a JSON array (sessions list).

- [ ] **Step 5: Unauthenticated request blocked**

Run: `curl -s -o /dev/null -w "%{http_code}\n" 127.0.0.1:8790/api/sessions`
Expected: `401`.

- [ ] **Step 6: Browser flow on LAN**

Open `http://192.168.0.10:5173` (restart vite if needed). Expect: register screen on first load → after register, the app loads with no token prompt. Reload → stays logged in (cookie). Open Settings → enroll 2FA → scan QR → confirm → "2FA ativo".

- [ ] **Step 7: Full suite green**

Run: `cd apps/server && npx vitest run && cd ../web && npx vitest run`
Expected: all PASS.

- [ ] **Step 8: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore(auth): integration cleanup" || echo "nothing to commit"
```

---

## Post-implementation notes (operational)

- For external exposure later: put Tormod **only** behind the trusted reverse proxy (no raw port-forward), then set `TORMOD_TRUSTED_PROXY=<proxy ip>` and `TORMOD_COOKIE_SECURE=true` (TLS at the edge). Enroll 2FA from the LAN/VPN first, or external login stays blocked by design.
- Update the project memory note (`project-tormod.md`) after merge: auth replaced the static token.
```

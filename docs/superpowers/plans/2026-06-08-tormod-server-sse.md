# Tormod — Server (Hono + SSE + Sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Wire the tested core (Plan 1) into a runnable HTTP server: a Session Manager that bridges the BrainAdapter + Permission Policy + audit + SSE, exposed via Hono routes behind bearer auth — driving the FakeBrainAdapter end-to-end (no LLM).

**Architecture:** `SessionManager` owns session lifecycle and the permission bridge: it registers as the adapter's event + permission handler, classifies each tool request with `classifyTool`, auto-resolves `auto`/`deny`, and parks `approve` requests as pending promises until a human decision arrives. Subscribers (SSE connections) receive a `ServerEvent` stream. `Audit` (SQLite) records every tool decision. Hono exposes sessions/messages/stream/decisions routes.

**Tech Stack:** Hono, @hono/node-server, better-sqlite3. Builds on Plan 1 (`apps/server`). Reference spec: `docs/superpowers/specs/2026-06-08-tormod-design.md` §4/§6/§7/§9.

---

## File Structure

```
apps/server/src/
  brain/adapter.ts        — MODIFY: PermissionHandler gains sessionId
  brain/fake.ts           — MODIFY: pass sessionId to the handler
  brain/fake.test.ts      — MODIFY: handler signature
  audit/audit.ts          — Audit (better-sqlite3): record + query
  audit/audit.test.ts
  session/events.ts       — ServerEvent type (BrainEvent + permission events)
  session/manager.ts      — SessionManager (the integration heart)
  session/manager.test.ts
  http/app.ts             — createApp(manager, {token}) → Hono app
  http/app.test.ts
  server.ts               — entry point (env token, wire FakeBrainAdapter, listen)
```

---

## Task 1: Amend PermissionHandler to carry sessionId

**Files:** Modify `apps/server/src/brain/adapter.ts`, `apps/server/src/brain/fake.ts`, `apps/server/src/brain/fake.test.ts`

- [ ] **Step 1: Update the test handler signatures first**

In `apps/server/src/brain/fake.test.ts`, change both `onPermissionRequest` callbacks to accept `(sessionId, req)`:
- `fake.onPermissionRequest(async (req) => {` → `fake.onPermissionRequest(async (_sessionId, req) => {`
- `fake.onPermissionRequest(async () => ({` → `fake.onPermissionRequest(async (_sessionId) => ({`

Run: `cd /home/odin/huginn/apps/server && npx vitest run src/brain/fake.test.ts` → expect FAIL (signature mismatch at runtime is fine; goal is to drive the change).

- [ ] **Step 2: Update the interface**

In `apps/server/src/brain/adapter.ts`, change the `PermissionHandler` type:

```ts
export type PermissionHandler = (
  sessionId: string,
  request: ToolRequest,
  toolUseId: string,
) => Promise<PermissionResponse>;
```

- [ ] **Step 3: Update FakeBrainAdapter to pass sessionId**

In `apps/server/src/brain/fake.ts`, in `sendMessage`, change the handler call:

```ts
const resp = this.permissionHandler
  ? await this.permissionHandler(id, event.request, event.id)
  : { allow: false, message: "no handler" };
```

- [ ] **Step 4: Verify and commit**

Run: `cd /home/odin/huginn/apps/server && npx vitest run && npm run typecheck` → all pass, tsc 0.

```bash
cd /home/odin/huginn && git add apps/server/src/brain/ && git commit -m "refactor(brain): pass sessionId to the permission handler"
```

---

## Task 2: Audit (SQLite)

**Files:** Create `apps/server/src/audit/audit.ts`, `apps/server/src/audit/audit.test.ts`; modify `apps/server/package.json`

- [ ] **Step 1: Add deps**

Run: `cd /home/odin/huginn/apps/server && npm install better-sqlite3@^11.0.0 && npm install -D @types/better-sqlite3@^7.6.0`

- [ ] **Step 2: Write failing tests**

Create `apps/server/src/audit/audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Audit } from "./audit.js";

describe("Audit", () => {
  it("records and queries entries", () => {
    const audit = Audit.open(":memory:");
    audit.record({ node: "truenas", tool: "Bash", command: "systemctl restart x", tier: "mutate", approved: 1 });
    audit.record({ node: "odin", tool: "Read", tier: "read", approved: 0 });
    const all = audit.query({});
    expect(all.length).toBe(2);
    expect(all[0]!.tool).toBeDefined();
  });

  it("filters by node and tier", () => {
    const audit = Audit.open(":memory:");
    audit.record({ node: "truenas", tool: "Bash", tier: "mutate", approved: 1 });
    audit.record({ node: "odin", tool: "Bash", tier: "read", approved: 0 });
    expect(audit.query({ node: "truenas" }).length).toBe(1);
    expect(audit.query({ tier: "read" }).length).toBe(1);
  });

  it("auto-fills an ISO timestamp", () => {
    const audit = Audit.open(":memory:");
    audit.record({ tool: "Read", tier: "read", approved: 0 });
    expect(audit.query({})[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

Run: `npx vitest run src/audit/audit.test.ts` → FAIL (no Audit).

- [ ] **Step 3: Implement**

Create `apps/server/src/audit/audit.ts`:

```ts
import Database from "better-sqlite3";

export interface AuditInput {
  sessionId?: string;
  node?: string;
  tool: string;
  command?: string;
  tier: string;
  approved: 0 | 1 | 2; // 0 auto/read · 1 approved · 2 denied
  exitCode?: number;
  durationMs?: number;
}

export interface AuditRow extends AuditInput {
  id: number;
  ts: string;
}

export interface AuditFilter {
  node?: string;
  tier?: string;
  sessionId?: string;
}

export class Audit {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): Audit {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        session_id TEXT,
        node TEXT,
        tool TEXT NOT NULL,
        command TEXT,
        tier TEXT NOT NULL,
        approved INTEGER NOT NULL,
        exit_code INTEGER,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
      CREATE INDEX IF NOT EXISTS idx_audit_node_tier ON audit(node, tier);
    `);
    return new Audit(db);
  }

  record(input: AuditInput): void {
    this.db
      .prepare(
        `INSERT INTO audit (ts, session_id, node, tool, command, tier, approved, exit_code, duration_ms)
         VALUES (@ts, @sessionId, @node, @tool, @command, @tier, @approved, @exitCode, @durationMs)`,
      )
      .run({
        ts: new Date().toISOString(),
        sessionId: input.sessionId ?? null,
        node: input.node ?? null,
        tool: input.tool,
        command: input.command ?? null,
        tier: input.tier,
        approved: input.approved,
        exitCode: input.exitCode ?? null,
        durationMs: input.durationMs ?? null,
      });
  }

  query(filter: AuditFilter): AuditRow[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.node) { where.push("node = @node"); params.node = filter.node; }
    if (filter.tier) { where.push("tier = @tier"); params.tier = filter.tier; }
    if (filter.sessionId) { where.push("session_id = @sessionId"); params.sessionId = filter.sessionId; }
    const sql = `SELECT id, ts, session_id as sessionId, node, tool, command, tier, approved, exit_code as exitCode, duration_ms as durationMs
                 FROM audit ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id`;
    return this.db.prepare(sql).all(params) as AuditRow[];
  }
}
```

> Note: `new Date().toISOString()` is allowed in runtime code (the no-`Date.now()` rule applies to workflow scripts, not app code).

Run: `npx vitest run src/audit/audit.test.ts && npm run typecheck` → pass, 0.

- [ ] **Step 4: Commit**

```bash
cd /home/odin/huginn && git add apps/server/src/audit/ apps/server/package.json apps/server/package-lock.json && git commit -m "feat(audit): SQLite append-only audit with filtered query"
```

---

## Task 3: Session Manager (the integration heart)

**Files:** Create `apps/server/src/session/events.ts`, `apps/server/src/session/manager.ts`, `apps/server/src/session/manager.test.ts`

- [ ] **Step 1: Define ServerEvent**

Create `apps/server/src/session/events.ts`:

```ts
import type { BrainEvent, ToolRequest } from "../brain/adapter.js";
import type { Tier } from "../types.js";

/** Events sent to SSE subscribers — brain events plus permission lifecycle. */
export type ServerEvent =
  | BrainEvent
  | { type: "permission_request"; toolUseId: string; request: ToolRequest; tier: Tier; literal?: string }
  | { type: "permission_resolved"; toolUseId: string; allow: boolean };
```

- [ ] **Step 2: Write failing tests**

Create `apps/server/src/session/manager.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SessionManager } from "./manager.js";
import { FakeBrainAdapter } from "../brain/fake.js";
import { Audit } from "../audit/audit.js";
import type { ServerEvent } from "./events.js";

function setup() {
  const fake = new FakeBrainAdapter();
  const audit = Audit.open(":memory:");
  const mgr = new SessionManager(fake, audit);
  return { fake, audit, mgr };
}

describe("SessionManager — lifecycle", () => {
  it("creates and lists a live session", async () => {
    const { mgr } = setup();
    const s = await mgr.createSession({ title: "test" });
    expect(s.status).toBe("live");
    expect(mgr.list().map((x) => x.id)).toContain(s.id);
  });

  it("close marks the session closed", async () => {
    const { mgr } = setup();
    const s = await mgr.createSession({});
    await mgr.close(s.id);
    expect(mgr.list().find((x) => x.id === s.id)!.status).toBe("closed");
  });
});

describe("SessionManager — streaming + auto/deny classification", () => {
  it("auto tool resolves without a permission_request", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const got: ServerEvent[] = [];
    mgr.subscribe(s.id, (e) => got.push(e));
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Bash", input: { command: "df -h" } } }]);
    await mgr.send(s.id, "check disk");
    expect(got.some((e) => e.type === "permission_request")).toBe(false);
    expect(got.find((e) => e.type === "tool_result")).toMatchObject({ ok: true });
  });

  it("destructive tool is denied without a card", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const got: ServerEvent[] = [];
    mgr.subscribe(s.id, (e) => got.push(e));
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Bash", input: { command: "rm -rf /" } } }]);
    await mgr.send(s.id, "go");
    expect(got.some((e) => e.type === "permission_request")).toBe(false);
    expect(got.find((e) => e.type === "tool_result")).toMatchObject({ ok: false });
  });
});

describe("SessionManager — approval bridge", () => {
  it("approve tool parks until resolveDecision(allow)", async () => {
    const { fake, mgr, audit } = setup();
    const s = await mgr.createSession({});
    const got: ServerEvent[] = [];
    mgr.subscribe(s.id, (e) => got.push(e));
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Edit", input: { file_path: "/x" } } }]);

    const sending = mgr.send(s.id, "edit");
    // give the microtask queue a tick so the permission_request is emitted
    await new Promise((r) => setTimeout(r, 0));
    const req = got.find((e) => e.type === "permission_request");
    expect(req).toBeDefined();

    mgr.resolveDecision("t1", true);
    await sending;

    expect(got.find((e) => e.type === "tool_result")).toMatchObject({ ok: true });
    expect(got.some((e) => e.type === "permission_resolved")).toBe(true);
    expect(audit.query({ tier: "mutate" }).length).toBe(1);
  });

  it("resolveDecision(false) denies the parked request", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const got: ServerEvent[] = [];
    mgr.subscribe(s.id, (e) => got.push(e));
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Write", input: { file_path: "/x" } } }]);
    const sending = mgr.send(s.id, "write");
    await new Promise((r) => setTimeout(r, 0));
    mgr.resolveDecision("t1", false);
    await sending;
    expect(got.find((e) => e.type === "tool_result")).toMatchObject({ ok: false });
  });
});
```

Run: `npx vitest run src/session/manager.test.ts` → FAIL (no SessionManager).

- [ ] **Step 3: Implement**

Create `apps/server/src/session/manager.ts`:

```ts
import type { BrainAdapter, BrainEvent, PermissionResponse } from "../brain/adapter.js";
import { classifyTool } from "../permission/policy.js";
import { Audit } from "../audit/audit.js";
import type { ServerEvent } from "./events.js";

export interface SessionMeta {
  id: string;
  status: "live" | "closed";
  title: string;
  cwd?: string;
  createdAt: string;
}

type Subscriber = (event: ServerEvent) => void;

interface Pending {
  resolve: (resp: PermissionResponse) => void;
}

/**
 * Owns session lifecycle and the permission bridge. Registers as the brain
 * adapter's event + permission handler; classifies each tool request and
 * either auto-resolves (auto/deny) or parks approval requests until a human
 * decision arrives via resolveDecision().
 */
export class SessionManager {
  private readonly sessions = new Map<string, SessionMeta>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly adapter: BrainAdapter,
    private readonly audit: Audit,
    private readonly classify = classifyTool,
  ) {
    this.adapter.onEvent((sessionId, event) => this.onBrainEvent(sessionId, event));
    this.adapter.onPermissionRequest((sessionId, request, toolUseId) =>
      this.onPermission(sessionId, request, toolUseId),
    );
  }

  async createSession(opts: { title?: string; cwd?: string }): Promise<SessionMeta> {
    const id = await this.adapter.startSession({ ...(opts.cwd ? { cwd: opts.cwd } : {}) });
    const meta: SessionMeta = {
      id,
      status: "live",
      title: opts.title ?? "Nova sessão",
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(id, meta);
    return meta;
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()];
  }

  async send(id: string, text: string): Promise<void> {
    await this.adapter.sendMessage(id, text);
  }

  async close(id: string): Promise<void> {
    await this.adapter.close(id);
    const meta = this.sessions.get(id);
    if (meta) meta.status = "closed";
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.subscribers.delete(id);
  }

  subscribe(id: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(id);
    if (!set) { set = new Set(); this.subscribers.set(id, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  resolveDecision(toolUseId: string, allow: boolean, message?: string): void {
    const p = this.pending.get(toolUseId);
    if (!p) return;
    this.pending.delete(toolUseId);
    p.resolve({ allow, ...(message ? { message } : {}) });
  }

  private emit(sessionId: string, event: ServerEvent): void {
    const set = this.subscribers.get(sessionId);
    if (set) for (const fn of set) fn(event);
  }

  private onBrainEvent(sessionId: string, event: BrainEvent): void {
    this.emit(sessionId, event);
  }

  private onPermission(
    sessionId: string,
    request: { tool: string; input: Record<string, unknown> },
    toolUseId: string,
  ): Promise<PermissionResponse> {
    const decision = this.classify(request);
    const node = typeof request.input.node === "string" ? request.input.node : undefined;
    const command = typeof request.input.command === "string" ? request.input.command : undefined;

    if (decision.tier === "auto") {
      this.audit.record({ sessionId, ...(node ? { node } : {}), tool: request.tool, ...(command ? { command } : {}), tier: "read", approved: 0 });
      return Promise.resolve({ allow: true });
    }
    if (decision.tier === "deny") {
      this.audit.record({ sessionId, ...(node ? { node } : {}), tool: request.tool, ...(command ? { command } : {}), tier: "destructive", approved: 2 });
      return Promise.resolve({ allow: false, message: decision.reason });
    }
    // approve → park until a human resolves.
    this.emit(sessionId, {
      type: "permission_request",
      toolUseId,
      request,
      tier: decision.tier,
      ...(decision.literal ? { literal: decision.literal } : {}),
    });
    return new Promise<PermissionResponse>((resolve) => {
      this.pending.set(toolUseId, {
        resolve: (resp) => {
          this.audit.record({ sessionId, ...(node ? { node } : {}), tool: request.tool, ...(command ? { command } : {}), tier: "mutate", approved: resp.allow ? 1 : 2 });
          this.emit(sessionId, { type: "permission_resolved", toolUseId, allow: resp.allow });
          resolve(resp);
        },
      });
    });
  }
}
```

Run: `npx vitest run src/session/manager.test.ts && npm run typecheck` → pass, 0.

- [ ] **Step 4: Commit**

```bash
cd /home/odin/huginn && git add apps/server/src/session/ && git commit -m "feat(session): SessionManager bridging policy, audit, and approval"
```

---

## Task 4: Hono app + bearer auth + routes + SSE

**Files:** Create `apps/server/src/http/app.ts`, `apps/server/src/http/app.test.ts`, `apps/server/src/server.ts`; modify `apps/server/package.json`

- [ ] **Step 1: Add deps**

Run: `cd /home/odin/huginn/apps/server && npm install hono@^4.6.0 @hono/node-server@^1.13.0`

- [ ] **Step 2: Write failing tests**

Create `apps/server/src/http/app.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { SessionManager } from "../session/manager.js";
import { FakeBrainAdapter } from "../brain/fake.js";
import { Audit } from "../audit/audit.js";

function app() {
  const mgr = new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"));
  return createApp(mgr, { token: "secret" });
}
const auth = { Authorization: "Bearer secret" };

describe("createApp — auth", () => {
  it("rejects requests without a token", async () => {
    const res = await app().request("/api/sessions", { method: "GET" });
    expect(res.status).toBe(401);
  });
  it("accepts requests with the token", async () => {
    const res = await app().request("/api/sessions", { headers: auth });
    expect(res.status).toBe(200);
  });
});

describe("createApp — sessions", () => {
  it("creates then lists a session", async () => {
    const a = app();
    const created = await a.request("/api/sessions", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "hi" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toMatch(/.+/);

    const listed = await a.request("/api/sessions", { headers: auth });
    const sessions = (await listed.json()) as Array<{ id: string }>;
    expect(sessions.map((s) => s.id)).toContain(id);
  });

  it("posting a message returns 202", async () => {
    const a = app();
    const created = await a.request("/api/sessions", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}",
    });
    const { id } = (await created.json()) as { id: string };
    const res = await a.request(`/api/sessions/${id}/messages`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(202);
  });
});
```

Run: `npx vitest run src/http/app.test.ts` → FAIL.

- [ ] **Step 3: Implement the app**

Create `apps/server/src/http/app.ts`:

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SessionManager } from "../session/manager.js";

export interface AppOptions {
  token: string;
}

export function createApp(manager: SessionManager, opts: AppOptions): Hono {
  const app = new Hono();

  // Bearer auth on all /api routes.
  app.use("/api/*", async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== opts.token) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.get("/api/sessions", (c) => c.json(manager.list()));

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const meta = await manager.createSession({
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
    });
    return c.json(meta, 201);
  });

  app.post("/api/sessions/:id/messages", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text : "";
    // fire-and-forget; the brain streams over SSE.
    void manager.send(c.req.param("id"), text);
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/sessions/:id/close", async (c) => {
    await manager.close(c.req.param("id"));
    return c.json({ closed: true });
  });

  app.delete("/api/sessions/:id", (c) => {
    manager.remove(c.req.param("id"));
    return c.json({ removed: true });
  });

  app.post("/api/decisions/:toolUseId", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    manager.resolveDecision(c.req.param("toolUseId"), body.allow === true);
    return c.json({ ok: true });
  });

  app.get("/api/sessions/:id/stream", (c) => {
    const id = c.req.param("id");
    return streamSSE(c, async (stream) => {
      const unsub = manager.subscribe(id, (event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      stream.onAbort(() => unsub());
      // keep the stream open until the client disconnects.
      while (!stream.aborted) {
        await stream.sleep(15000);
        await stream.writeSSE({ event: "ping", data: "{}" });
      }
    });
  });

  return app;
}
```

Run: `npx vitest run src/http/app.test.ts && npm run typecheck` → pass, 0.

- [ ] **Step 4: Entry point**

Create `apps/server/src/server.ts`:

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./http/app.js";
import { SessionManager } from "./session/manager.js";
import { FakeBrainAdapter } from "./brain/fake.js";
import { Audit } from "./audit/audit.js";

const token = process.env.TORMOD_TOKEN;
if (!token) {
  console.error("TORMOD_TOKEN is required");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8790);
const auditPath = process.env.TORMOD_AUDIT ?? "tormod-audit.db";

// Plan 2 wires the FakeBrainAdapter; Plan 3 swaps in the ClaudeCodeAdapter.
const manager = new SessionManager(new FakeBrainAdapter(), Audit.open(auditPath));
const app = createApp(manager, { token });

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.error(`Tormod server listening on http://127.0.0.1:${info.port}`);
});
```

Add a `dev`/`start` script to `apps/server/package.json` scripts:
```json
"start": "node --experimental-strip-types src/server.ts"
```
(Node 22 runs TS directly via `--experimental-strip-types`. If unavailable, the controller may add `tsx`.)

Run: `npm run typecheck` → 0. Run the full suite `npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
cd /home/odin/huginn && git add apps/server/src/http/ apps/server/src/server.ts apps/server/package.json apps/server/package-lock.json && git commit -m "feat(http): Hono app with bearer auth, session routes, and SSE stream"
```

---

## Self-Review

- **Spec coverage:** §6 data flow (SSE + POST + parked approval) → Task 3 manager + Task 4 SSE/decisions ✓. §9 decision layer (auto/approve/deny mapped through `classifyTool` in the manager) ✓. §5 audit append-only → Task 2 ✓. Bearer auth + bind localhost → Task 4 ✓. Multi-session → manager map ✓. ClaudeCodeAdapter, front, Docker deferred (Plans 3–5).
- **Placeholder scan:** none — full code in every step.
- **Type consistency:** `PermissionHandler(sessionId, request, toolUseId)` defined in Task 1, consumed by `SessionManager.onPermission` (Task 3) ✓. `ServerEvent` (Task 3 Step 1) consumed by manager + app SSE ✓. `Audit.record/query` shapes (Task 2) consumed by manager (Task 3) ✓. `createApp(manager, {token})` (Task 4) used by server.ts ✓.

## Notes
- Bind is `127.0.0.1` in Plan 2 (local only). The wg0 bind + HTTPS edge happen in Plan 5 (Docker/deploy).
- SSE reconnection with `Last-Event-ID` replay is NOT in this plan (live subscribe only) — add in a later hardening pass; noted as a known gap.

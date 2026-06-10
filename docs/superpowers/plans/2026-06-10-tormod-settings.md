# Tormod Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted, backend-enforced user settings area (max live sessions, idle auto-close, default model/effort) with a settings drawer in the UI.

**Architecture:** A `SettingsStore` (SQLite, single JSON row, defaults in code) is the source of truth. `SessionManager` reads it to enforce a live-session cap (auto-closing the longest-idle non-working sessions) and an idle sweep, and to apply default model/effort to new sessions. A `lastActivityAt` timestamp per session drives both. The front edits settings through a drawer.

**Tech Stack:** Node + Hono + better-sqlite3 (server), Vite + React + vitest (web). Follow existing patterns in `apps/server` and `apps/web`.

**Source of truth:** `docs/superpowers/specs/2026-06-10-tormod-settings-design.md`.

---

## File Structure

**Server (create):**
- `apps/server/src/settings/store.ts` — `Settings`, `DEFAULTS`, `SettingsStore` (SQLite).
- `apps/server/src/settings/store.test.ts`

**Server (modify):**
- `apps/server/src/session/store.ts` — add `last_activity_at` column + `lastActivityAt` to `StoredSession`.
- `apps/server/src/session/store.test.ts` — cover `lastActivityAt`.
- `apps/server/src/brain/adapter.ts` — `startSession` opts gain `model?`/`effort?`.
- `apps/server/src/brain/fake.ts` — match new `startSession` signature.
- `apps/server/src/brain/claude.ts` — inject `model`/`effort` into Agent SDK `Options`.
- `apps/server/src/session/manager.ts` — `SettingsStore` dep, `lastActivityAt`, cap enforcement, idle sweep, default model/effort.
- `apps/server/src/session/manager.test.ts` — cap + sweep tests.
- `apps/server/src/http/app.ts` — `GET`/`PUT /api/settings`.
- `apps/server/src/http/app.test.ts` — settings routes.
- `apps/server/src/server.ts` — open + wire `SettingsStore`.

**Web (create):**
- `apps/web/src/hooks/useSettings.ts`
- `apps/web/src/components/settings/SettingsDrawer.tsx`

**Web (modify):**
- `apps/web/src/lib/serverTypes.ts` — mirror `Settings`.
- `apps/web/src/lib/api.ts` — `getSettings`/`saveSettings`.
- `apps/web/src/lib/sessionFromMeta.ts` — `updatedAt` from `lastActivityAt`.
- `apps/web/src/app/App.tsx` — gear button + drawer.

Model id mapping (used in Task 6): `opus → claude-opus-4-8`, `sonnet → claude-sonnet-4-6`, `haiku → claude-haiku-4-5`.

---

## Task 1: SettingsStore (SQLite)

**Files:**
- Create: `apps/server/src/settings/store.ts`
- Test: `apps/server/src/settings/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/settings/store.test.ts
import { describe, it, expect } from "vitest";
import { SettingsStore, DEFAULTS } from "./store.js";

describe("SettingsStore", () => {
  it("returns defaults when empty", () => {
    const s = SettingsStore.open(":memory:");
    expect(s.get()).toEqual(DEFAULTS);
  });

  it("saves a partial patch and merges over current", () => {
    const s = SettingsStore.open(":memory:");
    const saved = s.save({ maxLiveSessions: 3, defaultModel: "opus" });
    expect(saved.maxLiveSessions).toBe(3);
    expect(saved.defaultModel).toBe("opus");
    expect(saved.idleCloseHours).toBe(DEFAULTS.idleCloseHours);
    expect(s.get()).toEqual(saved);
  });

  it("clamps numbers and rejects invalid enums to defaults", () => {
    const s = SettingsStore.open(":memory:");
    expect(s.save({ maxLiveSessions: 0 }).maxLiveSessions).toBe(1);
    expect(s.save({ maxLiveSessions: 999 }).maxLiveSessions).toBe(50);
    expect(s.save({ idleCloseHours: -5 }).idleCloseHours).toBe(0);
    expect(s.save({ idleCloseHours: 9999 }).idleCloseHours).toBe(168);
    expect(s.save({ defaultModel: "bogus" as never }).defaultModel).toBe(DEFAULTS.defaultModel);
    expect(s.save({ defaultEffort: "bogus" as never }).defaultEffort).toBe(DEFAULTS.defaultEffort);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/settings/store.test.ts`
Expected: FAIL — cannot find `./store.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/server/src/settings/store.ts
import Database from "better-sqlite3";

export interface Settings {
  maxLiveSessions: number;
  idleCloseHours: number;
  defaultModel: "auto" | "opus" | "sonnet" | "haiku";
  defaultEffort: "auto" | "low" | "medium" | "high" | "xhigh" | "max";
}

export const DEFAULTS: Settings = {
  maxLiveSessions: 5,
  idleCloseHours: 6,
  defaultModel: "auto",
  defaultEffort: "auto",
};

const MODELS = new Set(["auto", "opus", "sonnet", "haiku"]);
const EFFORTS = new Set(["auto", "low", "medium", "high", "xhigh", "max"]);

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalize(raw: Partial<Settings>): Settings {
  return {
    maxLiveSessions: clamp(raw.maxLiveSessions, 1, 50, DEFAULTS.maxLiveSessions),
    idleCloseHours: clamp(raw.idleCloseHours, 0, 168, DEFAULTS.idleCloseHours),
    defaultModel: MODELS.has(raw.defaultModel as string) ? (raw.defaultModel as Settings["defaultModel"]) : DEFAULTS.defaultModel,
    defaultEffort: EFFORTS.has(raw.defaultEffort as string) ? (raw.defaultEffort as Settings["defaultEffort"]) : DEFAULTS.defaultEffort,
  };
}

export class SettingsStore {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): SettingsStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);`);
    return new SettingsStore(db);
  }

  get(): Settings {
    const row = this.db.prepare(`SELECT data FROM settings WHERE id = 1`).get() as { data: string } | undefined;
    if (!row) return DEFAULTS;
    try {
      return normalize({ ...DEFAULTS, ...(JSON.parse(row.data) as Partial<Settings>) });
    } catch {
      return DEFAULTS;
    }
  }

  save(patch: Partial<Settings>): Settings {
    const next = normalize({ ...this.get(), ...patch });
    this.db
      .prepare(`INSERT INTO settings (id, data) VALUES (1, @data) ON CONFLICT(id) DO UPDATE SET data = @data`)
      .run({ data: JSON.stringify(next) });
    return next;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/settings/store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/settings/store.ts apps/server/src/settings/store.test.ts
git commit -m "feat(server): settings store with defaults, merge and clamping"
```

---

## Task 2: SessionStore `lastActivityAt` column

**Files:**
- Modify: `apps/server/src/session/store.ts`
- Test: `apps/server/src/session/store.test.ts`

- [ ] **Step 1: Add the failing test** — append inside the existing `describe("SessionStore", ...)` block:

```ts
  it("persists and updates lastActivityAt", () => {
    const store = SessionStore.open(":memory:");
    store.upsert({ id: "s1", title: "uma", status: "live", createdAt: "t0", lastActivityAt: "t0" });
    expect(store.all()[0]?.lastActivityAt).toBe("t0");
    store.setActivity("s1", "t1");
    expect(store.all()[0]?.lastActivityAt).toBe("t1");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx vitest run src/session/store.test.ts`
Expected: FAIL — `lastActivityAt` not on type / `setActivity` not a function.

- [ ] **Step 3: Implement** — in `apps/server/src/session/store.ts`:

Add `lastActivityAt` to `StoredSession`:

```ts
export interface StoredSession {
  id: string;
  title: string;
  cwd?: string;
  claudeId?: string;
  status: "live" | "closed";
  createdAt: string;
  lastActivityAt: string;
}
```

Add `last_activity_at` to the table DDL (in `open`):

```ts
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cwd TEXT,
        claude_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_activity_at TEXT
      );
    `);
```

Update `upsert` to write `last_activity_at` (keep it on conflict via COALESCE so claude_id-style updates don't wipe it):

```ts
  upsert(s: StoredSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, cwd, status, created_at, last_activity_at)
         VALUES (@id, @title, @cwd, @status, @createdAt, @lastActivityAt)
         ON CONFLICT(id) DO UPDATE SET title = @title, cwd = @cwd, status = @status, last_activity_at = @lastActivityAt`,
      )
      .run({
        id: s.id,
        title: s.title,
        cwd: s.cwd ?? null,
        status: s.status,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
      });
  }
```

Add `setActivity`:

```ts
  setActivity(id: string, lastActivityAt: string): void {
    this.db.prepare(`UPDATE sessions SET last_activity_at = ? WHERE id = ?`).run(lastActivityAt, id);
  }
```

Add `last_activity_at` to the `Row` interface and the `SELECT` + mapping in `all()`:

```ts
interface Row {
  id: string;
  title: string;
  cwd: string | null;
  claude_id: string | null;
  status: string;
  created_at: string;
  last_activity_at: string | null;
}
```

```ts
  all(): StoredSession[] {
    const rows = this.db
      .prepare(`SELECT id, title, cwd, claude_id, status, created_at, last_activity_at FROM sessions ORDER BY created_at`)
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      ...(r.cwd !== null ? { cwd: r.cwd } : {}),
      ...(r.claude_id !== null ? { claudeId: r.claude_id } : {}),
      status: r.status === "closed" ? "closed" : "live",
      createdAt: r.created_at,
      lastActivityAt: r.last_activity_at ?? r.created_at,
    }));
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx vitest run src/session/store.test.ts`
Expected: PASS (3 tests — the two existing `upsert` tests must also pass; they now require `lastActivityAt` on their `upsert` calls — update them to include `lastActivityAt: "t0"`).

- [ ] **Step 5: Fix the two existing store tests** that call `upsert` without `lastActivityAt`: add `lastActivityAt: "2026-06-10T00:00:00Z"` (or any ISO string) to each `upsert({...})` literal in `store.test.ts`. Re-run Step 4 until green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/session/store.ts apps/server/src/session/store.test.ts
git commit -m "feat(server): track lastActivityAt on sessions"
```

---

## Task 3: Adapter `startSession` accepts model/effort

**Files:**
- Modify: `apps/server/src/brain/adapter.ts`
- Modify: `apps/server/src/brain/fake.ts`
- Modify: `apps/server/src/brain/claude.ts`
- Test: `apps/server/src/brain/claude.test.ts`

- [ ] **Step 1: Write the failing test** — append to `describe("ClaudeCodeAdapter", ...)` in `claude.test.ts`. It captures the `options` the fake `query` receives:

```ts
  it("passes model and effort into the SDK options", async () => {
    let captured: Options | undefined;
    const adapter = new ClaudeCodeAdapter({
      queryFn: (params) => {
        captured = params.options;
        const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
          yield initMsg("m1");
          for await (const _u of params.prompt) yield resultMsg("m1", true, 0);
        })();
        return Object.assign(gen, { interrupt: async () => void (await gen.return()) });
      },
    });
    await adapter.startSession({ model: "claude-opus-4-8", effort: "high" });
    expect(captured?.model).toBe("claude-opus-4-8");
    expect((captured as { effort?: string }).effort).toBe("high");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx vitest run src/brain/claude.test.ts`
Expected: FAIL — `startSession` doesn't accept `model`/`effort` (type error) or they're not forwarded.

- [ ] **Step 3: Implement**

In `adapter.ts`, widen `startSession` on the `BrainAdapter` interface:

```ts
  startSession(opts: { cwd?: string; model?: string; effort?: string }): Promise<string>;
```

In `fake.ts`, widen the signature (ignore the new fields):

```ts
  async startSession(_opts: { cwd?: string; model?: string; effort?: string }): Promise<string> {
```

In `claude.ts`, thread `model`/`effort` through `startSession` → `spawn`:

```ts
  async startSession(opts: { cwd?: string; model?: string; effort?: string }): Promise<string> {
    const publicId = randomUUID();
    const session = this.spawn(publicId, {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
    });
    this.sessions.set(publicId, session);
    void this.runConsumeLoop(session);
    return publicId;
  }
```

Update `spawn`'s `extra` type and `options` build:

```ts
  private spawn(publicId: string, extra: { cwd?: string; resume?: string; model?: string; effort?: string }): LiveSession {
    // ...unchanged queue/session/canUseTool...
    const options: Options = {
      ...this.baseOptions,
      permissionMode: "default",
      canUseTool,
      ...(this.streaming
        ? { includePartialMessages: true, thinking: { type: "adaptive", display: "summarized" } as const }
        : {}),
      ...(extra.cwd ? { cwd: extra.cwd } : {}),
      ...(extra.resume ? { resume: extra.resume } : {}),
      ...(extra.model ? { model: extra.model } : {}),
      ...(extra.effort ? { effort: extra.effort as EffortLevel } : {}),
    };
    session.q = this.queryFn({ prompt: queue, options });
    return session;
  }
```

Add `EffortLevel` to the type import from the SDK at the top of `claude.ts`:

```ts
import type {
  CanUseTool,
  EffortLevel,
  Options,
  SDKMessage,
  SDKUserMessage,
  SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx vitest run src/brain/claude.test.ts`
Expected: PASS (all ClaudeCodeAdapter tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/brain/adapter.ts apps/server/src/brain/fake.ts apps/server/src/brain/claude.ts apps/server/src/brain/claude.test.ts
git commit -m "feat(brain): startSession accepts model and effort"
```

---

## Task 4: Manager — lastActivityAt tracking

**Files:**
- Modify: `apps/server/src/session/manager.ts`
- Test: `apps/server/src/session/manager.test.ts`

- [ ] **Step 1: Write the failing test** — in `manager.test.ts`, add a clock-injection-free check that `createSession` stamps `lastActivityAt` and `send` bumps it. Add to the lifecycle `describe`:

```ts
  it("stamps lastActivityAt on create and bumps it on send", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const created = mgr.list().find((x) => x.id === s.id)!.lastActivityAt;
    expect(created).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    fake.script([{ type: "text", text: "x" }, { type: "result", ok: true }]);
    await mgr.send(s.id, "hi");
    const after = mgr.list().find((x) => x.id === s.id)!.lastActivityAt;
    expect(after >= created!).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx vitest run src/session/manager.test.ts`
Expected: FAIL — `lastActivityAt` is undefined on `SessionMeta`.

- [ ] **Step 3: Implement**

Add `lastActivityAt` to `SessionMeta`:

```ts
export interface SessionMeta {
  id: string;
  status: "live" | "closed";
  title: string;
  cwd?: string;
  createdAt: string;
  lastActivityAt: string;
  activity?: "idle" | "working" | "waiting";
}
```

In `createSession`, stamp it and include in the store upsert:

```ts
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id,
      status: "live",
      title: opts.title ?? "Nova sessão",
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      createdAt: now,
      lastActivityAt: now,
      activity: "idle",
    };
    this.sessions.set(id, meta);
    this.store?.upsert({
      id,
      title: meta.title,
      ...(meta.cwd ? { cwd: meta.cwd } : {}),
      status: "live",
      createdAt: meta.createdAt,
      lastActivityAt: meta.lastActivityAt,
    });
```

Add a `touch` helper and call it in `send` and `setActivity`:

```ts
  private touch(id: string, persist: boolean): void {
    const meta = this.sessions.get(id);
    if (!meta) return;
    meta.lastActivityAt = new Date().toISOString();
    if (persist) this.store?.setActivity(id, meta.lastActivityAt);
  }
```

In `send`, after ensuring live and before `setActivity`, call `this.touch(id, true)`. In `setActivity` (already exists), add `this.touch(id, false)` at the top (in-memory bump only — avoids a DB write per stream event).

In `hydrate`, set `meta.lastActivityAt` from `row.lastActivityAt`:

```ts
      const meta: SessionMeta = {
        id: row.id,
        status: "closed",
        title: row.title,
        ...(row.cwd ? { cwd: row.cwd } : {}),
        createdAt: row.createdAt,
        lastActivityAt: row.lastActivityAt,
      };
```

In `close`, persist the final activity time:

```ts
  async close(id: string): Promise<void> {
    await this.adapter.close(id);
    const meta = this.sessions.get(id);
    if (meta) meta.status = "closed";
    this.store?.setStatus(id, "closed");
    if (meta) this.store?.setActivity(id, meta.lastActivityAt);
    this.broadcast({ type: "session_status", id, status: "closed" });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx vitest run src/session/manager.test.ts`
Expected: PASS (existing + new). Existing tests don't assert `lastActivityAt`, so they stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/session/manager.ts apps/server/src/session/manager.test.ts
git commit -m "feat(session): track lastActivityAt in the manager"
```

---

## Task 5: Manager — settings dep + default model/effort on create

**Files:**
- Modify: `apps/server/src/session/manager.ts`
- Test: `apps/server/src/session/manager.test.ts`

- [ ] **Step 1: Write the failing test** — verify the manager passes the configured default model/effort to the adapter's `startSession`. Add a capturing fake at the top of `manager.test.ts` if needed; simplest is to spy on `FakeBrainAdapter.startSession` via a subclass. Add:

```ts
import { SettingsStore } from "../settings/store.js";

it("applies default model/effort from settings on create", async () => {
  const audit = Audit.open(":memory:");
  const settings = SettingsStore.open(":memory:");
  settings.save({ defaultModel: "opus", defaultEffort: "high" });
  let captured: { model?: string; effort?: string } | undefined;
  const fake = new FakeBrainAdapter();
  const orig = fake.startSession.bind(fake);
  fake.startSession = (opts) => { captured = opts; return orig(opts); };
  const mgr = new SessionManager(fake, audit, undefined, settings);
  await mgr.createSession({});
  expect(captured?.model).toBe("claude-opus-4-8");
  expect(captured?.effort).toBe("high");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx vitest run src/session/manager.test.ts`
Expected: FAIL — constructor has no 4th `settingsStore` param / model not mapped.

- [ ] **Step 3: Implement**

Import and add the constructor param + a model map:

```ts
import { DEFAULTS, type Settings, type SettingsStore } from "../settings/store.js";

const MODEL_IDS: Record<"opus" | "sonnet" | "haiku", string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};
```

```ts
  constructor(
    private readonly adapter: BrainAdapter,
    private readonly audit: Audit,
    private readonly store?: SessionStore,
    private readonly settingsStore?: SettingsStore,
    private readonly classify = classifyTool,
  ) {
    // ...existing handler registrations + hydrate...
  }

  private settings(): Settings {
    return this.settingsStore?.get() ?? DEFAULTS;
  }
```

In `createSession`, compute model/effort from settings and pass to `startSession`:

```ts
  async createSession(opts: { title?: string; cwd?: string }): Promise<SessionMeta> {
    const cfg = this.settings();
    const model = cfg.defaultModel === "auto" ? undefined : MODEL_IDS[cfg.defaultModel];
    const effort = cfg.defaultEffort === "auto" ? undefined : cfg.defaultEffort;
    const id = await this.adapter.startSession({
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
    });
    // ...rest unchanged (meta build + store upsert)...
  }
```

> Note: the manager.test `setup()` builds `new SessionManager(fake, audit)` (2 args) — still valid; `settingsStore` is `undefined` → `DEFAULTS`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx vitest run src/session/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/session/manager.ts apps/server/src/session/manager.test.ts
git commit -m "feat(session): apply default model/effort from settings"
```

---

## Task 6: Manager — live-session cap (auto-close longest-idle)

**Files:**
- Modify: `apps/server/src/session/manager.ts`
- Test: `apps/server/src/session/manager.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("closes the longest-idle session when over the cap", async () => {
  const audit = Audit.open(":memory:");
  const settings = SettingsStore.open(":memory:");
  settings.save({ maxLiveSessions: 2 });
  const mgr = new SessionManager(new FakeBrainAdapter(), audit, undefined, settings);
  const a = await mgr.createSession({ title: "a" });
  await new Promise((r) => setTimeout(r, 5));
  const b = await mgr.createSession({ title: "b" });
  await new Promise((r) => setTimeout(r, 5));
  const c = await mgr.createSession({ title: "c" }); // exceeds cap of 2
  const live = mgr.list().filter((s) => s.status === "live").map((s) => s.id);
  expect(live).not.toContain(a.id); // oldest-idle closed
  expect(live).toEqual(expect.arrayContaining([b.id, c.id]));
  expect(live.length).toBe(2);
});

it("does not close a working session to honor the cap", async () => {
  const audit = Audit.open(":memory:");
  const settings = SettingsStore.open(":memory:");
  settings.save({ maxLiveSessions: 1 });
  const fake = new FakeBrainAdapter();
  const mgr = new SessionManager(fake, audit, undefined, settings);
  const a = await mgr.createSession({ title: "a" });
  // make 'a' working: a tool_use that parks on the permission card keeps it busy
  fake.script([{ type: "tool_use", id: "t1", request: { tool: "Edit", input: { file_path: "/x" } } }]);
  void mgr.send(a.id, "edit");
  await new Promise((r) => setTimeout(r, 0)); // 'a' now waiting (active)
  const b = await mgr.createSession({ title: "b" }); // cap=1 but 'a' is active
  const live = mgr.list().filter((s) => s.status === "live").map((s) => s.id);
  expect(live).toEqual(expect.arrayContaining([a.id, b.id])); // temporary over-cap
  mgr.resolveDecision("t1", true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx vitest run src/session/manager.test.ts`
Expected: FAIL — no cap enforcement; all sessions stay live.

- [ ] **Step 3: Implement** — add `enforceCap(exceptId)` and call it at the end of `createSession`. It excludes the just-created session from the candidates (closing the brand-new session to honor the cap would be nonsensical) and only closes idle, non-active sessions:

```ts
  private async enforceCap(exceptId: string): Promise<void> {
    const max = this.settings().maxLiveSessions;
    const live = [...this.sessions.values()].filter((m) => m.status === "live");
    if (live.length <= max) return;
    const idle = live
      .filter((m) => m.id !== exceptId && m.activity !== "working" && m.activity !== "waiting")
      .sort((x, y) => x.lastActivityAt.localeCompare(y.lastActivityAt)); // oldest-idle first
    const toClose = idle.slice(0, live.length - max); // protects active turns + the new session
    for (const m of toClose) await this.close(m.id);
  }
```

At the end of `createSession`, before `return meta;` (the `id` is the just-created session's id):

```ts
    await this.enforceCap(id);
    return meta;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx vitest run src/session/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/session/manager.ts apps/server/src/session/manager.test.ts
git commit -m "feat(session): enforce live-session cap by closing idle sessions"
```

---

## Task 7: Manager — idle sweep

**Files:**
- Modify: `apps/server/src/session/manager.ts`
- Test: `apps/server/src/session/manager.test.ts`

- [ ] **Step 1: Write the failing test** (calls the sweep method directly; no real timer):

```ts
it("sweepIdle closes sessions idle beyond idleCloseHours and respects 0=off", async () => {
  const audit = Audit.open(":memory:");
  const settings = SettingsStore.open(":memory:");
  settings.save({ idleCloseHours: 1 });
  const mgr = new SessionManager(new FakeBrainAdapter(), audit, undefined, settings);
  const a = await mgr.createSession({ title: "a" });
  // force its lastActivityAt two hours into the past
  const meta = mgr.list().find((s) => s.id === a.id)!;
  (meta as { lastActivityAt: string }).lastActivityAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  await mgr.sweepIdle();
  expect(mgr.list().find((s) => s.id === a.id)!.status).toBe("closed");

  // with 0, never closes
  settings.save({ idleCloseHours: 0 });
  const b = await mgr.createSession({ title: "b" });
  const mb = mgr.list().find((s) => s.id === b.id)!;
  (mb as { lastActivityAt: string }).lastActivityAt = new Date(Date.now() - 99 * 3600_000).toISOString();
  await mgr.sweepIdle();
  expect(mgr.list().find((s) => s.id === b.id)!.status).toBe("live");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx vitest run src/session/manager.test.ts`
Expected: FAIL — `mgr.sweepIdle` is not a function.

- [ ] **Step 3: Implement** — add `sweepIdle` (public so tests/timer call it), start an unref'd interval in the constructor when a settings store is present, and add `dispose`:

```ts
  private sweepTimer?: ReturnType<typeof setInterval>;
```

At the end of the constructor:

```ts
    if (this.settingsStore) {
      this.sweepTimer = setInterval(() => void this.sweepIdle(), 60_000);
      this.sweepTimer.unref?.();
    }
```

```ts
  async sweepIdle(): Promise<void> {
    const hours = this.settings().idleCloseHours;
    if (hours <= 0) return;
    const cutoff = Date.now() - hours * 3600_000;
    const stale = [...this.sessions.values()].filter(
      (m) => m.status === "live" && m.activity !== "working" && m.activity !== "waiting" && Date.parse(m.lastActivityAt) < cutoff,
    );
    for (const m of stale) await this.close(m.id);
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx vitest run src/session/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/session/manager.ts apps/server/src/session/manager.test.ts
git commit -m "feat(session): idle sweep auto-closes stale sessions"
```

---

## Task 8: HTTP — settings routes

**Files:**
- Modify: `apps/server/src/http/app.ts`
- Test: `apps/server/src/http/app.test.ts`

- [ ] **Step 1: Inspect** `app.test.ts` to match its harness (it builds a `SessionManager` + `createApp`). The settings routes need the `SettingsStore` — pass it to `createApp` via a new option.

- [ ] **Step 2: Write the failing test** — add to `app.test.ts`:

```ts
it("GET /api/settings returns defaults; PUT updates", async () => {
  const settings = SettingsStore.open(":memory:");
  const app = createApp(new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"), undefined, settings), {
    token: "t",
    settings,
  });
  const h = { Authorization: "Bearer t", "Content-Type": "application/json" };

  const got = await app.request("/api/settings", { headers: h });
  expect(got.status).toBe(200);
  expect((await got.json()).maxLiveSessions).toBe(5);

  const put = await app.request("/api/settings", { method: "PUT", headers: h, body: JSON.stringify({ maxLiveSessions: 3 }) });
  expect(put.status).toBe(200);
  expect((await put.json()).maxLiveSessions).toBe(3);
});

it("settings routes require auth", async () => {
  const settings = SettingsStore.open(":memory:");
  const app = createApp(new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"), undefined, settings), { token: "t", settings });
  const res = await app.request("/api/settings");
  expect(res.status).toBe(401);
});
```

Add the imports `SettingsStore`, `SessionManager`, `FakeBrainAdapter`, `Audit` at the top of the test file if not present.

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/server && npx vitest run src/http/app.test.ts`
Expected: FAIL — `AppOptions` has no `settings`; routes 404.

- [ ] **Step 4: Implement** — in `app.ts`:

Extend `AppOptions` and `createApp` signature:

```ts
import type { SettingsStore } from "../settings/store.js";

export interface AppOptions {
  token: string;
  settings: SettingsStore;
}
```

Add routes (after the existing `/api/sessions` GET, inside the auth-guarded area):

```ts
  app.get("/api/settings", (c) => c.json(opts.settings.get()));

  app.put("/api/settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json(opts.settings.save(body));
  });
```

> `save` normalizes/clamps, so an arbitrary body is safe.

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/server && npx vitest run src/http/app.test.ts`
Expected: PASS. The existing `app.test.ts` `createApp(..., { token })` calls now need `settings` — update them to pass a `SettingsStore.open(":memory:")`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/http/app.ts apps/server/src/http/app.test.ts
git commit -m "feat(http): settings GET/PUT routes"
```

---

## Task 9: Wire SettingsStore in server.ts

**Files:**
- Modify: `apps/server/src/server.ts`

- [ ] **Step 1: Implement** — open the store and pass it to both the manager and the app:

```ts
import { SettingsStore } from "./settings/store.js";

// ...after auditPath...
const settings = SettingsStore.open(auditPath);

const manager = new SessionManager(brain, Audit.open(auditPath), SessionStore.open(auditPath), settings);
const app = createApp(manager, { token, settings });
```

- [ ] **Step 2: Verify**

Run: `cd apps/server && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all suites pass.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/server.ts
git commit -m "chore(server): wire settings store into manager and app"
```

---

## Task 10: Front — Settings type + API client

**Files:**
- Modify: `apps/web/src/lib/serverTypes.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Implement** — add to `serverTypes.ts`:

```ts
export interface Settings {
  maxLiveSessions: number
  idleCloseHours: number
  defaultModel: 'auto' | 'opus' | 'sonnet' | 'haiku'
  defaultEffort: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}
```

Add to `api.ts` (after the existing exports):

```ts
import type { /* existing */, Settings } from './serverTypes'

export async function getSettings(): Promise<Settings> {
  const res = await expectOk(await fetch('/api/settings', { headers: authHeaders() }))
  return res.json() as Promise<Settings>
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const res = await expectOk(
    await fetch('/api/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(patch) }),
  )
  return res.json() as Promise<Settings>
}
```

- [ ] **Step 2: Verify**

Run: `cd apps/web && npx tsc -b`
Expected: only the 3 pre-existing errors (`StatusLine.tsx`, `main.tsx`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/serverTypes.ts apps/web/src/lib/api.ts
git commit -m "feat(web): settings types and API client"
```

---

## Task 11: Front — useSettings hook

**Files:**
- Create: `apps/web/src/hooks/useSettings.ts`

- [ ] **Step 1: Implement**

```ts
import { useCallback, useEffect, useState } from 'react'
import { getSettings, saveSettings } from '@/lib/api'
import type { Settings } from '@/lib/serverTypes'

export function useSettings(open: boolean) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getSettings()
      .then((s) => { if (!cancelled) setSettings(s) })
      .catch((err) => console.error('getSettings', err))
    return () => { cancelled = true }
  }, [open])

  const save = useCallback(async (patch: Partial<Settings>) => {
    setSaving(true)
    try {
      const next = await saveSettings(patch)
      setSettings(next)
    } catch (err) {
      console.error('saveSettings', err)
    } finally {
      setSaving(false)
    }
  }, [])

  return { settings, saving, save }
}
```

- [ ] **Step 2: Verify** `cd apps/web && npx tsc -b` → only pre-existing errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useSettings.ts
git commit -m "feat(web): useSettings hook"
```

---

## Task 12: Front — SettingsDrawer + App wiring

**Files:**
- Create: `apps/web/src/components/settings/SettingsDrawer.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/lib/sessionFromMeta.ts`

- [ ] **Step 1: Create `SettingsDrawer.tsx`** — a right-side overlay panel. Uses `useSettings(open)`. Saves on change (debounce not required; save on blur/change is fine for these few fields).

```tsx
import { X } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/Button'
import type { Settings } from '@/lib/serverTypes'

const MODELS: Settings['defaultModel'][] = ['auto', 'opus', 'sonnet', 'haiku']
const EFFORTS: Settings['defaultEffort'][] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { settings, saving, save } = useSettings(open)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-sm flex-col gap-5 border-l border-border bg-deep p-5 text-frost"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Configurações</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="size-5" />
          </Button>
        </div>

        {!settings ? (
          <p className="text-sm text-faint">Carregando…</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Máximo de sessões vivas</span>
              <input
                type="number"
                min={1}
                max={50}
                defaultValue={settings.maxLiveSessions}
                onChange={(e) => save({ maxLiveSessions: Number(e.target.value) })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              />
              <span className="text-[11px] text-faint">
                Ao exceder, as sessões ociosas há mais tempo são fechadas automaticamente (turnos em andamento são preservados).
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Horas ociosas para fechar</span>
              <input
                type="number"
                min={0}
                max={168}
                defaultValue={settings.idleCloseHours}
                onChange={(e) => save({ idleCloseHours: Number(e.target.value) })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              />
              <span className="text-[11px] text-faint">0 desliga o fechamento automático por ociosidade.</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Modelo padrão</span>
              <select
                defaultValue={settings.defaultModel}
                onChange={(e) => save({ defaultModel: e.target.value as Settings['defaultModel'] })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              >
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Effort padrão</span>
              <select
                defaultValue={settings.defaultEffort}
                onChange={(e) => save({ defaultEffort: e.target.value as Settings['defaultEffort'] })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              >
                {EFFORTS.map((ef) => <option key={ef} value={ef}>{ef}</option>)}
              </select>
            </label>

            <span className="text-[11px] text-faint">
              {saving ? 'Salvando…' : 'Modelo e effort valem para sessões novas.'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into `App.tsx`** — add a gear button near `Brand` and render the drawer. Add state `const [settingsOpen, setSettingsOpen] = useState(false)`. In the `<aside>`, wrap `Brand` with a row containing a gear button:

```tsx
import { Settings as SettingsIcon } from 'lucide-react'
import { SettingsDrawer } from '@/components/settings/SettingsDrawer'
```

```tsx
        <div className="flex items-center justify-between">
          <Brand />
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Configurações">
            <SettingsIcon className="size-5" />
          </Button>
        </div>
```

And before the closing root `</div>`:

```tsx
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

- [ ] **Step 3: `sessionFromMeta.ts`** — show last activity instead of creation time:

```ts
    updatedAt: shortTime(meta.lastActivityAt ?? meta.createdAt),
```

And add `lastActivityAt?: string` to the front `SessionMeta` in `serverTypes.ts`.

- [ ] **Step 4: Verify**

Run: `cd apps/web && npx tsc -b`
Expected: only the 3 pre-existing errors.

If `lucide-react` lacks a `Settings` icon export, use `SlidersHorizontal` or `Cog`; verify by checking `node_modules/lucide-react` exports. (The project already imports `Cpu`, `ChevronLeft`, etc.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/SettingsDrawer.tsx apps/web/src/app/App.tsx apps/web/src/lib/sessionFromMeta.ts apps/web/src/lib/serverTypes.ts
git commit -m "feat(web): settings drawer with gear toggle"
```

---

## Task 13: Live end-to-end verification

- [ ] **Step 1:** Restart the backend (claude brain) and confirm: `GET /api/settings` returns defaults; `PUT` with `{maxLiveSessions:2}` persists across a restart.
- [ ] **Step 2:** In the browser: open the gear → change max live to 2 → create 3 sessions → the longest-idle closes automatically (sidebar reflects it).
- [ ] **Step 3:** Set `defaultModel: opus`, create a session, send a message, confirm the usage line shows the opus model.
- [ ] **Step 4:** Set `idleCloseHours` low is impractical to test live; rely on the unit test for the sweep.

---

## Notes for the executor

- The session this is implemented in has uncommitted work on branch `feat/web-ui`. Follow the project git rules (Conventional Commits, **never** mention AI/Claude in messages). Commit steps above follow that.
- After each server task: `cd apps/server && npx vitest run` (full suite) before committing.
- Web has no test for components; verify the drawer live. The reducer/store logic is unit-tested.
- `SessionManager` constructor param order is `(adapter, audit, sessionStore?, settingsStore?, classify?)` — existing 2-arg callers stay valid.

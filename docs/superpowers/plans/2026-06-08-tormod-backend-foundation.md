# Tormod — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested, HTTP-free core of the Tormod backend: the Permission Policy (security gate) and the BrainAdapter contract with a FakeBrainAdapter for testing.

**Architecture:** Node + TypeScript (strict), tested with Vitest. The Permission Policy classifies every tool-use request into `auto` / `approve` / `deny` — it is the structural backstop against prompt injection and is built test-first with an attack matrix. The `BrainAdapter` interface abstracts the "brain" (Claude Code) behind one seam; `FakeBrainAdapter` implements it so the whole app can be tested without ever calling an LLM.

**Tech Stack:** Node ≥20, TypeScript 5 (strict), Vitest, `shlex` (pure-TS command tokenizer via `shlex` npm pkg). No runtime deps beyond shlex in this plan.

**Reference:** Spec at `docs/superpowers/specs/2026-06-08-tormod-design.md` (§5 BrainAdapter, §8 Security, §9 decision layer, §11 tests). The Permission Policy maps the spec's tiers onto Claude Code tool names.

---

## File Structure

```
apps/server/
  package.json            — server package, scripts (test, build, typecheck)
  tsconfig.json           — strict TS config
  vitest.config.ts        — test runner config
  src/
    types.ts              — shared domain types (Tier, ToolRequest, PermissionDecision, BrainEvent…)
    permission/
      policy.ts           — classifyTool(req, config) → PermissionDecision  (THE security gate)
      policy.test.ts      — attack matrix + behaviour tests
      defaults.ts         — default read-only tool names, safe Bash allowlist, destructive deny patterns
    brain/
      adapter.ts          — BrainAdapter interface + event/decision types
      fake.ts             — FakeBrainAdapter (scriptable, no LLM)
      fake.test.ts        — contract tests for FakeBrainAdapter
```

Each file has one responsibility. `policy.ts` holds only classification logic (pure, no I/O). `defaults.ts` holds the data (lists/patterns) so the logic stays readable and the lists are auditable in isolation.

---

## Task 1: Project scaffold

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/src/types.ts`

- [ ] **Step 1: Create the server package.json**

Create `apps/server/package.json`:

```json
{
  "name": "@tormod/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "shlex": "^2.1.2"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json (strict)**

Create `apps/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

Create `apps/server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create shared domain types**

Create `apps/server/src/types.ts`:

```ts
/** Permission tier — maps to the palette colors safe/approve/danger. */
export type Tier = "auto" | "approve" | "deny";

/** A tool-use request as surfaced by the brain (provider-neutral shape). */
export interface ToolRequest {
  /** Tool name, e.g. "Read", "Edit", "Bash", "WebFetch". */
  tool: string;
  /** Tool-specific input. For Bash, expects `{ command: string }`. */
  input: Record<string, unknown>;
}

/** Result of classifying a ToolRequest. */
export interface PermissionDecision {
  tier: Tier;
  /** Short, human-readable reason shown in logs / the approval card. */
  reason: string;
  /** The literal command/diff to display when tier === "approve". */
  literal?: string;
}
```

- [ ] **Step 5: Install deps and verify typecheck**

Run: `cd apps/server && npm install && npm run typecheck`
Expected: installs cleanly; `tsc --noEmit` exits 0 (no errors).

- [ ] **Step 6: Commit**

```bash
git add apps/server/package.json apps/server/tsconfig.json apps/server/vitest.config.ts apps/server/src/types.ts
git commit -m "chore(server): scaffold TypeScript server package with vitest"
```

---

## Task 2: Permission Policy defaults (the auditable lists)

**Files:**
- Create: `apps/server/src/permission/defaults.ts`

- [ ] **Step 1: Create the defaults**

Create `apps/server/src/permission/defaults.ts`:

```ts
/** Tools that only read — run without an approval card. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "NotebookRead",
  "TodoRead",
  "ListMcpResources",
]);

/**
 * Outbound/network tools. NEVER auto — a tricked brain could exfiltrate
 * (read a secret, then POST it out). Always require approval.
 */
export const OUTBOUND_TOOLS: ReadonlySet<string> = new Set([
  "WebFetch",
  "WebSearch",
]);

/**
 * Bash first-token + (optional) second-token combos that are provably
 * read-only. Matched after shlex tokenization. A bare binary matches when
 * the command's argv[0] equals it; "bin sub" matches argv[0]+argv[1].
 */
export const SAFE_BASH: ReadonlySet<string> = new Set([
  "ls", "cat", "head", "tail", "pwd", "whoami", "id", "date", "uptime",
  "df", "free", "uname", "hostname", "ss", "ip", "ping", "dig", "host",
  "ps", "top", "env", "echo", "which", "stat", "wc", "grep", "find",
  "docker ps", "docker logs", "docker images", "docker inspect",
  "systemctl status", "systemctl is-active", "systemctl is-enabled",
  "systemctl list-units", "journalctl",
  "git status", "git log", "git diff", "git show", "git branch",
  "wg show", "ufw status",
]);

/**
 * Destructive Bash signals — deny outright (never even an approvable card
 * through the normal path). Matched as substrings on the raw command AND as
 * argv[0] checks. Conservative on purpose.
 */
export const DESTRUCTIVE_BINS: ReadonlySet<string> = new Set([
  "sudo", "su", "dd", "mkfs", "fdisk", "parted", "shutdown", "reboot",
  "halt", "poweroff", "init",
]);

/** Substrings that, if present anywhere in a Bash command, force deny. */
export const DESTRUCTIVE_SUBSTRINGS: readonly string[] = [
  "rm -rf", "rm -fr", "rm -r", "rm -f",
  ":(){:|:&};:",          // fork bomb
  "mkfs", "> /dev/sd", "of=/dev/",
  "chmod -R 777 /",
];

/** Config the policy is constructed with. Lets callers extend the defaults. */
export interface PolicyConfig {
  readOnlyTools: ReadonlySet<string>;
  outboundTools: ReadonlySet<string>;
  safeBash: ReadonlySet<string>;
  destructiveBins: ReadonlySet<string>;
  destructiveSubstrings: readonly string[];
}

export const DEFAULT_POLICY: PolicyConfig = {
  readOnlyTools: READ_ONLY_TOOLS,
  outboundTools: OUTBOUND_TOOLS,
  safeBash: SAFE_BASH,
  destructiveBins: DESTRUCTIVE_BINS,
  destructiveSubstrings: DESTRUCTIVE_SUBSTRINGS,
};
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/server && npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/permission/defaults.ts
git commit -m "feat(permission): add auditable default tool/command lists"
```

---

## Task 3: Permission Policy — write the attack-matrix tests FIRST

**Files:**
- Create: `apps/server/src/permission/policy.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/permission/policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyTool } from "./policy.js";

const bash = (command: string) => ({ tool: "Bash", input: { command } });

describe("classifyTool — read tools auto", () => {
  it("Read is auto", () => {
    expect(classifyTool({ tool: "Read", input: { file_path: "/x" } }).tier).toBe("auto");
  });
  it("Grep is auto", () => {
    expect(classifyTool({ tool: "Grep", input: { pattern: "x" } }).tier).toBe("auto");
  });
});

describe("classifyTool — outbound is never auto (exfiltration)", () => {
  it("WebFetch requires approval", () => {
    expect(classifyTool({ tool: "WebFetch", input: { url: "http://x" } }).tier).toBe("approve");
  });
  it("WebSearch requires approval", () => {
    expect(classifyTool({ tool: "WebSearch", input: { query: "x" } }).tier).toBe("approve");
  });
});

describe("classifyTool — mutating tools require approval", () => {
  it("Edit is approve", () => {
    expect(classifyTool({ tool: "Edit", input: { file_path: "/x" } }).tier).toBe("approve");
  });
  it("Write is approve", () => {
    expect(classifyTool({ tool: "Write", input: { file_path: "/x" } }).tier).toBe("approve");
  });
  it("unknown tool defaults to approve (safe default)", () => {
    expect(classifyTool({ tool: "SomeNewTool", input: {} }).tier).toBe("approve");
  });
});

describe("classifyTool — Bash safe commands are auto", () => {
  for (const cmd of ["df -h", "free -m", "uptime", "systemctl status forgejo",
                     "journalctl -u forgejo -n 40", "docker ps", "git status"]) {
    it(`auto: ${cmd}`, () => {
      expect(classifyTool(bash(cmd)).tier).toBe("auto");
    });
  }
});

describe("classifyTool — Bash mutating commands require approval", () => {
  for (const cmd of ["systemctl restart forgejo", "docker compose up -d",
                     "mv a b", "git push", "npm install"]) {
    it(`approve: ${cmd}`, () => {
      const d = classifyTool(bash(cmd));
      expect(d.tier).toBe("approve");
      expect(d.literal).toBe(cmd);
    });
  }
});

describe("classifyTool — destructive Bash is denied (prompt-injection backstop)", () => {
  for (const cmd of ["rm -rf /", "rm -rf ~/data", "sudo systemctl restart x",
                     "dd if=/dev/zero of=/dev/sda", "mkfs.ext4 /dev/sdb",
                     "echo hi && rm -rf /tmp/x", ":(){:|:&};:"]) {
    it(`deny: ${cmd}`, () => {
      expect(classifyTool(bash(cmd)).tier).toBe("deny");
    });
  }
});

describe("classifyTool — Bash parsing robustness", () => {
  it("a safe binary with a chained destructive command is NOT auto", () => {
    // df is safe, but the chained rm makes the whole command unsafe → deny
    expect(classifyTool(bash("df -h ; rm -rf /")).tier).toBe("deny");
  });
  it("empty command is approve (cannot prove safe)", () => {
    expect(classifyTool(bash("")).tier).toBe("approve");
  });
  it("unparseable command is approve (cannot prove safe)", () => {
    expect(classifyTool(bash('echo "unterminated')).tier).toBe("approve");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/permission/policy.test.ts`
Expected: FAIL — `classifyTool` does not exist / module not found.

- [ ] **Step 3: Commit the tests**

```bash
git add apps/server/src/permission/policy.test.ts
git commit -m "test(permission): attack matrix for the tool classifier"
```

---

## Task 4: Permission Policy — implement classifyTool

**Files:**
- Create: `apps/server/src/permission/policy.ts`

- [ ] **Step 1: Implement the classifier**

Create `apps/server/src/permission/policy.ts`:

```ts
import { split } from "shlex";
import type { PermissionDecision, ToolRequest } from "../types.js";
import { DEFAULT_POLICY, type PolicyConfig } from "./defaults.js";

const deny = (reason: string): PermissionDecision => ({ tier: "deny", reason });
const auto = (reason: string): PermissionDecision => ({ tier: "auto", reason });
const approve = (reason: string, literal?: string): PermissionDecision => ({
  tier: "approve",
  reason,
  ...(literal === undefined ? {} : { literal }),
});

/**
 * Classify a tool-use request into a permission tier.
 * Pure function — no I/O. This is the security gate (spec §8): nothing that
 * mutates state is auto, and nothing auto can exfiltrate or mutate.
 */
export function classifyTool(
  req: ToolRequest,
  config: PolicyConfig = DEFAULT_POLICY,
): PermissionDecision {
  if (config.outboundTools.has(req.tool)) {
    return approve("outbound tool — never auto (exfiltration risk)");
  }
  if (config.readOnlyTools.has(req.tool)) {
    return auto("read-only tool");
  }
  if (req.tool === "Bash") {
    return classifyBash(String(req.input.command ?? ""), config);
  }
  return approve("mutating or unknown tool — requires approval");
}

function classifyBash(command: string, config: PolicyConfig): PermissionDecision {
  const trimmed = command.trim();
  if (trimmed === "") return approve("empty command", command);

  // 1. Destructive substring check on the raw command (catches chained/hidden).
  const lower = trimmed.toLowerCase();
  for (const sub of config.destructiveSubstrings) {
    if (lower.includes(sub)) return deny(`destructive pattern: ${sub}`);
  }

  // 2. Tokenize. If we cannot parse it, we cannot prove it safe.
  let tokens: string[];
  try {
    tokens = split(trimmed);
  } catch {
    return approve("unparseable command — cannot prove safe", command);
  }
  if (tokens.length === 0) return approve("empty command", command);

  // 3. Any chaining/redirection means we cannot reason about the whole line
  //    from argv alone — fall back to approval (unless already denied above).
  const CHAINERS = new Set(["&&", "||", ";", "|", "&", ">", ">>", "<"]);
  const hasChain = tokens.some((t) => CHAINERS.has(t)) ||
    /[;|&><]/.test(trimmed) && !isSingleSafe(tokens, config);

  // 4. Destructive binary as argv[0].
  const bin = tokens[0] ?? "";
  if (config.destructiveBins.has(bin)) return deny(`destructive binary: ${bin}`);

  // 5. Safe single command?
  if (!hasChain && isSingleSafe(tokens, config)) return auto(`safe command: ${bin}`);

  return approve("command not on safe allowlist — requires approval", command);
}

/** True if argv[0] (or "argv0 argv1") is on the safe allowlist. */
function isSingleSafe(tokens: string[], config: PolicyConfig): boolean {
  const one = tokens[0] ?? "";
  const two = tokens.length >= 2 ? `${tokens[0]} ${tokens[1]}` : "";
  return config.safeBash.has(two) || config.safeBash.has(one);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/permission/policy.test.ts`
Expected: PASS — all attack-matrix cases green.

> If `df -h ; rm -rf /` does not return `deny`, confirm the destructive substring check runs on the raw command before tokenization (it does in step 1) — `rm -rf` is matched as a substring.

- [ ] **Step 3: Typecheck**

Run: `cd apps/server && npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/permission/policy.ts
git commit -m "feat(permission): implement classifyTool security gate"
```

---

## Task 5: BrainAdapter interface

**Files:**
- Create: `apps/server/src/brain/adapter.ts`

- [ ] **Step 1: Define the interface and event types**

Create `apps/server/src/brain/adapter.ts`:

```ts
import type { PermissionDecision, ToolRequest } from "../types.js";

/** Events streamed from the brain to the host (provider-neutral). */
export type BrainEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; request: ToolRequest }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  | { type: "result"; ok: boolean; costUsd?: number }
  | { type: "error"; message: string };

/** Decision returned to the brain for a pending tool use. */
export interface PermissionResponse {
  allow: boolean;
  /** Optional message shown to the brain when denied. */
  message?: string;
}

/**
 * Callback the host registers to decide on a tool use. Async: it may await a
 * human pressing a button in the browser. Mirrors the Agent SDK `canUseTool`.
 */
export type PermissionHandler = (
  request: ToolRequest,
  toolUseId: string,
) => Promise<PermissionResponse>;

/**
 * The seam between Tormod and any "brain" (Claude Code today; Codex/local
 * later). Implementations live behind this interface so nothing above it is
 * provider-specific (spec §5).
 */
export interface BrainAdapter {
  /** Start a fresh session; resolves with the session id. */
  startSession(opts: { cwd?: string }): Promise<string>;
  /** Resume an existing session by id. */
  resumeSession(id: string): Promise<void>;
  /** Send a user message into a live session. */
  sendMessage(id: string, text: string): Promise<void>;
  /** Tear down the live process for a session (transcript persists). */
  close(id: string): Promise<void>;
  /** Register the stream handler for brain events. */
  onEvent(handler: (sessionId: string, event: BrainEvent) => void): void;
  /** Register the permission handler (the approval-card bridge). */
  onPermissionRequest(handler: PermissionHandler): void;
}

/** Re-export for convenience. */
export type { PermissionDecision, ToolRequest };
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/server && npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/brain/adapter.ts
git commit -m "feat(brain): define provider-neutral BrainAdapter interface"
```

---

## Task 6: FakeBrainAdapter — tests first

**Files:**
- Create: `apps/server/src/brain/fake.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/brain/fake.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FakeBrainAdapter } from "./fake.js";
import type { BrainEvent } from "./adapter.js";

describe("FakeBrainAdapter", () => {
  it("startSession returns an id and emits a result on a scripted turn", async () => {
    const fake = new FakeBrainAdapter();
    const events: Array<{ s: string; e: BrainEvent }> = [];
    fake.onEvent((s, e) => events.push({ s, e }));

    const id = await fake.startSession({});
    expect(id).toMatch(/.+/);

    fake.script([{ type: "text", text: "hello" }, { type: "result", ok: true }]);
    await fake.sendMessage(id, "hi");

    expect(events.map((x) => x.e.type)).toEqual(["text", "result"]);
    expect(events.every((x) => x.s === id)).toBe(true);
  });

  it("a scripted tool_use invokes the permission handler and respects allow", async () => {
    const fake = new FakeBrainAdapter();
    const calls: string[] = [];
    fake.onPermissionRequest(async (req) => {
      calls.push(req.tool);
      return { allow: true };
    });
    const results: boolean[] = [];
    fake.onEvent((_s, e) => {
      if (e.type === "tool_result") results.push(e.ok);
    });

    const id = await fake.startSession({});
    fake.script([
      { type: "tool_use", id: "t1", request: { tool: "Edit", input: { file_path: "/x" } } },
    ]);
    await fake.sendMessage(id, "edit it");

    expect(calls).toEqual(["Edit"]);
    expect(results).toEqual([true]);
  });

  it("denied permission yields a failed tool_result", async () => {
    const fake = new FakeBrainAdapter();
    fake.onPermissionRequest(async () => ({ allow: false, message: "nope" }));
    const results: boolean[] = [];
    fake.onEvent((_s, e) => {
      if (e.type === "tool_result") results.push(e.ok);
    });

    const id = await fake.startSession({});
    fake.script([
      { type: "tool_use", id: "t1", request: { tool: "Bash", input: { command: "rm -rf /" } } },
    ]);
    await fake.sendMessage(id, "go");

    expect(results).toEqual([false]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/brain/fake.test.ts`
Expected: FAIL — `FakeBrainAdapter` not found.

- [ ] **Step 3: Commit the tests**

```bash
git add apps/server/src/brain/fake.test.ts
git commit -m "test(brain): contract tests for FakeBrainAdapter"
```

---

## Task 7: FakeBrainAdapter — implementation

**Files:**
- Create: `apps/server/src/brain/fake.ts`

- [ ] **Step 1: Implement the fake**

Create `apps/server/src/brain/fake.ts`:

```ts
import type {
  BrainAdapter,
  BrainEvent,
  PermissionHandler,
} from "./adapter.js";

/**
 * A scriptable BrainAdapter for tests. No LLM. `script()` queues the events a
 * subsequent sendMessage() will replay. tool_use events are routed through the
 * permission handler; the result (allow/deny) becomes a tool_result.
 */
export class FakeBrainAdapter implements BrainAdapter {
  private eventHandler: ((sessionId: string, event: BrainEvent) => void) | null = null;
  private permissionHandler: PermissionHandler | null = null;
  private queued: BrainEvent[] = [];
  private counter = 0;
  private readonly live = new Set<string>();

  async startSession(_opts: { cwd?: string }): Promise<string> {
    const id = `fake-${++this.counter}`;
    this.live.add(id);
    return id;
  }

  async resumeSession(id: string): Promise<void> {
    this.live.add(id);
  }

  async close(id: string): Promise<void> {
    this.live.delete(id);
  }

  onEvent(handler: (sessionId: string, event: BrainEvent) => void): void {
    this.eventHandler = handler;
  }

  onPermissionRequest(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  /** Queue the events the next sendMessage() will replay. */
  script(events: BrainEvent[]): void {
    this.queued = [...events];
  }

  async sendMessage(id: string, _text: string): Promise<void> {
    const events = this.queued;
    this.queued = [];
    for (const event of events) {
      if (event.type === "tool_use") {
        const resp = this.permissionHandler
          ? await this.permissionHandler(event.request, event.id)
          : { allow: false, message: "no handler" };
        this.emit(id, event);
        this.emit(id, {
          type: "tool_result",
          id: event.id,
          ok: resp.allow,
          summary: resp.allow ? "executed" : (resp.message ?? "denied"),
        });
      } else {
        this.emit(id, event);
      }
    }
  }

  private emit(id: string, event: BrainEvent): void {
    this.eventHandler?.(id, event);
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/server && npx vitest run src/brain/fake.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `cd apps/server && npm test && npm run typecheck`
Expected: all tests pass; tsc exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/brain/fake.ts
git commit -m "feat(brain): implement scriptable FakeBrainAdapter"
```

---

## Self-Review

- **Spec coverage:** §5 BrainAdapter (Task 5) + FakeBrainAdapter for LLM-free tests (Tasks 6–7) ✓. §8/§9 security tiers via the Permission Policy (Tasks 2–4) ✓. The HTTP/SSE server, Session Manager, audit, auth, ClaudeCodeAdapter, and front are explicitly deferred to Plans 2–5 (stated above). No gap within this plan's scope.
- **Placeholder scan:** none — every code step contains full content.
- **Type consistency:** `ToolRequest`/`PermissionDecision`/`Tier` defined in `types.ts` (Task 1) and used unchanged in `policy.ts` (Task 4) and `adapter.ts` (Task 5). `BrainEvent`/`PermissionHandler`/`PermissionResponse` defined in `adapter.ts` (Task 5) and used unchanged in `fake.ts`/`fake.test.ts` (Tasks 6–7). `classifyTool(req, config?)` signature consistent between test (Task 3) and impl (Task 4).

---

## Notes for execution

- The repo currently still contains the obsolete Go skeleton (`go.mod`, `inventory.example.yaml`) and is named `huginn` on disk/remote. Cleaning those up and the GitHub rename to `tormod` are out of scope here (outward-facing; needs explicit go-ahead) — leave them untouched.
- Work happens under `apps/server/` so it does not collide with the existing files.

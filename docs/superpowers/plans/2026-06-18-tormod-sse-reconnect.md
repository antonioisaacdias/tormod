# SSE Reconnection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both Tormod SSE streams reconnect automatically after a network drop and resync durable state, so no approval card is lost and the user sees a subtle "reconnecting" indicator.

**Architecture:** A client-side reconnectable wrapper (`lib/sse.ts`) wraps the fetch-reader loop with exponential backoff, a dead-connection watchdog driven by the server's 15s ping, and `online`/`visibilitychange` wake triggers. On every reconnect, consumers resync durable state (history reseed for sessions, list refetch for the global channel); the server already replays pending approvals to new subscribers, so the server protocol is unchanged.

**Tech Stack:** TypeScript, React 19, Vite 8, Vitest 4 (already configured in `apps/web`, `npm test`). No backend changes.

Spec: `docs/superpowers/specs/2026-06-18-tormod-sse-reconnect-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `apps/web/src/lib/sse.ts` | Reconnectable SSE wrapper (`connectSSE`), backoff, watchdog, wake triggers, `UnauthorizedError` | Create |
| `apps/web/src/lib/sse.test.ts` | Unit tests for `connectSSE` (fake timers + mocked fetch) | Create |
| `apps/web/src/lib/api.ts` | `streamSession`/`streamAll` delegate to `connectSSE`; re-export `UnauthorizedError` | Modify |
| `apps/web/src/lib/foldEvents.test.ts` | Idempotency test: replayed `permission_request` after history seed | Modify |
| `apps/web/src/hooks/useSessionThreads.ts` | Resync on reconnect (history reseed) + per-session `connection` state | Modify |
| `apps/web/src/hooks/useSessions.ts` | Refetch session list on global-stream reconnect | Modify |
| `apps/web/src/components/chat/ConnectionPill.tsx` | Subtle "reconectando…" pill | Create |
| `apps/web/src/components/chat/ChatView.tsx` | Render the pill from a `connection` prop | Modify |
| `apps/web/src/app/App.tsx` | Pass `runtime.connection` into `ChatView` | Modify |

**Working directory for all commands:** `apps/web`. Run tests with `npm test -- <file>` (vitest). Type-check with `npm run build` (runs `tsc -b`).

---

## Task 1: `connectSSE` wrapper with backoff, watchdog, wake triggers

**Files:**
- Create: `apps/web/src/lib/sse.ts`
- Create: `apps/web/src/lib/sse.test.ts`

This is the core. `connectSSE` opens an SSE stream via `apiFetch`, parses frames, and on disconnect reconnects with backoff until the caller's `AbortSignal` aborts or the server returns 401. A watchdog forces reconnect if no bytes arrive for `STALE_MS` (the server pings every 15s, so 35s of silence means a dead socket). `online` and `visibilitychange→visible` cut the backoff wait short.

- [ ] **Step 1: Write `apps/web/src/lib/sse.ts`**

```ts
import { apiFetch } from './platform'

export type ConnectionStatus = 'open' | 'reconnecting'

export interface StreamOpts<T> {
  onEvent: (event: T) => void
  onStatus?: (status: ConnectionStatus) => void
  onReconnect?: () => void
  signal: AbortSignal
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export const STALE_MS = 35_000
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 20000]

function backoff(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
}

// Resolves after `ms`, or earlier if the signal aborts or the network/tab wakes.
function waitWithWake(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      window.removeEventListener('online', finish)
      document.removeEventListener('visibilitychange', onVisible)
      resolve()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') finish()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    window.addEventListener('online', finish)
    document.addEventListener('visibilitychange', onVisible)
  })
}

// One connection attempt. Resolves when the stream ends (server closed / `done`);
// rejects on network error, watchdog timeout, or UnauthorizedError.
async function readOnce<T>(path: string, opts: StreamOpts<T>, onOpen: () => void): Promise<void> {
  const ctrl = new AbortController()
  const propagateAbort = () => ctrl.abort()
  opts.signal.addEventListener('abort', propagateAbort, { once: true })
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => ctrl.abort(), STALE_MS)
  }
  try {
    const res = await apiFetch(path, { signal: ctrl.signal })
    if (res.status === 401) throw new UnauthorizedError()
    if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`)
    onOpen()
    armWatchdog()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      armWatchdog()
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const dataLine = frame.split('\n').find((line) => line.startsWith('data:'))
        if (!dataLine) continue
        const payload = dataLine.slice(5).trim()
        if (!payload) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          opts.onEvent(parsed as T)
        }
      }
    }
  } finally {
    if (watchdog) clearTimeout(watchdog)
    opts.signal.removeEventListener('abort', propagateAbort)
  }
}

// Keeps an SSE stream open across reconnects. Stops only on external abort or 401.
export async function connectSSE<T>(path: string, opts: StreamOpts<T>): Promise<void> {
  let attempt = 0
  let everConnected = false
  while (!opts.signal.aborted) {
    try {
      await readOnce(path, opts, () => {
        attempt = 0
        if (everConnected) opts.onReconnect?.()
        everConnected = true
        opts.onStatus?.('open')
      })
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err
      if (opts.signal.aborted) return
    }
    if (opts.signal.aborted) return
    opts.onStatus?.('reconnecting')
    await waitWithWake(backoff(attempt), opts.signal)
    attempt += 1
  }
}
```

- [ ] **Step 2: Write `apps/web/src/lib/sse.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectSSE, STALE_MS, UnauthorizedError } from './sse'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('./platform', () => ({ apiFetch }))

// Builds a Response whose body streams the given chunks, then optionally stays open.
function streamResponse(chunks: string[], opts: { keepOpen?: boolean } = {}) {
  const enc = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]))
      } else if (!opts.keepOpen) {
        controller.close()
      }
    },
  })
  return new Response(body, { status: 200 })
}

beforeEach(() => {
  vi.useFakeTimers()
  apiFetch.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('connectSSE', () => {
  it('parses data frames and emits typed events', async () => {
    apiFetch.mockResolvedValueOnce(streamResponse(['event: text\ndata: {"type":"text","text":"hi"}\n\n']))
    const events: unknown[] = []
    const ctrl = new AbortController()
    const run = connectSSE('/p', { onEvent: (e) => events.push(e), signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(0)
    ctrl.abort()
    await run
    expect(events).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('stops immediately and throws on 401', async () => {
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
    const ctrl = new AbortController()
    await expect(connectSSE('/p', { onEvent: () => {}, signal: ctrl.signal })).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('reconnects after the stream ends and calls onReconnect on the 2nd open', async () => {
    apiFetch
      .mockResolvedValueOnce(streamResponse(['data: {"type":"a"}\n\n'])) // ends -> reconnect
      .mockResolvedValue(streamResponse([], { keepOpen: true }))
    const statuses: string[] = []
    let reconnects = 0
    const ctrl = new AbortController()
    const run = connectSSE('/p', {
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      onReconnect: () => (reconnects += 1),
      signal: ctrl.signal,
    })
    await vi.advanceTimersByTimeAsync(0) // first connection, then it ends
    expect(statuses).toContain('reconnecting')
    await vi.advanceTimersByTimeAsync(1000) // backoff[0]
    await vi.advanceTimersByTimeAsync(0)
    expect(reconnects).toBe(1)
    ctrl.abort()
    await run
  })

  it('forces a reconnect when no bytes arrive within STALE_MS', async () => {
    apiFetch
      .mockResolvedValueOnce(streamResponse([], { keepOpen: true })) // silent -> watchdog fires
      .mockResolvedValue(streamResponse([], { keepOpen: true }))
    const ctrl = new AbortController()
    const run = connectSSE('/p', { onEvent: () => {}, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(0)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(STALE_MS) // watchdog aborts the reader
    await vi.advanceTimersByTimeAsync(1000) // backoff
    await vi.advanceTimersByTimeAsync(0)
    expect(apiFetch).toHaveBeenCalledTimes(2)
    ctrl.abort()
    await run
  })

  it('does not reconnect after external abort', async () => {
    apiFetch.mockResolvedValueOnce(streamResponse([], { keepOpen: true }))
    const ctrl = new AbortController()
    const run = connectSSE('/p', { onEvent: () => {}, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(0)
    ctrl.abort()
    await run
    await vi.advanceTimersByTimeAsync(60_000)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- src/lib/sse.test.ts`
Expected: 5 passing. If the watchdog test hangs, confirm `streamResponse({keepOpen:true})` never closes and that `armWatchdog` uses `setTimeout` (faked).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/sse.ts apps/web/src/lib/sse.test.ts
git commit -m "feat(web): add reconnectable SSE wrapper with backoff and watchdog"
```

---

## Task 2: Delegate `streamSession`/`streamAll` to `connectSSE`

**Files:**
- Modify: `apps/web/src/lib/api.ts`

`api.ts` currently owns `readSSE` and `UnauthorizedError`. Move the streaming guts to `sse.ts` (Task 1) and re-export `UnauthorizedError` so the ~6 existing `import { UnauthorizedError } from '@/lib/api'` sites keep working. The new stream functions take an options object.

- [ ] **Step 1: Edit `apps/web/src/lib/api.ts`**

Replace the `UnauthorizedError` class declaration (lines 16-21) with a re-export, and replace `streamSession`/`streamAll`/`readSSE` (lines 82-122) with delegations. At the top, add the import.

Top of file — add after the existing imports:
```ts
import { connectSSE, type StreamOpts } from './sse'
```

Replace the `UnauthorizedError` class (lines 16-21) with:
```ts
export { UnauthorizedError } from './sse'
```

Replace `streamSession`, `streamAll`, and the whole `readSSE` function (lines 82-122) with:
```ts
export function streamSession(id: string, opts: StreamOpts<ServerEvent>): Promise<void> {
  return connectSSE(`/api/sessions/${id}/stream`, opts)
}

export function streamAll(opts: StreamOpts<GlobalEvent>): Promise<void> {
  return connectSSE('/api/stream', opts)
}
```

`expectOk` (line 10-14) still references `UnauthorizedError` — now it comes from the re-export's import binding. Add to the top imports:
```ts
import { UnauthorizedError } from './sse'
```
(Keep the `export { UnauthorizedError } from './sse'` line too — one imports for local use, one re-exports for consumers.)

- [ ] **Step 2: Run the existing api tests**

Run: `npm test -- src/lib/api.test.ts`
Expected: the suite still passes. If `api.test.ts` mocked the old `readSSE` internals, update it to mock `./sse`'s `connectSSE` instead (assert `connectSSE` called with the right path + that `opts.onEvent` is forwarded). Show failures before editing.

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: no new `tsc` errors from `api.ts`. Call sites of `streamSession`/`streamAll` (in the hooks) will now fail to type-check — that is expected and fixed in Tasks 4-5. If `npm run build` blocks on those, skip to Task 4/5 and type-check at the end of Task 5.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts
git commit -m "refactor(web): route SSE streams through connectSSE"
```

---

## Task 3: Prove `foldEvents` idempotency for a replayed approval

**Files:**
- Modify: `apps/web/src/lib/foldEvents.test.ts`

On reconnect we reseed the thread from history, then the server replays the pending `permission_request`. The seeded thread shows the tool as an executed entry inside a `work` balloon; the replayed event must (a) strip that entry from the balloon and (b) produce exactly one `approval` card — never a duplicate. `foldEvent`'s `permission_request` case already strips work entries and replaces an existing top-level item; this test locks that behavior in.

- [ ] **Step 1: Add the test to `apps/web/src/lib/foldEvents.test.ts`**

```ts
import { foldEvent, seedThread } from './foldEvents'
import type { HistoryItem } from './serverTypes'

it('replaying a permission_request after a history seed yields one approval card', () => {
  const history: HistoryItem[] = [
    { kind: 'tool', id: 'tool-1', name: 'Write', input: { file_path: '/tmp/x', content: 'hi' } },
  ]
  const seeded = seedThread(history)

  const afterReplay = foldEvent(seeded, {
    type: 'permission_request',
    toolUseId: 'tool-1',
    name: 'Write',
    input: { file_path: '/tmp/x', content: 'hi' },
    tier: 'approve',
  })

  const approvals = afterReplay.items.filter((i) => i.kind === 'approval')
  expect(approvals).toHaveLength(1)
  expect(approvals[0].id).toBe('tool-1')

  // The tool must not remain inside any still-open work balloon.
  const leakedToolEntry = afterReplay.items
    .filter((i) => i.kind === 'work')
    .some((w) => w.entries.some((e) => e.type === 'tool' && e.id === 'tool-1'))
  expect(leakedToolEntry).toBe(false)
})
```

> Before running: open `apps/web/src/lib/serverTypes.ts` and `apps/web/src/types/thread.ts` and confirm the exact field names for `HistoryItem` of kind `tool` (`id`/`name`/`input`) and the `permission_request` event (`toolUseId`/`name`/`input`/`tier`). Adjust the literals in the test to match the real types — do not invent fields.

- [ ] **Step 2: Run the test**

Run: `npm test -- src/lib/foldEvents.test.ts`
Expected: PASS. If it fails with a duplicate approval, fix `foldEvent`'s `permission_request` case in `foldEvents.ts` so that when an item with `id === event.toolUseId` already exists it is replaced (mapped) rather than appended, and the matching tool entry is filtered out of every `work` item. Re-run until green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/foldEvents.test.ts apps/web/src/lib/foldEvents.ts
git commit -m "test(web): lock approval idempotency on reconnect reseed"
```

---

## Task 4: Resync + connection state in `useSessionThreads`

**Files:**
- Modify: `apps/web/src/hooks/useSessionThreads.ts`

Add a per-session `connection` field, feed it from the stream's `onStatus`, and on every reconnect reseed history (recovering turns that completed during the outage) and clear the stale `working` flag. Factor the history load so it runs both on first connect and on reconnect.

- [ ] **Step 1: Extend `SessionRuntime` and `EMPTY_RUNTIME`**

In `useSessionThreads.ts`, change the interface (around line 8) and default (line 14):
```ts
import type { ConnectionStatus } from '@/lib/api'

export interface SessionRuntime {
  thread: ThreadState
  usage: SessionUsage
  working: boolean
  connection: ConnectionStatus
}

const EMPTY_RUNTIME: SessionRuntime = {
  thread: emptyThread,
  usage: INITIAL_USAGE,
  working: false,
  connection: 'open',
}
```

Add the `ConnectionStatus` re-export to `api.ts` if not already exported — in `api.ts` add:
```ts
export type { ConnectionStatus, StreamOpts } from './sse'
```

- [ ] **Step 2: Rewrite the body of `ensure` (lines 32-70)**

Replace the `void (async () => { ... })()` block so the stream uses the options object, and extract a `loadHistory` helper used on first connect and on reconnect:
```ts
      const ctrl = new AbortController()
      ctrls.current.set(id, ctrl)

      const loadHistory = async () => {
        try {
          const history = await getHistory(id)
          if (ctrl.signal.aborted) return
          if (history.length > 0) update(id, (r) => ({ ...r, thread: seedThread(history) }))
        } catch (err) {
          if (!ctrl.signal.aborted) console.error('getHistory', err)
        }
      }

      void (async () => {
        await loadHistory()
        if (ctrl.signal.aborted) return
        void streamSession(id, {
          onEvent: (event) => {
            if (event.type === 'usage') {
              update(id, (r) => ({ ...r, usage: mergeUsage(r.usage, event) }))
              return
            }
            update(id, (r) => ({
              ...r,
              thread: foldEvent(r.thread, event),
              working: event.type === 'result' || event.type === 'error' ? false : r.working,
            }))
          },
          onStatus: (connection) => update(id, (r) => ({ ...r, connection })),
          onReconnect: () => {
            // Resync: clear the possibly-stale working flag, reseed durable state.
            // The reopened stream replays any pending approval (server-side).
            update(id, (r) => ({ ...r, working: false }))
            void loadHistory()
          },
          signal: ctrl.signal,
        }).catch((err) => {
          if (!ctrl.signal.aborted) console.error('streamSession', err)
        })
      })()
```

> Note: `onStatus('open')` fires on every successful connect (first included); `onReconnect` fires only from the 2nd open onward (per Task 1). So `connection` returns to `'open'` automatically when a reconnect succeeds.

- [ ] **Step 3: Update the hook test**

Open `apps/web/src/hooks/useSessionThreads.test.ts`. Its mock of `@/lib/api` `streamSession` is now called with `(id, opts)` instead of `(id, onEvent, signal)`. Update the mock to read `opts.onEvent`/`opts.signal`, and add an assertion that a `SessionRuntime` starts with `connection: 'open'`.

Run: `npm test -- src/hooks/useSessionThreads.test.ts`
Expected: PASS after the mock update. Show the pre-edit failure first.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useSessionThreads.ts apps/web/src/hooks/useSessionThreads.test.ts apps/web/src/lib/api.ts
git commit -m "feat(web): resync session thread and track connection on reconnect"
```

---

## Task 5: Refetch the session list on global-stream reconnect

**Files:**
- Modify: `apps/web/src/hooks/useSessions.ts`

The global channel carries ephemeral `session_status`. On reconnect, refetch the list so card statuses reconcile (covering status events missed during the outage).

- [ ] **Step 1: Edit the `streamAll` effect (lines 31-44)**

```ts
  // Live status from the global channel — keeps every sidebar card current.
  useEffect(() => {
    const ctrl = new AbortController()
    void streamAll({
      onEvent: (event) => {
        if (event.type !== 'session_status') return
        setSessions((current) =>
          current.map((s) =>
            s.id === event.id ? { ...s, status: event.status, live: event.status !== 'closed' } : s,
          ),
        )
      },
      onReconnect: () => void refresh(),
      signal: ctrl.signal,
    }).catch((err) => {
      if (!ctrl.signal.aborted) console.error('streamAll', err)
    })
    return () => ctrl.abort()
  }, [refresh])
```

> `refresh` is the existing `useCallback` (line 12). Adding it to the dep array is safe — it is stable.

- [ ] **Step 2: Run the hook test + type-check**

Run: `npm test -- src/hooks/useSessions.test.ts`
Expected: PASS after updating the `streamAll` mock to the `(opts)` shape (read `opts.onEvent`). Show the failure first.

Run: `npm run build`
Expected: no `tsc` errors anywhere now (Task 2's deferred call-site errors are resolved).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useSessions.ts apps/web/src/hooks/useSessions.test.ts
git commit -m "feat(web): refetch sessions when the global stream reconnects"
```

---

## Task 6: Subtle "reconnecting" pill in the chat

**Files:**
- Create: `apps/web/src/components/chat/ConnectionPill.tsx`
- Modify: `apps/web/src/components/chat/ChatView.tsx`
- Modify: `apps/web/src/app/App.tsx`

- [ ] **Step 1: Create `apps/web/src/components/chat/ConnectionPill.tsx`**

```tsx
import { Loader2 } from 'lucide-react'
import type { ConnectionStatus } from '@/lib/api'

interface ConnectionPillProps {
  connection: ConnectionStatus
}

export function ConnectionPill({ connection }: ConnectionPillProps) {
  if (connection === 'open') return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-ink px-2 py-0.5 text-[11px] font-medium text-faint">
      <Loader2 className="size-3 animate-spin" />
      reconectando…
    </span>
  )
}
```

- [ ] **Step 2: Wire it into `ChatView.tsx`**

Add to `ChatViewProps` (after `working: boolean`, line 22):
```ts
  connection: ConnectionStatus
```
Add the import near the other `@/lib` imports:
```ts
import type { ConnectionStatus } from '@/lib/api'
import { ConnectionPill } from './ConnectionPill'
```
Destructure `connection` in the component params (after `working,`). Render the pill in the bottom bar next to `StatusLine` — replace the `<StatusLine usage={usage} />` line (line 110) with:
```tsx
        <div className="flex items-center justify-between gap-2">
          <StatusLine usage={usage} />
          <ConnectionPill connection={connection} />
        </div>
```

- [ ] **Step 3: Pass it from `App.tsx`**

In `apps/web/src/app/App.tsx`, the `<ChatView>` (around line 116) already spreads `runtime.*`. Add the prop next to `working={runtime.working}`:
```tsx
            connection={runtime.connection}
```

- [ ] **Step 4: Render test for the pill**

Create `apps/web/src/components/chat/ConnectionPill.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConnectionPill } from './ConnectionPill'

describe('ConnectionPill', () => {
  it('shows nothing when online', () => {
    const { container } = render(<ConnectionPill connection="open" />)
    expect(container).toBeEmptyDOMElement()
  })
  it('shows reconnecting when not online', () => {
    render(<ConnectionPill connection="reconnecting" />)
    expect(screen.getByText('reconectando…')).toBeInTheDocument()
  })
})
```

Run: `npm test -- src/components/chat/ConnectionPill.test.tsx`
Expected: 2 passing.

- [ ] **Step 5: Type-check + full test run + commit**

Run: `npm run build && npm test`
Expected: clean build, all suites green.

```bash
git add apps/web/src/components/chat/ConnectionPill.tsx apps/web/src/components/chat/ConnectionPill.test.tsx apps/web/src/components/chat/ChatView.tsx apps/web/src/app/App.tsx
git commit -m "feat(web): show a subtle reconnecting indicator in the chat"
```

---

## Task 7: Manual e2e over an unstable link

**Files:** none (acceptance).

- [ ] **Step 1: Run the stack**

Server (from `apps/server`, built): `TORMOD_BRAIN=claude TORMOD_CWD=/home/odin TORMOD_COOKIE_SECURE=false node dist/server.js`. Web: `npm run dev` in `apps/web` (proxies `/api` → `127.0.0.1:8790`).

- [ ] **Step 2: Acceptance checklist**

1. Open a session, send "conte de 1 a 20 devagar"; while it streams, **kill the network** (stop the server process OR drop the wg/proxy).
2. The chat shows the **"reconectando…"** pill within ~35s (watchdog) or immediately on a clean stream end.
3. **Restore** the network. The pill disappears; the thread resyncs (no duplicate messages; the completed turn appears once).
4. Trigger an approval (ask for a Write), and **drop the link while the card is pending**. On reconnect, the **approval card reappears** — approve it and confirm the file is written.
5. Background the tab/app for >1 min, then return → reconnects on `visibilitychange` without a manual reload.

Expected: every step holds. Document the result in the plan/commit.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch. This work lives on `feat/mobile-capacitor`'s descendant or a fresh `feat/sse-reconnect` off `develop` — confirm the branch with the user before merging. Bump `apps/web` + `apps/server` `package.json` to `0.7.0` if cutting the milestone.

---

## Self-Review

**Spec coverage:**
- Reconnect triggers (end/error, watchdog, online/visibility) → Task 1. ✓
- Backoff 1→2→4→8→16→20 cap, reset on connect → Task 1 (`BACKOFF_MS`, `attempt = 0`). ✓
- Stop on abort/401, reconnect otherwise → Task 1 + tests. ✓
- `connectSSE` extracted to `lib/sse.ts`, `api.ts` delegates → Tasks 1-2. ✓
- Resync = history reseed on reconnect → Task 4 (`loadHistory` in `onReconnect`). ✓
- Pending approval survives → server already replays (no task) + idempotency locked in Task 3. ✓
- Global stream resync = list refetch → Task 5. ✓
- Subtle pill, composer stays usable → Task 6 (pill only; composer untouched). ✓
- No server change → confirmed (no backend task). ✓
- Tests: backoff/watchdog/triggers/stop (Task 1), idempotency (Task 3), pill (Task 6), manual e2e (Task 7). ✓

**Placeholder scan:** No TBD/TODO; every code step shows code. The two "confirm exact field names" notes (Task 3, Task 2 test) are verification guards against inventing types, not deferred work.

**Type consistency:** `ConnectionStatus` defined in `sse.ts` (Task 1), re-exported from `api.ts` (Task 4 Step 1), consumed in `useSessionThreads` (Task 4), `ConnectionPill`/`ChatView` (Task 6) — same name throughout. `StreamOpts<T>` defined in Task 1, used in Tasks 2/4/5. `streamSession(id, opts)` / `streamAll(opts)` signatures consistent across Tasks 2, 4, 5.

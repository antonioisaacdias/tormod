# Mobile MVP — Plano 2: Frontend (platform seam + server-address screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the React app run as both the same-origin web app (cookie auth, unchanged) and a decoupled native client (configured server URL + Bearer token), selected at runtime by platform.

**Architecture:** A pure request builder (`lib/request.ts`) computes the URL, auth headers and credentials from a platform context. A thin `lib/platform.ts` provides the live context (`isNative()`, server-URL/token storage via `localStorage`) and an `apiFetch()` wrapper. `api.ts` and `auth.ts` route every call through `apiFetch`. On native, `login`/`register` send `X-Tormod-Client: native` and store the returned token. A native-only "server address" screen (`ServerScreen`) gates the app before auth.

**Tech Stack:** React 19 + TypeScript (strict) + Vite + Vitest (node env, pure-logic tests — no jsdom). `@capacitor/core` for platform detection.

**Series:** Plan 2 of the mobile MVP (spec: `docs/superpowers/specs/2026-06-13-tormod-mobile-capacitor-design.md`, milestone 0.5.0). Plan 1 (backend token + CORS) is merged into `develop`. Plan 3 (Capacitor `android/` shell + SSE WebView spike + APK) follows.

---

## File structure

- `apps/web/src/lib/request.ts` — **create.** Pure: `PlatformCtx`, `buildRequest()`, `validateServerUrl()`. No browser/Capacitor imports → unit-testable in node.
- `apps/web/src/lib/request.test.ts` — **create.** Unit tests for the pure functions.
- `apps/web/src/lib/platform.ts` — **create.** `isNative()` (Capacitor), `localStorage` storage for server URL + token, `apiFetch()`. Browser-coupled (not unit-tested).
- `apps/web/src/lib/api.ts` — **modify.** Route all calls (incl. SSE) through `apiFetch`.
- `apps/web/src/lib/auth.ts` — **modify.** Route through `apiFetch`; native `login`/`register` send `X-Tormod-Client: native` and store the token; `logout` clears it.
- `apps/web/src/lib/auth.test.ts` — **create.** Token-capture test (mocked `apiFetch`).
- `apps/web/src/components/auth/ServerScreen.tsx` — **create.** Native-only server-address screen.
- `apps/web/src/app/App.tsx` — **modify.** Gate on native+no-server → `ServerScreen`.
- `apps/web/package.json` — **modify.** Add `@capacitor/core`.

Run web commands from `/home/odin/tormod/apps/web`. Tests: `npx vitest run <path>`. Typecheck: `npx tsc -b --noEmit`. Branch: `feat/mobile-capacitor`.

---

### Task 1: Pure request builder + URL validator

**Files:**
- Create: `apps/web/src/lib/request.ts`
- Test: `apps/web/src/lib/request.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/request.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildRequest, validateServerUrl } from './request'

describe('buildRequest', () => {
  it('web mode: relative path, cookie credentials, no auth header', () => {
    const { url, init } = buildRequest('/api/sessions', { headers: { 'X-Tormod': '1' } }, { native: false, serverUrl: null, token: null })
    expect(url).toBe('/api/sessions')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('native mode: absolute URL, omit credentials, bearer header', () => {
    const { url, init } = buildRequest('/api/sessions', {}, { native: true, serverUrl: 'http://10.0.0.10:8080', token: 'abc' })
    expect(url).toBe('http://10.0.0.10:8080/api/sessions')
    expect(init.credentials).toBe('omit')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc')
  })

  it('native without a token sends no auth header', () => {
    const { init } = buildRequest('/api/auth/status', {}, { native: true, serverUrl: 'http://h:1', token: null })
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('preserves caller-supplied headers', () => {
    const { init } = buildRequest('/api/x', { headers: { 'Content-Type': 'application/json' } }, { native: true, serverUrl: 'http://h:1', token: 't' })
    const h = init.headers as Record<string, string>
    expect(h['Content-Type']).toBe('application/json')
    expect(h.Authorization).toBe('Bearer t')
  })
})

describe('validateServerUrl', () => {
  it('accepts and normalizes a valid http url (strips trailing slash)', () => {
    expect(validateServerUrl('  http://10.0.0.10:8080/ ')).toBe('http://10.0.0.10:8080')
  })
  it('accepts https', () => {
    expect(validateServerUrl('https://tormod.example')).toBe('https://tormod.example')
  })
  it('rejects a url without scheme', () => {
    expect(validateServerUrl('10.0.0.10:8080')).toBeNull()
  })
  it('rejects garbage', () => {
    expect(validateServerUrl('not a url')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/request.test.ts`
Expected: FAIL — `./request` does not exist.

- [ ] **Step 3: Implement `request.ts`**

Create `apps/web/src/lib/request.ts`:

```ts
export interface PlatformCtx {
  native: boolean
  serverUrl: string | null
  token: string | null
}

export function buildRequest(path: string, init: RequestInit, ctx: PlatformCtx): { url: string; init: RequestInit } {
  const base = ctx.native && ctx.serverUrl ? ctx.serverUrl : ''
  const headers: Record<string, string> = { ...((init.headers as Record<string, string> | undefined) ?? {}) }
  if (ctx.native && ctx.token) headers.Authorization = `Bearer ${ctx.token}`
  return {
    url: `${base}${path}`,
    init: { ...init, headers, credentials: ctx.native ? 'omit' : 'include' },
  }
}

export function validateServerUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/.+/.test(trimmed)) return null
  try {
    const u = new URL(trimmed)
    return u.hostname ? trimmed : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/request.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/request.ts apps/web/src/lib/request.test.ts
git commit -m "feat(web): pure platform-aware request builder and url validator"
```

---

### Task 2: Platform module (isNative, storage, apiFetch)

**Files:**
- Modify: `apps/web/package.json` (add `@capacitor/core`)
- Create: `apps/web/src/lib/platform.ts`

- [ ] **Step 1: Add the Capacitor core dependency**

Run: `npm install @capacitor/core`
Expected: it is added to `dependencies` in `apps/web/package.json`. (In a browser/test context `Capacitor.isNativePlatform()` returns `false`; the native runtime arrives in Plan 3.)

- [ ] **Step 2: Implement `platform.ts`**

Create `apps/web/src/lib/platform.ts`:

```ts
import { Capacitor } from '@capacitor/core'
import { buildRequest } from './request'

const SERVER_KEY = 'tormod:serverUrl'
const TOKEN_KEY = 'tormod:token'

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export function getServerUrl(): string | null {
  return localStorage.getItem(SERVER_KEY)
}

export function setServerUrl(url: string): void {
  localStorage.setItem(SERVER_KEY, url)
}

export function clearServerUrl(): void {
  localStorage.removeItem(SERVER_KEY)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, init: built } = buildRequest(path, init, {
    native: isNative(),
    serverUrl: getServerUrl(),
    token: getToken(),
  })
  return fetch(url, built)
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors (the new module compiles; nothing consumes it yet).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/src/lib/platform.ts
git commit -m "feat(web): platform module with native detection, storage and apiFetch"
```

---

### Task 3: Route api.ts and auth.ts through apiFetch

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/auth.ts`
- Test: `apps/web/src/lib/auth.test.ts`

- [ ] **Step 1: Write the failing test for native token capture**

Create `apps/web/src/lib/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./platform', () => {
  const store: Record<string, string> = {}
  return {
    isNative: () => true,
    getServerUrl: () => 'http://h:1',
    getToken: () => store.token ?? null,
    setToken: (t: string) => { store.token = t },
    clearToken: () => { delete store.token },
    apiFetch: vi.fn(),
  }
})

import { login } from './auth'
import * as platform from './platform'

beforeEach(() => {
  platform.clearToken()
  vi.mocked(platform.apiFetch).mockReset()
})

describe('native login', () => {
  it('sends X-Tormod-Client: native and stores the returned token', async () => {
    vi.mocked(platform.apiFetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, token: 'tok-123' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    await login({ username: 'u', password: 'p' })
    const [, init] = vi.mocked(platform.apiFetch).mock.calls[0]
    expect((init?.headers as Record<string, string>)['X-Tormod-Client']).toBe('native')
    expect(platform.getToken()).toBe('tok-123')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL — `auth.ts` still calls `fetch` directly (not `apiFetch`), no `X-Tormod-Client` header, token not stored.

- [ ] **Step 3: Refactor `api.ts`**

Replace the entire contents of `apps/web/src/lib/api.ts` with (every `fetch('/api/...', { credentials: 'include', ... })` becomes `apiFetch('/api/...', { ... })`; `apiFetch` sets credentials and base URL):

```ts
import { apiFetch } from './platform'
import type { GlobalEvent, HistoryItem, PermissionMode, ServerEvent, SessionMeta, Settings } from './serverTypes'

const MUTATION_HEADERS: HeadersInit = { 'Content-Type': 'application/json', 'X-Tormod': '1' }

function jsonHeaders(): HeadersInit {
  return MUTATION_HEADERS
}

async function expectOk(res: Response): Promise<Response> {
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`request failed: ${res.status}`)
  return res
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  const res = await expectOk(await apiFetch('/api/sessions'))
  return res.json() as Promise<SessionMeta[]>
}

export async function createSession(body: { title?: string; cwd?: string } = {}): Promise<SessionMeta> {
  const res = await expectOk(
    await apiFetch('/api/sessions', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }),
  )
  return res.json() as Promise<SessionMeta>
}

export async function getHistory(id: string): Promise<HistoryItem[]> {
  const res = await expectOk(await apiFetch(`/api/sessions/${id}/history`))
  return res.json() as Promise<HistoryItem[]>
}

export async function sendMessage(id: string, text: string): Promise<void> {
  await expectOk(
    await apiFetch(`/api/sessions/${id}/messages`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ text }) }),
  )
}

export async function interruptSession(id: string): Promise<void> {
  await expectOk(await apiFetch(`/api/sessions/${id}/interrupt`, { method: 'POST', headers: jsonHeaders() }))
}

export async function closeSession(id: string): Promise<void> {
  await expectOk(await apiFetch(`/api/sessions/${id}/close`, { method: 'POST', headers: jsonHeaders() }))
}

export async function setPermissionMode(id: string, mode: PermissionMode): Promise<void> {
  await expectOk(
    await apiFetch(`/api/sessions/${id}/permission-mode`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ mode }) }),
  )
}

export async function deleteSession(id: string): Promise<void> {
  await expectOk(await apiFetch(`/api/sessions/${id}`, { method: 'DELETE', headers: jsonHeaders() }))
}

export async function getSettings(): Promise<Settings> {
  const res = await expectOk(await apiFetch('/api/settings'))
  return res.json() as Promise<Settings>
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const res = await expectOk(
    await apiFetch('/api/settings', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(patch) }),
  )
  return res.json() as Promise<Settings>
}

export async function decide(toolUseId: string, allow: boolean): Promise<void> {
  await expectOk(
    await apiFetch(`/api/decisions/${toolUseId}`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ allow }) }),
  )
}

export function streamSession(id: string, onEvent: (event: ServerEvent) => void, signal: AbortSignal): Promise<void> {
  return readSSE(`/api/sessions/${id}/stream`, onEvent, signal)
}

export function streamAll(onEvent: (event: GlobalEvent) => void, signal: AbortSignal): Promise<void> {
  return readSSE('/api/stream', onEvent, signal)
}

async function readSSE<T>(path: string, onEvent: (event: T) => void, signal: AbortSignal): Promise<void> {
  const res = await apiFetch(path, { signal })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
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
        onEvent(parsed as T)
      }
    }
  }
}
```

- [ ] **Step 4: Refactor `auth.ts`**

Replace the entire contents of `apps/web/src/lib/auth.ts` with (route through `apiFetch`; native clients add the `X-Tormod-Client: native` header and store the returned token; `logout` clears it):

```ts
import { apiFetch, isNative, setToken, clearToken } from './platform'
import type { AuthStatus, AuthProfile, TotpEnrollment } from './serverTypes'

const MUT: HeadersInit = { 'Content-Type': 'application/json', 'X-Tormod': '1' }

function authHeaders(): HeadersInit {
  return isNative() ? { ...MUT, 'X-Tormod-Client': 'native' } : MUT
}

export class AuthError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new AuthError(body.error ?? `failed: ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export async function getStatus(): Promise<AuthStatus> {
  return json(await apiFetch('/api/auth/status'))
}

export async function register(body: { username: string; email: string; password: string }): Promise<void> {
  const parsed = await json<{ token?: string }>(
    await apiFetch('/api/auth/register', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  )
  if (isNative() && parsed.token) setToken(parsed.token)
}

export async function login(body: { username: string; password: string; totp?: string }): Promise<void> {
  const parsed = await json<{ token?: string }>(
    await apiFetch('/api/auth/login', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  )
  if (isNative() && parsed.token) setToken(parsed.token)
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST', headers: MUT })
  clearToken()
}

export async function getProfile(): Promise<AuthProfile> {
  return json(await apiFetch('/api/auth/me'))
}

export async function enrollTotp(): Promise<TotpEnrollment> {
  return json(await apiFetch('/api/auth/totp/enroll', { method: 'POST', headers: MUT }))
}

export async function confirmTotp(token: string): Promise<void> {
  await json(await apiFetch('/api/auth/totp/confirm', { method: 'POST', headers: MUT, body: JSON.stringify({ token }) }))
}

export async function disableTotp(password: string): Promise<void> {
  await json(await apiFetch('/api/auth/totp/disable', { method: 'POST', headers: MUT, body: JSON.stringify({ password }) }))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS (the native header is sent and the token is stored).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc -b --noEmit`
Expected: all web tests pass (request, auth, foldEvents …); `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/auth.ts apps/web/src/lib/auth.test.ts
git commit -m "feat(web): route api and auth through apiFetch with native token capture"
```

---

### Task 4: Server-address screen + native gating

**Files:**
- Create: `apps/web/src/components/auth/ServerScreen.tsx`
- Modify: `apps/web/src/app/App.tsx`

This task is verified by typecheck + build + manual run (the web test harness is node-only / pure-logic — no component tests). The non-trivial logic (`validateServerUrl`) is already unit-tested in Task 1.

- [ ] **Step 1: Create `ServerScreen.tsx`**

Create `apps/web/src/components/auth/ServerScreen.tsx` (mirrors the existing `AuthGate` Card/Field/Alert/Button style; on submit it validates the URL, stores it, probes `GET /api/auth/status` through `apiFetch`, and calls `onConnected` on success):

```tsx
import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { setServerUrl, clearServerUrl } from '@/lib/platform'
import { validateServerUrl } from '@/lib/request'
import { getStatus } from '@/lib/auth'

const inputClass =
  'rounded-xl border border-border bg-surface px-4 py-3 text-sm text-frost outline-none focus:border-arc/50'

export function ServerScreen({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const normalized = validateServerUrl(url)
    if (!normalized) {
      setError('Endereço inválido. Use algo como http://10.0.0.10:8080')
      return
    }
    setBusy(true)
    setServerUrl(normalized)
    try {
      await getStatus()
      onConnected()
    } catch {
      clearServerUrl()
      setError('Não foi possível alcançar esse servidor. Confira o endereço e a conexão (VPN).')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center bg-ink px-6 text-frost">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-deep p-7 shadow-xl shadow-black/30">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <h1 className="text-base font-bold text-frost">Conectar ao servidor</h1>
            <p className="text-sm text-faint">Endereço do seu Tormod na rede (ou pela VPN).</p>
          </div>
          <input
            className={cn(inputClass)}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="http://10.0.0.10:8080"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm leading-snug text-danger">
              <AlertCircle className="mt-px size-4 shrink-0" strokeWidth={2.25} />
              <span>{error}</span>
            </div>
          )}
          <Button type="submit" disabled={busy || url.trim().length === 0}>
            {busy ? 'Conectando…' : 'Conectar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Gate the app on native + no server URL**

In `apps/web/src/app/App.tsx`, add these imports near the other imports:

```ts
import { useState } from 'react'
import { ServerScreen } from '@/components/auth/ServerScreen'
import { isNative, getServerUrl } from '@/lib/platform'
```

(Note: `useState` is already imported — merge it into the existing `react` import; do not duplicate.)

Then, at the very top of the `App()` body (before `useSessions()` runs, so a native client without a server URL never makes API calls), add:

```ts
  const [hasServer, setHasServer] = useState(!isNative() || getServerUrl() !== null)

  if (!hasServer) {
    return <ServerScreen onConnected={() => setHasServer(true)} />
  }
```

Place this as the first statements inside `export function App() {`, before `const { sessions, ... } = useSessions()`. On web, `isNative()` is `false` so `hasServer` starts `true` and the screen never shows. On native, once a server URL is stored, `onConnected` flips `hasServer` and the normal `AuthGate`/session flow runs against that server.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -b --noEmit && npx vite build`
Expected: `tsc` clean; `vite build` succeeds (produces `dist/`).

- [ ] **Step 4: Manual web smoke (no regression)**

Run the dev server (`npm run dev`) and load it in a browser. Because `isNative()` is `false` on web, the app must behave exactly as before: registration/login screen, then sessions. The `ServerScreen` must NOT appear. (The native path is exercised in Plan 3 on a device.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/auth/ServerScreen.tsx apps/web/src/app/App.tsx
git commit -m "feat(web): native server-address screen and gating"
```

---

## Verification (end of plan)

- [ ] From `apps/web`: `npx vitest run` — all green (request + auth + foldEvents).
- [ ] From `apps/web`: `npx tsc -b --noEmit` — no errors.
- [ ] From `apps/web`: `npx vite build` — succeeds.
- [ ] Manual: web dev server behaves identically to before (no server screen, cookie auth) — proves the seam defaults to web and the refactor introduced no regression.

## Out of scope (later plan)

- Capacitor `android/` project, `androidScheme: 'http'`, `network_security_config`, the SSE WebView spike, APK build/sideload — **Plan 3**.
- A "change server" / re-pair action in Settings — minor follow-up (the gating + `clearServerUrl` primitive already exist).
- Secure token storage (Keychain/Keystore) instead of `localStorage` — post-MVP hardening.

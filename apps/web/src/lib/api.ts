import type { GlobalEvent, HistoryItem, ServerEvent, SessionMeta } from './serverTypes'

const TOKEN_KEY = 'tormod:token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
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
  const res = await expectOk(await fetch('/api/sessions', { headers: authHeaders() }))
  return res.json() as Promise<SessionMeta[]>
}

export async function createSession(body: { title?: string; cwd?: string } = {}): Promise<SessionMeta> {
  const res = await expectOk(
    await fetch('/api/sessions', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  )
  return res.json() as Promise<SessionMeta>
}

export async function getHistory(id: string): Promise<HistoryItem[]> {
  const res = await expectOk(await fetch(`/api/sessions/${id}/history`, { headers: authHeaders() }))
  return res.json() as Promise<HistoryItem[]>
}

export async function sendMessage(id: string, text: string): Promise<void> {
  await expectOk(
    await fetch(`/api/sessions/${id}/messages`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text }),
    }),
  )
}

export async function closeSession(id: string): Promise<void> {
  await expectOk(await fetch(`/api/sessions/${id}/close`, { method: 'POST', headers: authHeaders() }))
}

export async function deleteSession(id: string): Promise<void> {
  await expectOk(await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: authHeaders() }))
}

export async function decide(toolUseId: string, allow: boolean): Promise<void> {
  await expectOk(
    await fetch(`/api/decisions/${toolUseId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ allow }),
    }),
  )
}

/**
 * Subscribes to a session's SSE stream. Uses fetch (not EventSource) so the
 * bearer token rides in the Authorization header. Resolves when the stream ends
 * or the signal aborts; calls onEvent for each ServerEvent (pings ignored).
 */
export function streamSession(
  id: string,
  onEvent: (event: ServerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return readSSE(`/api/sessions/${id}/stream`, onEvent, signal)
}

/** Subscribes to the global channel (cross-session status changes). */
export function streamAll(onEvent: (event: GlobalEvent) => void, signal: AbortSignal): Promise<void> {
  return readSSE('/api/stream', onEvent, signal)
}

async function readSSE<T>(path: string, onEvent: (event: T) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(path, { headers: authHeaders(), signal })
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

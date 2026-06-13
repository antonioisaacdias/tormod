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

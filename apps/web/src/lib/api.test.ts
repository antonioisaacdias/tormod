import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./platform', () => ({ apiFetch: vi.fn() }))

import {
  listSessions,
  createSession,
  getHistory,
  sendMessage,
  interruptSession,
  closeSession,
  setPermissionMode,
  deleteSession,
  getSettings,
  saveSettings,
  decide,
  streamAll,
  streamSession,
  UnauthorizedError,
} from './api'
import * as platform from './platform'
import type { GlobalEvent } from './serverTypes'

const fetchMock = vi.mocked(platform.apiFetch)
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const empty = (status = 200) => new Response(null, { status })

function sse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status })
}

const callPath = () => fetchMock.mock.calls[0][0]
const callInit = () => fetchMock.mock.calls[0][1]

beforeEach(() => fetchMock.mockReset())

describe('expectOk error mapping', () => {
  it('throws UnauthorizedError on 401', async () => {
    fetchMock.mockResolvedValue(empty(401))
    await expect(listSessions()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('throws a generic Error on other non-2xx', async () => {
    fetchMock.mockResolvedValue(empty(500))
    await expect(listSessions()).rejects.toThrow('request failed: 500')
  })
})

describe('session and settings calls', () => {
  it('listSessions GETs /api/sessions and returns the body', async () => {
    fetchMock.mockResolvedValue(json([{ id: 's1' }]))
    await expect(listSessions()).resolves.toEqual([{ id: 's1' }])
    expect(callPath()).toBe('/api/sessions')
  })

  it('createSession POSTs the body', async () => {
    fetchMock.mockResolvedValue(json({ id: 's2' }))
    await createSession({ title: 'x' })
    expect(callPath()).toBe('/api/sessions')
    expect(callInit()?.method).toBe('POST')
    expect(JSON.parse(callInit()?.body as string)).toEqual({ title: 'x' })
  })

  it('getHistory targets the session history path', async () => {
    fetchMock.mockResolvedValue(json([]))
    await getHistory('abc')
    expect(callPath()).toBe('/api/sessions/abc/history')
  })

  it('sendMessage POSTs the text', async () => {
    fetchMock.mockResolvedValue(empty())
    await sendMessage('s1', 'hi')
    expect(callPath()).toBe('/api/sessions/s1/messages')
    expect(JSON.parse(callInit()?.body as string)).toEqual({ text: 'hi' })
  })

  it('interruptSession and closeSession POST to their paths', async () => {
    fetchMock.mockResolvedValue(empty())
    await interruptSession('s1')
    expect(callPath()).toBe('/api/sessions/s1/interrupt')
    fetchMock.mockClear()
    await closeSession('s1')
    expect(callPath()).toBe('/api/sessions/s1/close')
  })

  it('setPermissionMode PUTs the mode', async () => {
    fetchMock.mockResolvedValue(empty())
    await setPermissionMode('s1', 'auto')
    expect(callInit()?.method).toBe('PUT')
    expect(JSON.parse(callInit()?.body as string)).toEqual({ mode: 'auto' })
  })

  it('deleteSession DELETEs the session', async () => {
    fetchMock.mockResolvedValue(empty())
    await deleteSession('s1')
    expect(callPath()).toBe('/api/sessions/s1')
    expect(callInit()?.method).toBe('DELETE')
  })

  it('getSettings and saveSettings hit /api/settings', async () => {
    fetchMock.mockResolvedValue(json({ systemPrompt: 'p' }))
    await expect(getSettings()).resolves.toEqual({ systemPrompt: 'p' })
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(json({ systemPrompt: 'q' }))
    await saveSettings({ systemPrompt: 'q' })
    expect(callInit()?.method).toBe('PUT')
  })

  it('decide POSTs the allow flag', async () => {
    fetchMock.mockResolvedValue(empty())
    await decide('tool-1', true)
    expect(callPath()).toBe('/api/decisions/tool-1')
    expect(JSON.parse(callInit()?.body as string)).toEqual({ allow: true })
  })
})

describe('readSSE streaming', () => {
  it('rejects with UnauthorizedError on 401', async () => {
    fetchMock.mockResolvedValue(sse([], 401))
    await expect(streamAll(() => {}, new AbortController().signal)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('rejects when the response is not ok', async () => {
    fetchMock.mockResolvedValue(sse([], 503))
    await expect(streamSession('s1', () => {}, new AbortController().signal)).rejects.toThrow('stream failed: 503')
  })

  it('parses typed events and skips malformed or dataless frames', async () => {
    const events: GlobalEvent[] = []
    fetchMock.mockResolvedValue(
      sse([
        'data: {"type":"session_status","id":"a","status":"working"}\n\n',
        ': comment-only frame\n\n',
        'data: not-json\n\n',
        'data: {"id":"no-type"}\n\n',
      ]),
    )
    await streamAll((e) => events.push(e), new AbortController().signal)
    expect(events).toEqual([{ type: 'session_status', id: 'a', status: 'working' }])
  })

  it('reassembles a frame split across chunks', async () => {
    const events: GlobalEvent[] = []
    fetchMock.mockResolvedValue(
      sse(['data: {"type":"session_status",', '"id":"b","status":"closed"}\n\n']),
    )
    await streamAll((e) => events.push(e), new AbortController().signal)
    expect(events).toEqual([{ type: 'session_status', id: 'b', status: 'closed' }])
  })
})

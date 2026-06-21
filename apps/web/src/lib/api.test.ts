import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./platform', () => ({ apiFetch: vi.fn() }))
vi.mock('./sse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sse')>()),
  connectSSE: vi.fn(() => Promise.resolve()),
}))

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
import { connectSSE, type StreamOpts } from './sse'
import type { GlobalEvent, ServerEvent } from './serverTypes'

const fetchMock = vi.mocked(platform.apiFetch)
const connectMock = vi.mocked(connectSSE)
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const empty = (status = 200) => new Response(null, { status })

const callPath = () => fetchMock.mock.calls[0][0]
const callInit = () => fetchMock.mock.calls[0][1]

beforeEach(() => {
  fetchMock.mockReset()
  connectMock.mockReset()
  connectMock.mockResolvedValue(undefined)
})

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

describe('stream delegation to connectSSE', () => {
  it('streamSession targets the session stream path and forwards opts', async () => {
    const opts: StreamOpts<ServerEvent> = { onEvent: vi.fn(), signal: new AbortController().signal }
    await streamSession('s1', opts)
    expect(connectMock).toHaveBeenCalledTimes(1)
    expect(connectMock).toHaveBeenCalledWith('/api/sessions/s1/stream', opts)
  })

  it('streamAll targets the global stream path and forwards opts', async () => {
    const opts: StreamOpts<GlobalEvent> = {
      onEvent: vi.fn(),
      onStatus: vi.fn(),
      onReconnect: vi.fn(),
      signal: new AbortController().signal,
    }
    await streamAll(opts)
    expect(connectMock).toHaveBeenCalledTimes(1)
    expect(connectMock).toHaveBeenCalledWith('/api/stream', opts)
  })

  it('propagates connectSSE rejection (e.g. UnauthorizedError)', async () => {
    connectMock.mockRejectedValueOnce(new UnauthorizedError())
    const opts: StreamOpts<GlobalEvent> = { onEvent: vi.fn(), signal: new AbortController().signal }
    await expect(streamAll(opts)).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

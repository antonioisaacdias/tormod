// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GlobalEvent, SessionMeta } from '@/lib/serverTypes'

const { m, UnauthorizedError } = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    constructor() {
      super('unauthorized')
      this.name = 'UnauthorizedError'
    }
  }
  return {
    m: {
      listSessions: vi.fn(),
      createSession: vi.fn(),
      closeSession: vi.fn(),
      deleteSession: vi.fn(),
      setPermissionMode: vi.fn(),
      streamAll: vi.fn(),
      captured: { cb: null as null | ((e: GlobalEvent) => void) },
    },
    UnauthorizedError,
  }
})

vi.mock('@/lib/api', () => ({
  listSessions: m.listSessions,
  createSession: m.createSession,
  closeSession: m.closeSession,
  deleteSession: m.deleteSession,
  setPermissionMode: m.setPermissionMode,
  streamAll: m.streamAll,
  UnauthorizedError,
}))

import { renderHook, act, waitFor } from '@testing-library/react'
import { useSessions } from './useSessions'

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: 's1',
  status: 'live',
  title: 't',
  createdAt: '2026-01-01T00:00:00Z',
  permissionMode: 'default',
  ...over,
})

beforeEach(() => {
  for (const fn of [m.listSessions, m.createSession, m.closeSession, m.deleteSession, m.setPermissionMode, m.streamAll]) {
    fn.mockReset()
  }
  m.captured.cb = null
  m.streamAll.mockImplementation((cb: (e: GlobalEvent) => void) => {
    m.captured.cb = cb
    return new Promise<void>(() => {})
  })
  m.listSessions.mockResolvedValue([])
})

describe('useSessions', () => {
  it('loads sessions on mount and clears the loading flag', async () => {
    m.listSessions.mockResolvedValue([meta({ id: 'a' })])
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions.map((s) => s.id)).toEqual(['a'])
  })

  it('flags unauthorized when the listing is rejected', async () => {
    m.listSessions.mockRejectedValue(new UnauthorizedError())
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.unauthorized).toBe(true))
  })

  it('applies live status events and ignores unrelated ones', async () => {
    m.listSessions.mockResolvedValue([meta({ id: 's1', status: 'live' })])
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    act(() => m.captured.cb?.({ type: 'session_status', id: 's1', status: 'working' }))
    expect(result.current.sessions[0].status).toBe('working')
    expect(result.current.sessions[0].live).toBe(true)

    act(() => m.captured.cb?.({ type: 'session_status', id: 's1', status: 'closed' }))
    expect(result.current.sessions[0].live).toBe(false)

    act(() => m.captured.cb?.({ type: 'other' } as unknown as GlobalEvent))
    expect(result.current.sessions[0].status).toBe('closed')
  })

  it('create returns the new id and refreshes; failure returns null', async () => {
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.loading).toBe(false))

    m.createSession.mockResolvedValue(meta({ id: 'new' }))
    let id: string | null = null
    await act(async () => {
      id = await result.current.create()
    })
    expect(id).toBe('new')
    expect(m.createSession).toHaveBeenCalled()

    m.createSession.mockRejectedValue(new Error('boom'))
    let failed: string | null = 'x'
    await act(async () => {
      failed = await result.current.create()
    })
    expect(failed).toBeNull()
  })

  it('close and remove call the api and refresh', async () => {
    m.closeSession.mockResolvedValue(undefined)
    m.deleteSession.mockResolvedValue(undefined)
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.close('s1')
    })
    expect(m.closeSession).toHaveBeenCalledWith('s1')

    await act(async () => {
      await result.current.remove('s1')
    })
    expect(m.deleteSession).toHaveBeenCalledWith('s1')
  })

  it('setMode optimistically updates the session and calls the api', async () => {
    m.listSessions.mockResolvedValue([meta({ id: 's1', permissionMode: 'default' })])
    m.setPermissionMode.mockResolvedValue(undefined)
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => {
      await result.current.setMode('s1', 'auto')
    })
    expect(result.current.sessions[0].permissionMode).toBe('auto')
    expect(m.setPermissionMode).toHaveBeenCalledWith('s1', 'auto')
  })
})

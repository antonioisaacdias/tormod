// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  getHistory: vi.fn(),
  streamSession: vi.fn(),
  sendMessage: vi.fn(),
  interruptSession: vi.fn(),
  decide: vi.fn(),
  streamCb: { fn: null as null | ((e: unknown) => void) },
}))

vi.mock('@/lib/api', () => ({
  getHistory: m.getHistory,
  streamSession: m.streamSession,
  sendMessage: m.sendMessage,
  interruptSession: m.interruptSession,
  decide: m.decide,
}))

import { renderHook, act, waitFor } from '@testing-library/react'
import { useSessionThreads } from './useSessionThreads'

beforeEach(() => {
  for (const fn of [m.getHistory, m.streamSession, m.sendMessage, m.interruptSession, m.decide]) fn.mockReset()
  m.streamCb.fn = null
  m.getHistory.mockResolvedValue([])
  m.streamSession.mockImplementation((_id: string, cb: (e: unknown) => void) => {
    m.streamCb.fn = cb
    return new Promise<void>(() => {})
  })
  m.sendMessage.mockResolvedValue(undefined)
  m.interruptSession.mockResolvedValue(undefined)
  m.decide.mockResolvedValue(undefined)
})

async function mounted() {
  const hook = renderHook(() => useSessionThreads())
  act(() => hook.result.current.ensure('s1'))
  await waitFor(() => expect(m.streamSession).toHaveBeenCalledTimes(1))
  return hook.result
}

describe('useSessionThreads', () => {
  it('ensure loads history then opens the stream, and is idempotent', async () => {
    m.getHistory.mockResolvedValue([{ role: 'user', text: 'hi' }])
    const result = await mounted()
    expect(m.getHistory).toHaveBeenCalledWith('s1')
    act(() => result.current.ensure('s1'))
    expect(m.streamSession).toHaveBeenCalledTimes(1)
  })

  it('get returns the empty runtime for an unknown session', () => {
    const { result } = renderHook(() => useSessionThreads())
    expect(result.current.get('nope').working).toBe(false)
    expect(result.current.get(null).working).toBe(false)
  })

  it('merges usage events into the runtime', async () => {
    const result = await mounted()
    act(() => m.streamCb.fn?.({ type: 'usage', contextTokens: 123, contextWindow: 456 }))
    expect(result.current.get('s1').usage.context.usedTokens).toBe(123)
    expect(result.current.get('s1').usage.context.totalTokens).toBe(456)
  })

  it('send marks the session working; a result event clears it', async () => {
    const result = await mounted()
    await act(async () => {
      await result.current.send('s1', 'hello')
    })
    expect(m.sendMessage).toHaveBeenCalledWith('s1', 'hello')
    expect(result.current.get('s1').working).toBe(true)

    act(() => m.streamCb.fn?.({ type: 'result' }))
    expect(result.current.get('s1').working).toBe(false)
  })

  it('send ignores blank text', async () => {
    const result = await mounted()
    await act(async () => {
      await result.current.send('s1', '   ')
    })
    expect(m.sendMessage).not.toHaveBeenCalled()
  })

  it('send resets working when the api rejects', async () => {
    m.sendMessage.mockRejectedValue(new Error('down'))
    const result = await mounted()
    await act(async () => {
      await result.current.send('s1', 'hi')
    })
    expect(result.current.get('s1').working).toBe(false)
  })

  it('decide maps the approval decision to the allow flag', async () => {
    const result = await mounted()
    await act(async () => {
      await result.current.decide('s1', 'tool-1', 'allowed')
    })
    expect(m.decide).toHaveBeenCalledWith('tool-1', true)
    await act(async () => {
      await result.current.decide('s1', 'tool-2', 'denied')
    })
    expect(m.decide).toHaveBeenCalledWith('tool-2', false)
  })

  it('interrupt clears working and calls the api', async () => {
    const result = await mounted()
    await act(async () => {
      await result.current.send('s1', 'hi')
    })
    await act(async () => {
      await result.current.interrupt('s1')
    })
    expect(result.current.get('s1').working).toBe(false)
    expect(m.interruptSession).toHaveBeenCalledWith('s1')
  })

  it('drop tears down the runtime', async () => {
    const result = await mounted()
    act(() => result.current.drop('s1'))
    expect(result.current.get('s1').working).toBe(false)
  })
})

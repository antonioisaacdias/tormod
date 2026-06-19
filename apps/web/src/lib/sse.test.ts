// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectSSE, STALE_MS, UnauthorizedError } from './sse'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('./platform', () => ({ apiFetch }))

type ResponseFactory = (signal: AbortSignal | null | undefined) => Response

// Builds a Response factory whose body streams the given chunks, then optionally
// stays open. A kept-open body errors its pending read when `signal` aborts, the
// same way a real `fetch` body does — so the wrapper can tear it down.
function streamResponse(chunks: string[], opts: { keepOpen?: boolean } = {}): ResponseFactory {
  return (signal) => {
    const enc = new TextEncoder()
    let i = 0
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (!signal) return
        signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), {
          once: true,
        })
      },
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
}

// Routes queued response factories through the captured per-call AbortSignal.
function queueResponses(...factories: (ResponseFactory | Response)[]) {
  let idx = 0
  apiFetch.mockImplementation((_path: string, init?: RequestInit) => {
    const factory = factories[Math.min(idx, factories.length - 1)]
    idx += 1
    const res = typeof factory === 'function' ? factory(init?.signal) : factory
    return Promise.resolve(res)
  })
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
    queueResponses(streamResponse(['event: text\ndata: {"type":"text","text":"hi"}\n\n']))
    const events: unknown[] = []
    const ctrl = new AbortController()
    const run = connectSSE('/p', { onEvent: (e) => events.push(e), signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(0)
    ctrl.abort()
    await run
    expect(events).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('stops immediately and throws on 401', async () => {
    queueResponses(new Response(null, { status: 401 }))
    const ctrl = new AbortController()
    await expect(connectSSE('/p', { onEvent: () => {}, signal: ctrl.signal })).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('reconnects after the stream ends and calls onReconnect on the 2nd open', async () => {
    queueResponses(
      streamResponse(['data: {"type":"a"}\n\n']), // ends -> reconnect
      streamResponse([], { keepOpen: true }),
    )
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
    queueResponses(
      streamResponse([], { keepOpen: true }), // silent -> watchdog fires
      streamResponse([], { keepOpen: true }),
    )
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

  it('reconnects early when the network comes back online', async () => {
    queueResponses(
      streamResponse([]), // ends immediately -> enters backoff wait
      streamResponse([], { keepOpen: true }),
    )
    const ctrl = new AbortController()
    const run = connectSSE('/p', { onEvent: () => {}, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(0) // first connection opens, then ends
    expect(apiFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(50) // well short of backoff[0] (1000ms)
    expect(apiFetch).toHaveBeenCalledTimes(1) // still waiting
    window.dispatchEvent(new Event('online')) // wake -> cut the wait short
    await vi.advanceTimersByTimeAsync(0)
    expect(apiFetch).toHaveBeenCalledTimes(2) // reconnected without the full 1000ms backoff
    ctrl.abort()
    await run
  })

  it('reconnects early when the tab becomes visible', async () => {
    queueResponses(
      streamResponse([]), // ends immediately -> enters backoff wait
      streamResponse([], { keepOpen: true }),
    )
    const ctrl = new AbortController()
    const run = connectSSE('/p', { onEvent: () => {}, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(0)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(50)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange')) // wake -> cut the wait short
    await vi.advanceTimersByTimeAsync(0)
    expect(apiFetch).toHaveBeenCalledTimes(2)
    ctrl.abort()
    await run
  })

  it('does not reconnect after external abort', async () => {
    queueResponses(streamResponse([], { keepOpen: true }))
    const ctrl = new AbortController()
    const run = connectSSE('/p', { onEvent: () => {}, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(0)
    ctrl.abort()
    await run
    await vi.advanceTimersByTimeAsync(60_000)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
})

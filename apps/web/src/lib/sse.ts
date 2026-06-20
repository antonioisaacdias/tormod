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

import { useCallback, useEffect, useRef, useState } from 'react'
import { decide as decideApi, getHistory, sendMessage, streamSession } from '@/lib/api'
import { appendUserMessage, emptyThread, foldEvent, seedThread, setDecision, type ThreadState } from '@/lib/foldEvents'
import type { ApprovalDecision } from '@/types/thread'
import type { SessionUsage } from '@/types/usage'

type UsageEvent = {
  model?: string
  contextTokens?: number
  contextWindow?: number
  fiveHourPct?: number
  sevenDayPct?: number
}

const INITIAL_USAGE: SessionUsage = {
  model: 'claude code',
  context: { usedTokens: 0, totalTokens: 200_000 },
  limits: { fiveHour: 0, sevenDay: 0 },
}

export interface SessionRuntime {
  thread: ThreadState
  usage: SessionUsage
  working: boolean
}

const EMPTY_RUNTIME: SessionRuntime = { thread: emptyThread, usage: INITIAL_USAGE, working: false }

/**
 * Keeps a live SSE stream + accumulated thread state PER session, surviving
 * session switches. Switching away no longer tears down a working session's
 * stream, so its thinking/tooling keeps arriving and is intact on return.
 */
export function useSessionThreads() {
  const [runtimes, setRuntimes] = useState<Record<string, SessionRuntime>>({})
  const started = useRef<Set<string>>(new Set())
  const ctrls = useRef<Map<string, AbortController>>(new Map())

  const update = useCallback((id: string, fn: (r: SessionRuntime) => SessionRuntime) => {
    setRuntimes((current) => ({ ...current, [id]: fn(current[id] ?? EMPTY_RUNTIME) }))
  }, [])

  // Starts (once) history load + the live stream for a session, accumulating
  // into its own runtime. Idempotent — safe to call on every activeId change.
  const ensure = useCallback(
    (id: string) => {
      if (!id || started.current.has(id)) return
      started.current.add(id)
      setRuntimes((current) => ({ ...current, [id]: current[id] ?? EMPTY_RUNTIME }))

      const ctrl = new AbortController()
      ctrls.current.set(id, ctrl)
      void (async () => {
        try {
          const history = await getHistory(id)
          if (ctrl.signal.aborted) return
          if (history.length > 0) update(id, (r) => ({ ...r, thread: seedThread(history) }))
        } catch (err) {
          if (!ctrl.signal.aborted) console.error('getHistory', err)
        }
        if (ctrl.signal.aborted) return
        void streamSession(
          id,
          (event) => {
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
          ctrl.signal,
        ).catch((err) => {
          if (!ctrl.signal.aborted) console.error('streamSession', err)
        })
      })()
    },
    [update],
  )

  const drop = useCallback((id: string) => {
    ctrls.current.get(id)?.abort()
    ctrls.current.delete(id)
    started.current.delete(id)
    setRuntimes((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  useEffect(() => {
    const controllers = ctrls.current
    return () => {
      for (const ctrl of controllers.values()) ctrl.abort()
    }
  }, [])

  const send = useCallback(
    async (id: string, text: string) => {
      if (!id || !text.trim()) return
      update(id, (r) => ({ ...r, thread: appendUserMessage(r.thread, text), working: true }))
      try {
        await sendMessage(id, text)
      } catch (err) {
        console.error('sendMessage', err)
        update(id, (r) => ({ ...r, working: false }))
      }
    },
    [update],
  )

  const decide = useCallback(
    async (id: string, toolUseId: string, decision: ApprovalDecision) => {
      update(id, (r) => ({ ...r, thread: setDecision(r.thread, toolUseId, decision) }))
      try {
        await decideApi(toolUseId, decision === 'allowed')
      } catch (err) {
        console.error('decide', err)
      }
    },
    [update],
  )

  const get = useCallback((id: string | null): SessionRuntime => (id && runtimes[id]) || EMPTY_RUNTIME, [runtimes])

  return { ensure, drop, get, send, decide }
}

function mergeUsage(prev: SessionUsage, event: UsageEvent): SessionUsage {
  return {
    model: event.model ?? prev.model,
    context: {
      usedTokens: event.contextTokens ?? prev.context.usedTokens,
      totalTokens: event.contextWindow ?? prev.context.totalTokens,
    },
    limits: {
      fiveHour: event.fiveHourPct ?? prev.limits.fiveHour,
      sevenDay: event.sevenDayPct ?? prev.limits.sevenDay,
    },
  }
}

import { useCallback, useEffect, useState } from 'react'
import { closeSession, createSession, deleteSession, listSessions, streamAll, UnauthorizedError } from '@/lib/api'
import { sessionFromMeta } from '@/lib/sessionFromMeta'
import type { Session } from '@/types/session'

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [unauthorized, setUnauthorized] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const metas = await listSessions()
      setSessions(metas.map(sessionFromMeta))
      setUnauthorized(false)
    } catch (err) {
      if (err instanceof UnauthorizedError) setUnauthorized(true)
      else console.error('listSessions', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live status from the global channel — keeps every sidebar card current.
  useEffect(() => {
    const ctrl = new AbortController()
    void streamAll((event) => {
      if (event.type !== 'session_status') return
      setSessions((current) =>
        current.map((s) =>
          s.id === event.id ? { ...s, status: event.status, live: event.status !== 'closed' } : s,
        ),
      )
    }, ctrl.signal).catch((err) => {
      if (!ctrl.signal.aborted) console.error('streamAll', err)
    })
    return () => ctrl.abort()
  }, [])

  const create = useCallback(async (): Promise<string | null> => {
    try {
      const meta = await createSession()
      await refresh()
      return meta.id
    } catch (err) {
      console.error('createSession', err)
      return null
    }
  }, [refresh])

  const close = useCallback(
    async (id: string) => {
      await closeSession(id).catch((err) => console.error('closeSession', err))
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteSession(id).catch((err) => console.error('deleteSession', err))
      await refresh()
    },
    [refresh],
  )

  return { sessions, unauthorized, loading, refresh, create, close, remove }
}

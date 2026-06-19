import { useCallback, useEffect, useState } from 'react'
import { closeSession, createSession, deleteSession, listSessions, setPermissionMode, streamAll, UnauthorizedError } from '@/lib/api'
import { sessionFromMeta } from '@/lib/sessionFromMeta'
import type { Session } from '@/types/session'
import type { PermissionMode } from '@/lib/serverTypes'

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load on mount; refresh sets state after the async fetch resolves
    void refresh()
  }, [refresh])

  // Live status from the global channel — keeps every sidebar card current.
  useEffect(() => {
    const ctrl = new AbortController()
    void streamAll({
      onEvent: (event) => {
        if (event.type !== 'session_status') return
        setSessions((current) =>
          current.map((s) =>
            s.id === event.id ? { ...s, status: event.status, live: event.status !== 'closed' } : s,
          ),
        )
      },
      onReconnect: () => void refresh(),
      signal: ctrl.signal,
    }).catch((err) => {
      if (!ctrl.signal.aborted) console.error('streamAll', err)
    })
    return () => ctrl.abort()
  }, [refresh])

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

  const setMode = useCallback(async (id: string, mode: PermissionMode) => {
    setSessions((current) => current.map((s) => (s.id === id ? { ...s, permissionMode: mode } : s)))
    await setPermissionMode(id, mode).catch((err) => console.error('setPermissionMode', err))
  }, [])

  return { sessions, unauthorized, loading, refresh, create, close, remove, setMode }
}

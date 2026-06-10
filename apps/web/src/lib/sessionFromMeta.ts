import type { Session, SessionStatus } from '@/types/session'
import type { SessionMeta } from './serverTypes'

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

function shortTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Maps the backend SessionMeta onto the richer UI Session shape. The backend
 * has no node/snippet concept yet, so those are derived or left blank; status
 * is coarse (live -> idle, closed -> closed) until per-session activity from
 * the stream refines it.
 */
export function sessionFromMeta(meta: SessionMeta): Session {
  const status: SessionStatus = meta.status === 'closed' ? 'closed' : (meta.activity ?? 'idle')
  return {
    id: meta.id,
    title: meta.title,
    node: meta.cwd ? basename(meta.cwd) : 'odin',
    directory: meta.cwd ?? '~',
    updatedAt: shortTime(meta.createdAt),
    snippet: '',
    status,
    live: meta.status === 'live',
  }
}

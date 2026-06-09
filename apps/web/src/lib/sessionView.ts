import type { Session, SessionStatus } from '@/types/session'
import type { SessionFilter, SessionSort, SessionView } from '@/types/sessionView'

export const DEFAULT_SESSION_VIEW: SessionView = { sort: 'recent', filter: 'all' }

const statusOrder: Record<SessionStatus, number> = {
  waiting: 0,
  working: 1,
  idle: 2,
  closed: 3,
}

function matchesFilter(session: Session, filter: SessionFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'live':
      return session.live
    case 'waiting':
      return session.status === 'waiting'
    case 'closed':
      return session.status === 'closed'
  }
}

function compareSessions(a: Session, b: Session, sort: SessionSort): number {
  switch (sort) {
    case 'recent':
      return 0
    case 'name':
      return a.title.localeCompare(b.title)
    case 'node':
      return a.node.localeCompare(b.node)
    case 'status':
      return statusOrder[a.status] - statusOrder[b.status]
  }
}

export function applySessionView(sessions: Session[], view: SessionView): Session[] {
  const filtered = sessions.filter((session) => matchesFilter(session, view.filter))
  if (view.sort === 'recent') {
    return filtered
  }
  return [...filtered].sort((a, b) => compareSessions(a, b, view.sort))
}

export function isDefaultView(view: SessionView): boolean {
  return view.sort === DEFAULT_SESSION_VIEW.sort && view.filter === DEFAULT_SESSION_VIEW.filter
}

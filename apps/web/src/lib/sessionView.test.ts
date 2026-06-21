import { describe, it, expect } from 'vitest'
import { applySessionView, isDefaultView, DEFAULT_SESSION_VIEW } from './sessionView'
import type { Session } from '@/types/session'
import type { SessionView } from '@/types/sessionView'

function session(over: Partial<Session>): Session {
  return {
    id: 'id',
    title: 'title',
    node: 'odin',
    directory: '~',
    updatedAt: '',
    snippet: '',
    status: 'idle',
    live: false,
    permissionMode: 'default',
    ...over,
  }
}

const working = session({ id: 'w', title: 'beta', node: 'zeta', status: 'working', live: true })
const waiting = session({ id: 'a', title: 'alpha', node: 'alpha', status: 'waiting', live: true })
const closed = session({ id: 'c', title: 'gamma', node: 'mid', status: 'closed', live: false })
const all = [closed, working, waiting]

describe('applySessionView filtering', () => {
  it('keeps everything for the all filter', () => {
    expect(applySessionView(all, { sort: 'recent', filter: 'all' })).toHaveLength(3)
  })

  it('keeps only live sessions', () => {
    expect(applySessionView(all, { sort: 'recent', filter: 'live' }).map((s) => s.id)).toEqual(['w', 'a'])
  })

  it('filters by waiting and closed status', () => {
    expect(applySessionView(all, { sort: 'recent', filter: 'waiting' }).map((s) => s.id)).toEqual(['a'])
    expect(applySessionView(all, { sort: 'recent', filter: 'closed' }).map((s) => s.id)).toEqual(['c'])
  })
})

describe('applySessionView sorting', () => {
  it('orders by status priority working < waiting < idle < closed', () => {
    expect(applySessionView(all, { sort: 'status', filter: 'all' }).map((s) => s.id)).toEqual(['w', 'a', 'c'])
  })

  it('orders by title and by node alphabetically', () => {
    expect(applySessionView(all, { sort: 'name', filter: 'all' }).map((s) => s.title)).toEqual(['alpha', 'beta', 'gamma'])
    expect(applySessionView(all, { sort: 'node', filter: 'all' }).map((s) => s.node)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('preserves input order for the recent sort without mutating the input', () => {
    const out = applySessionView(all, { sort: 'recent', filter: 'all' })
    expect(out.map((s) => s.id)).toEqual(['c', 'w', 'a'])
    expect(all.map((s) => s.id)).toEqual(['c', 'w', 'a'])
  })
})

describe('isDefaultView', () => {
  it('is true only for the default sort and filter', () => {
    expect(isDefaultView(DEFAULT_SESSION_VIEW)).toBe(true)
    expect(isDefaultView({ sort: 'name', filter: 'all' } as SessionView)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { sessionFromMeta } from './sessionFromMeta'
import type { SessionMeta } from './serverTypes'

const base: SessionMeta = {
  id: 's1',
  status: 'live',
  title: 'Build',
  createdAt: '2026-06-15T12:00:00Z',
  permissionMode: 'default',
}

describe('sessionFromMeta', () => {
  it('maps core fields straight through', () => {
    const s = sessionFromMeta({ ...base, title: 'Deploy' })
    expect(s.id).toBe('s1')
    expect(s.title).toBe('Deploy')
    expect(s.snippet).toBe('')
  })

  it('derives node from the cwd basename and keeps the directory', () => {
    const s = sessionFromMeta({ ...base, cwd: '/home/odin/tormod/' })
    expect(s.node).toBe('tormod')
    expect(s.directory).toBe('/home/odin/tormod/')
  })

  it('falls back to node "odin" and directory "~" without a cwd', () => {
    const s = sessionFromMeta(base)
    expect(s.node).toBe('odin')
    expect(s.directory).toBe('~')
  })

  it('maps a closed session to closed status and live=false', () => {
    const s = sessionFromMeta({ ...base, status: 'closed', activity: 'working' })
    expect(s.status).toBe('closed')
    expect(s.live).toBe(false)
  })

  it('uses the activity for a live session, defaulting to idle', () => {
    expect(sessionFromMeta({ ...base, activity: 'working' }).status).toBe('working')
    expect(sessionFromMeta(base).status).toBe('idle')
    expect(sessionFromMeta(base).live).toBe(true)
  })

  it('includes usage only when present', () => {
    expect(sessionFromMeta(base).usage).toBeUndefined()
    const withUsage = sessionFromMeta({ ...base, usage: { contextTokens: 100, contextWindow: 200 } })
    expect(withUsage.usage).toEqual({ contextTokens: 100, contextWindow: 200 })
  })

  it('defaults the permission mode and blanks an invalid timestamp', () => {
    const s = sessionFromMeta({ ...base, lastActivityAt: 'not-a-date' })
    expect(s.permissionMode).toBe('default')
    expect(s.updatedAt).toBe('')
  })

  it('formats a valid timestamp into a non-empty label', () => {
    expect(sessionFromMeta({ ...base, lastActivityAt: '2026-06-15T08:30:00Z' }).updatedAt.length).toBeGreaterThan(0)
  })
})

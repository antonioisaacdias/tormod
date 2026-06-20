// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SessionList } from './SessionList'
import type { Session } from '@/types/session'

afterEach(cleanup)

const noop = () => {}
const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  title: 'Sess',
  node: 'odin',
  directory: '~',
  updatedAt: '1',
  snippet: '',
  status: 'idle',
  live: false,
  permissionMode: 'default',
  ...over,
})

describe('SessionList', () => {
  it('renders a row per session and the live count', () => {
    render(
      <SessionList
        sessions={[session({ id: 'a', title: 'Alpha', live: true }), session({ id: 'b', title: 'Beta' })]}
        activeId="a"
        drafts={{}}
        onSelect={noop}
      />,
    )
    expect(screen.getByText('Alpha')).toBeDefined()
    expect(screen.getByText('Beta')).toBeDefined()
    expect(screen.getByText(/1 vivas/)).toBeDefined()
  })

  it('shows the empty-filter message without sessions', () => {
    render(<SessionList sessions={[]} activeId="" drafts={{}} onSelect={noop} />)
    expect(screen.getByText(/Nenhuma sessão/)).toBeDefined()
  })

  it('fires onCreate from the new-session button', () => {
    const onCreate = vi.fn()
    render(<SessionList sessions={[]} activeId="" drafts={{}} onSelect={noop} onCreate={onCreate} />)
    fireEvent.click(screen.getByText(/Nova sessão/))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})

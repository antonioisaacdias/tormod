// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SessionRow } from './SessionRow'
import type { Session } from '@/types/session'

afterEach(cleanup)

const noop = () => {}
const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  title: 'My Session',
  node: 'odin',
  directory: '~',
  updatedAt: '08:30',
  snippet: '',
  status: 'working',
  live: true,
  permissionMode: 'default',
  ...over,
})

describe('SessionRow', () => {
  it('renders the title, node and status label and selects on click', () => {
    const onSelect = vi.fn()
    render(<SessionRow session={session()} active={false} onSelect={onSelect} />)
    expect(screen.getByText('My Session')).toBeDefined()
    expect(screen.getByText('odin')).toBeDefined()
    expect(screen.getByText('trabalhando')).toBeDefined()
    fireEvent.click(screen.getByText('My Session'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows a trimmed draft preview when present', () => {
    render(<SessionRow session={session()} active onSelect={noop} draft="  unsent reply  " />)
    expect(screen.getByText('unsent reply')).toBeDefined()
  })
})

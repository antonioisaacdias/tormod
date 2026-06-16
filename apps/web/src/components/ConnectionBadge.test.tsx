// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ConnectionBadge } from './ConnectionBadge'

afterEach(cleanup)

describe('ConnectionBadge', () => {
  it('shows the latency in the full variant', () => {
    render(<ConnectionBadge latencyMs={50} />)
    expect(screen.getByText('50ms')).toBeDefined()
    expect(screen.getByText(/conectado/)).toBeDefined()
  })

  it('hides the latency in compact mode', () => {
    render(<ConnectionBadge compact />)
    expect(screen.getByText('Claude Code')).toBeDefined()
    expect(screen.queryByText(/ms/)).toBeNull()
  })
})

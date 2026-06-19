// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ConnectionPill } from './ConnectionPill'

afterEach(cleanup)

describe('ConnectionPill', () => {
  it('shows nothing when online', () => {
    const { container } = render(<ConnectionPill connection="open" />)
    expect(container.firstChild).toBeNull()
  })
  it('shows reconnecting when not online', () => {
    render(<ConnectionPill connection="reconnecting" />)
    expect(screen.getByText('reconectando…')).toBeDefined()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Badge } from './Badge'

afterEach(cleanup)

describe('Badge', () => {
  it('renders children in a span with the requested tone', () => {
    render(<Badge tone="danger">alert</Badge>)
    const el = screen.getByText('alert')
    expect(el.tagName).toBe('SPAN')
    expect(el.className).toContain('text-danger')
  })

  it('falls back to the default tone and merges a custom className', () => {
    render(<Badge className="extra">x</Badge>)
    const el = screen.getByText('x')
    expect(el.className).toContain('text-arc')
    expect(el.className).toContain('extra')
  })
})

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { StatusDot } from './StatusDot'

afterEach(cleanup)

const className = (node: ChildNode | null) => (node as HTMLElement).className

describe('StatusDot', () => {
  it('applies the tone class', () => {
    const { container } = render(<StatusDot tone="safe" />)
    expect(className(container.firstChild)).toContain('bg-safe')
  })

  it('adds the pulse animation only when requested', () => {
    expect(className(render(<StatusDot tone="arc" pulse />).container.firstChild)).toContain('animate-pulse')
    cleanup()
    expect(className(render(<StatusDot tone="arc" />).container.firstChild)).not.toContain('animate-pulse')
  })
})

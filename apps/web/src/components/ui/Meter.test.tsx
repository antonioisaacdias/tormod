// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Meter } from './Meter'

afterEach(cleanup)

describe('Meter', () => {
  it('sets the fill width from the value and applies the tone', () => {
    const { container } = render(<Meter value={42} tone="danger" />)
    const fill = container.querySelector('span')
    expect(fill?.style.width).toBe('42%')
    expect(fill?.className).toContain('bg-danger')
  })
})

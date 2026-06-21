// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Button } from './Button'

afterEach(cleanup)

describe('Button', () => {
  it('renders with a variant and forwards clicks', () => {
    const onClick = vi.fn()
    render(
      <Button variant="danger" onClick={onClick}>
        Go
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn.className).toContain('text-danger')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('honors the disabled attribute', () => {
    render(<Button disabled>x</Button>)
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

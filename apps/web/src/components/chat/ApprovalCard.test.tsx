// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ApprovalCard } from './ApprovalCard'

afterEach(cleanup)

const noop = () => {}

describe('ApprovalCard', () => {
  it('offers allow/deny while pending and reports the choice', () => {
    const onDecide = vi.fn()
    render(<ApprovalCard tool="bash" node="odin" command="ls" onDecide={onDecide} />)
    expect(screen.getByText(/quer executar/)).toBeDefined()
    fireEvent.click(screen.getByText(/Permitir/))
    expect(onDecide).toHaveBeenCalledWith('allowed')
    fireEvent.click(screen.getByText(/Negar/))
    expect(onDecide).toHaveBeenCalledWith('denied')
  })

  it('renders the allowed resolution', () => {
    render(<ApprovalCard tool="bash" command="ls" decision="allowed" onDecide={noop} />)
    expect(screen.getByText(/Permitido/)).toBeDefined()
  })

  it('renders the denied resolution', () => {
    render(<ApprovalCard tool="bash" command="ls" decision="denied" onDecide={noop} />)
    expect(screen.getByText(/Negado/)).toBeDefined()
  })
})

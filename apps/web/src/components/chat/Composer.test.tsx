// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Composer } from './Composer'

afterEach(cleanup)

const noop = () => {}

describe('Composer', () => {
  it('reports typing through onChange', () => {
    const onChange = vi.fn()
    render(<Composer value="" onChange={onChange} onSubmit={noop} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } })
    expect(onChange).toHaveBeenCalledWith('hi')
  })

  it('submits on Enter when there is sendable text', () => {
    const onSubmit = vi.fn()
    render(<Composer value="hello" onChange={noop} onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('hello')
  })

  it('does not submit a blank composer', () => {
    const onSubmit = vi.fn()
    render(<Composer value="   " onChange={noop} onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a stop button while working and calls onStop', () => {
    const onStop = vi.fn()
    render(<Composer value="" onChange={noop} onSubmit={noop} working onStop={onStop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Parar' }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})

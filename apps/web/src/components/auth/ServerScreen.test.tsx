// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { setServerUrl, clearServerUrl, validateServerUrl, getStatus } = vi.hoisted(() => ({
  setServerUrl: vi.fn(),
  clearServerUrl: vi.fn(),
  validateServerUrl: vi.fn(),
  getStatus: vi.fn(),
}))

vi.mock('@/lib/platform', () => ({ setServerUrl, clearServerUrl }))
vi.mock('@/lib/request', () => ({ validateServerUrl }))
vi.mock('@/lib/auth', () => ({ getStatus }))

import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ServerScreen } from './ServerScreen'

const noop = () => {}

function type(value: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } })
}
const connect = () => fireEvent.click(screen.getByRole('button', { name: /Conectar/ }))

beforeEach(() => {
  setServerUrl.mockReset()
  clearServerUrl.mockReset()
  validateServerUrl.mockReset()
  getStatus.mockReset()
})
afterEach(cleanup)

describe('ServerScreen', () => {
  it('shows an error for an invalid address and never stores it', () => {
    validateServerUrl.mockReturnValue(null)
    render(<ServerScreen onConnected={noop} />)
    type('bad')
    connect()
    expect(screen.getByText(/inválido/)).toBeDefined()
    expect(setServerUrl).not.toHaveBeenCalled()
  })

  it('stores the url and calls onConnected when the server is reachable', async () => {
    validateServerUrl.mockReturnValue('http://h:1')
    getStatus.mockResolvedValue({})
    const onConnected = vi.fn()
    render(<ServerScreen onConnected={onConnected} />)
    type('http://h:1')
    connect()
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(setServerUrl).toHaveBeenCalledWith('http://h:1')
  })

  it('clears the url and surfaces an error when the server is unreachable', async () => {
    validateServerUrl.mockReturnValue('http://h:1')
    getStatus.mockRejectedValue(new Error('unreachable'))
    render(<ServerScreen onConnected={noop} />)
    type('http://h:1')
    connect()
    await waitFor(() => expect(screen.getByText(/Não foi possível/)).toBeDefined())
    expect(clearServerUrl).toHaveBeenCalledTimes(1)
  })
})

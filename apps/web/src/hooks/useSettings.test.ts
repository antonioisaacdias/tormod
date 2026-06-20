// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getSettingsMock, saveSettingsMock, UnauthorizedError } = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    constructor() {
      super('unauthorized')
      this.name = 'UnauthorizedError'
    }
  }
  return { getSettingsMock: vi.fn(), saveSettingsMock: vi.fn(), UnauthorizedError }
})

vi.mock('@/lib/api', () => ({
  getSettings: getSettingsMock,
  saveSettings: saveSettingsMock,
  UnauthorizedError,
}))

import { renderHook, act, waitFor } from '@testing-library/react'
import { useSettings } from './useSettings'

const settings = { systemPrompt: 'p', maxLiveSessions: 5, idleCloseHours: 12 }

beforeEach(() => {
  getSettingsMock.mockReset()
  saveSettingsMock.mockReset()
})

describe('useSettings', () => {
  it('does not fetch while the drawer is closed', () => {
    const { result } = renderHook(() => useSettings(false))
    expect(getSettingsMock).not.toHaveBeenCalled()
    expect(result.current.settings).toBeNull()
  })

  it('loads settings when opened', async () => {
    getSettingsMock.mockResolvedValue(settings)
    const { result } = renderHook(() => useSettings(true))
    await waitFor(() => expect(result.current.settings).toEqual(settings))
  })

  it('flags unauthorized when the load is rejected with UnauthorizedError', async () => {
    getSettingsMock.mockRejectedValue(new UnauthorizedError())
    const { result } = renderHook(() => useSettings(true))
    await waitFor(() => expect(result.current.unauthorized).toBe(true))
  })

  it('save persists the patch and updates the cached settings', async () => {
    getSettingsMock.mockResolvedValue(settings)
    saveSettingsMock.mockResolvedValue({ ...settings, maxLiveSessions: 9 })
    const { result } = renderHook(() => useSettings(true))
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    await act(async () => {
      await result.current.save({ maxLiveSessions: 9 })
    })
    expect(saveSettingsMock).toHaveBeenCalledWith({ maxLiveSessions: 9 })
    expect(result.current.settings?.maxLiveSessions).toBe(9)
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { isNativePlatformMock } = vi.hoisted(() => ({ isNativePlatformMock: vi.fn(() => false) }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: isNativePlatformMock } }))

import {
  isNative,
  getServerUrl,
  setServerUrl,
  clearServerUrl,
  getToken,
  setToken,
  clearToken,
  apiFetch,
} from './platform'

beforeEach(() => {
  localStorage.clear()
  isNativePlatformMock.mockReturnValue(false)
  vi.unstubAllGlobals()
})

describe('platform storage', () => {
  it('round-trips and clears the server url', () => {
    expect(getServerUrl()).toBeNull()
    setServerUrl('http://h:1')
    expect(getServerUrl()).toBe('http://h:1')
    clearServerUrl()
    expect(getServerUrl()).toBeNull()
  })

  it('round-trips and clears the token', () => {
    setToken('t')
    expect(getToken()).toBe('t')
    clearToken()
    expect(getToken()).toBeNull()
  })
})

describe('isNative', () => {
  it('reflects the Capacitor platform', () => {
    expect(isNative()).toBe(false)
    isNativePlatformMock.mockReturnValue(true)
    expect(isNative()).toBe(true)
  })
})

describe('apiFetch', () => {
  it('throws on native without a configured server url', () => {
    isNativePlatformMock.mockReturnValue(true)
    expect(() => apiFetch('/api/x')).toThrow('serverUrl not configured')
  })

  it('delegates to fetch on web and returns the response', async () => {
    const res = new Response('ok')
    const fetchMock = vi.fn().mockResolvedValue(res)
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/api/x')).resolves.toBe(res)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('targets the configured server url on native', async () => {
    isNativePlatformMock.mockReturnValue(true)
    setServerUrl('http://h:1')
    setToken('tok')
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/x')
    expect(String(fetchMock.mock.calls[0][0])).toContain('http://h:1')
  })
})

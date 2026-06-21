import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store, isNativeMock } = vi.hoisted(() => ({
  store: {} as Record<string, string>,
  isNativeMock: vi.fn(() => false),
}))

vi.mock('./platform', () => ({
  isNative: () => isNativeMock(),
  getServerUrl: () => 'http://h:1',
  getToken: () => store.token ?? null,
  setToken: (t: string) => {
    store.token = t
  },
  clearToken: () => {
    delete store.token
  },
  apiFetch: vi.fn(),
}))

import {
  getStatus,
  register,
  login,
  logout,
  getProfile,
  enrollTotp,
  confirmTotp,
  disableTotp,
  AuthError,
} from './auth'
import * as platform from './platform'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const fail = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const fetchMock = vi.mocked(platform.apiFetch)
const lastInit = () => fetchMock.mock.calls[0][1]
const lastHeaders = () => (lastInit()?.headers ?? {}) as Record<string, string>

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  isNativeMock.mockReturnValue(false)
  fetchMock.mockReset()
})

describe('read endpoints', () => {
  it('getStatus hits /api/auth/status and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(ok({ registered: true }))
    await expect(getStatus()).resolves.toEqual({ registered: true })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/status')
  })

  it('getProfile hits /api/auth/me', async () => {
    fetchMock.mockResolvedValue(ok({ username: 'odin' }))
    await expect(getProfile()).resolves.toEqual({ username: 'odin' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/me')
  })
})

describe('json error handling', () => {
  it('throws AuthError carrying the server message and status', async () => {
    fetchMock.mockResolvedValue(fail(401, { error: 'bad creds' }))
    await expect(login({ username: 'u', password: 'p' })).rejects.toMatchObject({
      name: 'AuthError',
      message: 'bad creds',
      status: 401,
    })
    expect(new AuthError('x', 500)).toBeInstanceOf(Error)
  })

  it('falls back to a generic message when the error body has none', async () => {
    fetchMock.mockResolvedValue(fail(500))
    await expect(getStatus()).rejects.toMatchObject({ message: 'failed: 500', status: 500 })
  })
})

describe('native vs web headers and token side effects', () => {
  it('login on web omits the native client header and never stores a token', async () => {
    fetchMock.mockResolvedValue(ok({ token: 'tok' }))
    await login({ username: 'u', password: 'p' })
    expect(lastHeaders()['X-Tormod-Client']).toBeUndefined()
    expect(platform.getToken()).toBeNull()
  })

  it('register on native sends the native header and stores the returned token', async () => {
    isNativeMock.mockReturnValue(true)
    fetchMock.mockResolvedValue(ok({ token: 'tok-9' }))
    await register({ username: 'u', email: 'e@x.dev', password: 'p' })
    expect(lastHeaders()['X-Tormod-Client']).toBe('native')
    expect(platform.getToken()).toBe('tok-9')
  })

  it('logout clears the token only on native', async () => {
    isNativeMock.mockReturnValue(true)
    store.token = 'live'
    fetchMock.mockResolvedValue(ok({}))
    await logout()
    expect(platform.getToken()).toBeNull()
  })
})

describe('totp endpoints', () => {
  it('enrollTotp returns the enrollment payload', async () => {
    fetchMock.mockResolvedValue(ok({ secret: 's', otpauthUrl: 'otpauth://x', qr: 'data:' }))
    await expect(enrollTotp()).resolves.toMatchObject({ secret: 's' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/totp/enroll')
  })

  it('confirmTotp posts the token', async () => {
    fetchMock.mockResolvedValue(ok({}))
    await confirmTotp('123456')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/totp/confirm')
    expect(JSON.parse(lastInit()?.body as string)).toEqual({ token: '123456' })
  })

  it('disableTotp posts the password', async () => {
    fetchMock.mockResolvedValue(ok({}))
    await disableTotp('pw')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/totp/disable')
    expect(JSON.parse(lastInit()?.body as string)).toEqual({ password: 'pw' })
  })
})

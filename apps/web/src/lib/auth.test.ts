import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./platform', () => {
  const store: Record<string, string> = {}
  return {
    isNative: () => true,
    getServerUrl: () => 'http://h:1',
    getToken: () => store.token ?? null,
    setToken: (t: string) => { store.token = t },
    clearToken: () => { delete store.token },
    apiFetch: vi.fn(),
  }
})

import { login } from './auth'
import * as platform from './platform'

beforeEach(() => {
  platform.clearToken()
  vi.mocked(platform.apiFetch).mockReset()
})

describe('native login', () => {
  it('sends X-Tormod-Client: native and stores the returned token', async () => {
    vi.mocked(platform.apiFetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, token: 'tok-123' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    await login({ username: 'u', password: 'p' })
    const [, init] = vi.mocked(platform.apiFetch).mock.calls[0]
    expect((init?.headers as Record<string, string>)['X-Tormod-Client']).toBe('native')
    expect(platform.getToken()).toBe('tok-123')
  })
})

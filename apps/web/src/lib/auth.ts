import { apiFetch, isNative, setToken, clearToken } from './platform'
import type { AuthStatus, AuthProfile, TotpEnrollment } from './serverTypes'

const MUT: HeadersInit = { 'Content-Type': 'application/json', 'X-Tormod': '1' }

function authHeaders(): HeadersInit {
  return isNative() ? { ...MUT, 'X-Tormod-Client': 'native' } : MUT
}

export class AuthError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new AuthError(body.error ?? `failed: ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export async function getStatus(): Promise<AuthStatus> {
  return json(await apiFetch('/api/auth/status'))
}

export async function register(body: { username: string; email: string; password: string }): Promise<void> {
  const parsed = await json<{ token?: string }>(
    await apiFetch('/api/auth/register', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  )
  if (isNative() && parsed.token) setToken(parsed.token)
}

export async function login(body: { username: string; password: string; totp?: string }): Promise<void> {
  const parsed = await json<{ token?: string }>(
    await apiFetch('/api/auth/login', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  )
  if (isNative() && parsed.token) setToken(parsed.token)
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST', headers: MUT })
  clearToken()
}

export async function getProfile(): Promise<AuthProfile> {
  return json(await apiFetch('/api/auth/me'))
}

export async function enrollTotp(): Promise<TotpEnrollment> {
  return json(await apiFetch('/api/auth/totp/enroll', { method: 'POST', headers: MUT }))
}

export async function confirmTotp(token: string): Promise<void> {
  await json(await apiFetch('/api/auth/totp/confirm', { method: 'POST', headers: MUT, body: JSON.stringify({ token }) }))
}

export async function disableTotp(password: string): Promise<void> {
  await json(await apiFetch('/api/auth/totp/disable', { method: 'POST', headers: MUT, body: JSON.stringify({ password }) }))
}

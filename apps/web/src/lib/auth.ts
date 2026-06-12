import type { AuthStatus, AuthProfile, TotpEnrollment } from './serverTypes'

const MUT: HeadersInit = { 'Content-Type': 'application/json', 'X-Tormod': '1' }

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
  return json(await fetch('/api/auth/status', { credentials: 'include' }))
}

export async function register(body: { username: string; email: string; password: string }): Promise<void> {
  await json(await fetch('/api/auth/register', { method: 'POST', headers: MUT, credentials: 'include', body: JSON.stringify(body) }))
}

export async function login(body: { username: string; password: string; totp?: string }): Promise<void> {
  await json(await fetch('/api/auth/login', { method: 'POST', headers: MUT, credentials: 'include', body: JSON.stringify(body) }))
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: MUT, credentials: 'include' })
}

export async function getProfile(): Promise<AuthProfile> {
  return json(await fetch('/api/auth/me', { credentials: 'include' }))
}

export async function enrollTotp(): Promise<TotpEnrollment> {
  return json(await fetch('/api/auth/totp/enroll', { method: 'POST', headers: MUT, credentials: 'include' }))
}

export async function confirmTotp(token: string): Promise<void> {
  await json(await fetch('/api/auth/totp/confirm', { method: 'POST', headers: MUT, credentials: 'include', body: JSON.stringify({ token }) }))
}

export async function disableTotp(password: string): Promise<void> {
  await json(await fetch('/api/auth/totp/disable', { method: 'POST', headers: MUT, credentials: 'include', body: JSON.stringify({ password }) }))
}

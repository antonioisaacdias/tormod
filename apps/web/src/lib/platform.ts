import { Capacitor } from '@capacitor/core'
import { buildRequest } from './request'

const SERVER_KEY = 'tormod:serverUrl'
const TOKEN_KEY = 'tormod:token'

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export function getServerUrl(): string | null {
  return localStorage.getItem(SERVER_KEY)
}

export function setServerUrl(url: string): void {
  localStorage.setItem(SERVER_KEY, url)
}

export function clearServerUrl(): void {
  localStorage.removeItem(SERVER_KEY)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (isNative() && !getServerUrl()) throw new Error('serverUrl not configured')
  const { url, init: built } = buildRequest(path, init, {
    native: isNative(),
    serverUrl: getServerUrl(),
    token: getToken(),
  })
  return fetch(url, built)
}

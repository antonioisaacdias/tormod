export interface PlatformCtx {
  native: boolean
  serverUrl: string | null
  token: string | null
}

export function buildRequest(path: string, init: RequestInit, ctx: PlatformCtx): { url: string; init: RequestInit } {
  const base = ctx.native && ctx.serverUrl ? ctx.serverUrl : ''
  const headers: Record<string, string> = { ...((init.headers as Record<string, string> | undefined) ?? {}) }
  if (ctx.native && ctx.token) headers.Authorization = `Bearer ${ctx.token}`
  return {
    url: `${base}${path}`,
    init: { ...init, headers, credentials: ctx.native ? 'omit' : 'include' },
  }
}

export function validateServerUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/.+/.test(trimmed)) return null
  try {
    const u = new URL(trimmed)
    return u.hostname ? trimmed : null
  } catch {
    return null
  }
}

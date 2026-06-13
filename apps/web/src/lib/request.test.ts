import { describe, it, expect } from 'vitest'
import { buildRequest, validateServerUrl } from './request'

describe('buildRequest', () => {
  it('web mode: relative path, cookie credentials, no auth header', () => {
    const { url, init } = buildRequest('/api/sessions', { headers: { 'X-Tormod': '1' } }, { native: false, serverUrl: null, token: null })
    expect(url).toBe('/api/sessions')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('native mode: absolute URL, omit credentials, bearer header', () => {
    const { url, init } = buildRequest('/api/sessions', {}, { native: true, serverUrl: 'http://10.0.0.10:8080', token: 'abc' })
    expect(url).toBe('http://10.0.0.10:8080/api/sessions')
    expect(init.credentials).toBe('omit')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc')
  })

  it('native without a token sends no auth header', () => {
    const { init } = buildRequest('/api/auth/status', {}, { native: true, serverUrl: 'http://h:1', token: null })
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('preserves caller-supplied headers', () => {
    const { init } = buildRequest('/api/x', { headers: { 'Content-Type': 'application/json' } }, { native: true, serverUrl: 'http://h:1', token: 't' })
    const h = init.headers as Record<string, string>
    expect(h['Content-Type']).toBe('application/json')
    expect(h.Authorization).toBe('Bearer t')
  })
})

describe('validateServerUrl', () => {
  it('accepts and normalizes a valid http url (strips trailing slash)', () => {
    expect(validateServerUrl('  http://10.0.0.10:8080/ ')).toBe('http://10.0.0.10:8080')
  })
  it('accepts https', () => {
    expect(validateServerUrl('https://tormod.example')).toBe('https://tormod.example')
  })
  it('rejects a url without scheme', () => {
    expect(validateServerUrl('10.0.0.10:8080')).toBeNull()
  })
  it('rejects garbage', () => {
    expect(validateServerUrl('not a url')).toBeNull()
  })
})

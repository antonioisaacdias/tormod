import { describe, it, expect } from 'vitest'
import { formatTokens } from './formatTokens'

describe('formatTokens', () => {
  it('returns the raw number below 1000', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })

  it('rounds to thousands with a k suffix at or above 1000', () => {
    expect(formatTokens(1000)).toBe('1k')
    expect(formatTokens(1499)).toBe('1k')
    expect(formatTokens(1500)).toBe('2k')
    expect(formatTokens(12_300)).toBe('12k')
  })
})

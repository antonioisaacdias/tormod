import { describe, it, expect } from 'vitest'
import { usageTone } from './usageTone'

describe('usageTone', () => {
  it('is danger at or above 90', () => {
    expect(usageTone(90)).toBe('danger')
    expect(usageTone(100)).toBe('danger')
  })

  it('is approve in the 70-89 band', () => {
    expect(usageTone(70)).toBe('approve')
    expect(usageTone(89)).toBe('approve')
  })

  it('is arc below 70', () => {
    expect(usageTone(0)).toBe('arc')
    expect(usageTone(69)).toBe('arc')
  })
})

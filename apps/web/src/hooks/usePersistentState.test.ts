// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePersistentState } from './usePersistentState'

beforeEach(() => localStorage.clear())

describe('usePersistentState', () => {
  it('initializes from the fallback when nothing is stored', () => {
    const { result } = renderHook(() => usePersistentState('k', 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })

  it('hydrates from a stored JSON value', () => {
    localStorage.setItem('k', JSON.stringify({ n: 1 }))
    const { result } = renderHook(() => usePersistentState('k', { n: 0 }))
    expect(result.current[0]).toEqual({ n: 1 })
  })

  it('falls back when the stored value is invalid JSON', () => {
    localStorage.setItem('k', '{not json')
    const { result } = renderHook(() => usePersistentState('k', 42))
    expect(result.current[0]).toBe(42)
  })

  it('persists updates back to localStorage', () => {
    const { result } = renderHook(() => usePersistentState<string>('k', 'a'))
    act(() => result.current[1]('b'))
    expect(result.current[0]).toBe('b')
    expect(localStorage.getItem('k')).toBe(JSON.stringify('b'))
  })
})

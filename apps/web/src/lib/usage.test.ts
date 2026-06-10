import { describe, it, expect } from 'vitest'
import { INITIAL_USAGE, mergeUsage, type UsageEvent } from './usage'

function fold(events: UsageEvent[]) {
  return events.reduce(mergeUsage, INITIAL_USAGE)
}

describe('mergeUsage', () => {
  it('applies the model from an init-style event, keeping context/limits', () => {
    const u = mergeUsage(INITIAL_USAGE, { model: 'claude-opus-4-8[1m]' })
    expect(u.model).toBe('claude-opus-4-8[1m]')
    expect(u.context).toEqual(INITIAL_USAGE.context)
    expect(u.limits).toEqual(INITIAL_USAGE.limits)
  })

  it('applies context tokens/window from a result-style event', () => {
    const u = mergeUsage(INITIAL_USAGE, { contextTokens: 32931, contextWindow: 1_000_000 })
    expect(u.context).toEqual({ usedTokens: 32931, totalTokens: 1_000_000 })
  })

  it('applies 5h/7d rate-limit percentages independently', () => {
    const u = fold([{ fiveHourPct: 50 }, { sevenDayPct: 20 }])
    expect(u.limits).toEqual({ fiveHour: 50, sevenDay: 20 })
  })

  it('folds a full session sequence into the final usage', () => {
    const u = fold([
      { model: 'claude-opus-4-8[1m]' }, // init
      { fiveHourPct: 12 }, // rate_limit_event
      { model: 'claude-opus-4-8[1m]', contextTokens: 45000, contextWindow: 1_000_000 }, // result
    ])
    expect(u).toEqual({
      model: 'claude-opus-4-8[1m]',
      context: { usedTokens: 45000, totalTokens: 1_000_000 },
      limits: { fiveHour: 12, sevenDay: 0 },
    })
  })

  it('a partial event never clobbers previously-set fields', () => {
    const withCtx = mergeUsage(INITIAL_USAGE, { contextTokens: 100, contextWindow: 200 })
    const afterModelOnly = mergeUsage(withCtx, { model: 'x' })
    expect(afterModelOnly.context).toEqual({ usedTokens: 100, totalTokens: 200 })
    expect(afterModelOnly.model).toBe('x')
  })
})

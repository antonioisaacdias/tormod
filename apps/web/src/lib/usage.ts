import type { RateLimits, SessionUsage } from '@/types/usage'

export interface UsageEvent {
  model?: string
  contextTokens?: number
  contextWindow?: number
  fiveHourPct?: number
  sevenDayPct?: number
}

export const INITIAL_USAGE: SessionUsage = {
  model: 'claude code',
  context: { usedTokens: 0, totalTokens: 200_000 },
  limits: {},
}

/**
 * Folds a partial usage event over the current usage; absent fields are kept.
 * Rate-limit windows stay undefined until an adapter supplies them, so the
 * infoline can hide periods the brain doesn't report instead of mocking 0%.
 */
export function mergeUsage(prev: SessionUsage, event: UsageEvent): SessionUsage {
  const limits: RateLimits = { ...prev.limits }
  if (event.fiveHourPct !== undefined) limits.fiveHour = event.fiveHourPct
  if (event.sevenDayPct !== undefined) limits.sevenDay = event.sevenDayPct
  return {
    model: event.model ?? prev.model,
    context: {
      usedTokens: event.contextTokens ?? prev.context.usedTokens,
      totalTokens: event.contextWindow ?? prev.context.totalTokens,
    },
    limits,
  }
}

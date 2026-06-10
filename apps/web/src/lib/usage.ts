import type { SessionUsage } from '@/types/usage'

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
  limits: { fiveHour: 0, sevenDay: 0 },
}

/** Folds a partial usage event over the current usage; absent fields are kept. */
export function mergeUsage(prev: SessionUsage, event: UsageEvent): SessionUsage {
  return {
    model: event.model ?? prev.model,
    context: {
      usedTokens: event.contextTokens ?? prev.context.usedTokens,
      totalTokens: event.contextWindow ?? prev.context.totalTokens,
    },
    limits: {
      fiveHour: event.fiveHourPct ?? prev.limits.fiveHour,
      sevenDay: event.sevenDayPct ?? prev.limits.sevenDay,
    },
  }
}

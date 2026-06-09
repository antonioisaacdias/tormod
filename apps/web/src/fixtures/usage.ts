import type { SessionUsage } from '@/types/usage'

export const sessionUsage: SessionUsage = {
  model: 'opus',
  context: { usedTokens: 82000, totalTokens: 200000 },
  limits: { fiveHour: 23, sevenDay: 14 },
}

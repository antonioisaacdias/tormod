export interface ContextWindow {
  usedTokens: number
  totalTokens: number
}

export interface RateLimits {
  fiveHour: number
  sevenDay: number
}

export interface SessionUsage {
  model: string
  context: ContextWindow
  limits: RateLimits
}

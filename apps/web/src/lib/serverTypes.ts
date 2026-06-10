// Wire contract mirrored from apps/server (no shared package yet). Keep in sync
// with src/session/manager.ts (SessionMeta), src/brain/adapter.ts (BrainEvent),
// and src/session/events.ts (ServerEvent).

export type Tier = 'auto' | 'approve' | 'deny'

export interface ToolRequest {
  tool: string
  input: Record<string, unknown>
}

export interface SessionMeta {
  id: string
  status: 'live' | 'closed'
  title: string
  cwd?: string
  createdAt: string
  lastActivityAt?: string
  activity?: 'idle' | 'working' | 'waiting'
}

export type SessionActivity = 'idle' | 'working' | 'waiting' | 'closed'

export type GlobalEvent = { type: 'session_status'; id: string; status: SessionActivity }

export type BrainEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; request: ToolRequest }
  | { type: 'tool_result'; id: string; ok: boolean; summary: string }
  | { type: 'result'; ok: boolean; costUsd?: number }
  | { type: 'usage'; model?: string; contextTokens?: number; contextWindow?: number; fiveHourPct?: number; sevenDayPct?: number }
  | { type: 'error'; message: string }

export type ServerEvent =
  | BrainEvent
  | { type: 'permission_request'; toolUseId: string; request: ToolRequest; tier: Tier; literal?: string }
  | { type: 'permission_resolved'; toolUseId: string; allow: boolean }

export type HistoryItem =
  | { role: 'user'; text: string }
  | { role: 'brain'; text: string }
  | { role: 'tool'; tool: string; input: Record<string, unknown> }

export interface Settings {
  maxLiveSessions: number
  idleCloseHours: number
  defaultModel: 'auto' | 'opus' | 'sonnet' | 'haiku'
  defaultEffort: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  systemPrompt: string
}

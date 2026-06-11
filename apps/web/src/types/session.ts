import type { PermissionMode, UsageSnapshot } from '@/lib/serverTypes'

export type SessionStatus = 'waiting' | 'working' | 'idle' | 'closed'

export interface Session {
  id: string
  title: string
  node: string
  directory: string
  updatedAt: string
  snippet: string
  status: SessionStatus
  live: boolean
  usage?: UsageSnapshot
  permissionMode: PermissionMode
}

export type SessionSort = 'recent' | 'name' | 'node' | 'status'

export type SessionFilter = 'all' | 'live' | 'waiting' | 'closed'

export interface SessionView {
  sort: SessionSort
  filter: SessionFilter
}

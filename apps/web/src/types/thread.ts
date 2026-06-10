export type InlineTone = 'plain' | 'mono' | 'ok'

export interface InlineSegment {
  text: string
  tone?: InlineTone
}

export type ToolTier = 'auto' | 'executed'

export type MessageAuthor = 'user' | 'brain'

/** An entry inside the collapsible "work" balloon (thinking + tooling). */
export type WorkEntry =
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; tool: string; command: string; detail?: string }

interface ThreadItemBase {
  id: string
  gatedBy?: string
}

export type ThreadItem = ThreadItemBase &
  (
    | { kind: 'day'; label: string }
    | { kind: 'message'; author: MessageAuthor; segments: InlineSegment[] }
    | { kind: 'work'; entries: WorkEntry[]; done: boolean; seeded?: boolean }
    | { kind: 'approval'; tool: string; node?: string; command: string }
  )

export type ApprovalDecision = 'allowed' | 'denied'

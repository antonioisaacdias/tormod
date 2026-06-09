export type InlineTone = 'plain' | 'mono' | 'ok'

export interface InlineSegment {
  text: string
  tone?: InlineTone
}

export type ToolTier = 'auto' | 'executed'

export type MessageAuthor = 'user' | 'brain'

interface ThreadItemBase {
  id: string
  gatedBy?: string
}

export type ThreadItem = ThreadItemBase &
  (
    | { kind: 'day'; label: string }
    | { kind: 'message'; author: MessageAuthor; segments: InlineSegment[] }
    | { kind: 'tool'; name: string; command: string; tier: ToolTier }
    | { kind: 'approval'; tool: string; node?: string; command: string }
  )

export type ApprovalDecision = 'allowed' | 'denied'

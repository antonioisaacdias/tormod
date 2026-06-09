import type { SessionStatus } from '@/types/session'
import type { Tone } from '@/types/tone'

interface StatusPresentation {
  tone: Tone
  label: string
}

const presentations: Record<SessionStatus, StatusPresentation> = {
  waiting: { tone: 'approve', label: 'aguardando' },
  working: { tone: 'arc', label: 'trabalhando' },
  idle: { tone: 'faint', label: 'ocioso' },
  closed: { tone: 'faint', label: 'fechada' },
}

export function statusPresentation(status: SessionStatus): StatusPresentation {
  return presentations[status]
}

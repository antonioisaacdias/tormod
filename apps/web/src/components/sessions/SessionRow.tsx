import { PencilLine } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toneText } from '@/lib/toneClass'
import { statusPresentation } from '@/lib/sessionStatus'
import { StatusDot } from '@/components/ui/StatusDot'
import { SessionActionsMenu, type SessionAction } from './SessionActionsMenu'
import type { Session } from '@/types/session'

interface SessionRowProps {
  session: Session
  active: boolean
  draft?: string
  onSelect: () => void
  onAction?: (action: SessionAction) => void
}

export function SessionRow({ session, active, draft, onSelect, onAction }: SessionRowProps) {
  const { tone, label } = statusPresentation(session.status)
  const draftPreview = draft?.trim()

  return (
    <div
      className={cn(
        'relative rounded-xl border border-transparent transition-colors',
        active ? 'border-arc/30 bg-arc/12' : 'hover:bg-surface',
      )}
    >
      <button onClick={onSelect} className="flex w-full items-start gap-2.5 p-2.5 pr-9 text-left">
        <StatusDot tone={tone} pulse={session.live} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-frost">{session.title}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
            <span className="font-mono text-arc">{session.node}</span>
            <span>·</span>
            <span>{session.updatedAt}</span>
            <span className={cn('ml-auto font-medium', toneText[tone])}>{label}</span>
          </div>
          {draftPreview && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-mist">
              <PencilLine className="size-3 shrink-0 text-arc" />
              <span className="truncate">{draftPreview}</span>
            </div>
          )}
        </div>
      </button>
      <div className="absolute right-1.5 top-1.5">
        <SessionActionsMenu session={session} onAction={onAction} />
      </div>
    </div>
  )
}

import { cn } from '@/lib/cn'
import { toneText } from '@/lib/toneClass'
import { statusPresentation } from '@/lib/sessionStatus'
import { StatusDot } from '@/components/ui/StatusDot'
import type { Session } from '@/types/session'

interface SessionRowProps {
  session: Session
  active: boolean
  onSelect: () => void
}

export function SessionRow({ session, active, onSelect }: SessionRowProps) {
  const { tone, label } = statusPresentation(session.status)
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-xl border border-transparent p-2.5 text-left transition-colors',
        active ? 'border-arc/30 bg-arc/12' : 'hover:bg-surface',
      )}
    >
      <StatusDot tone={tone} pulse={session.live} className="mt-1" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-frost">{session.title}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
          <span className="font-mono text-arc">{session.node}</span>
          <span>·</span>
          <span>{session.updatedAt}</span>
          <span className={cn('ml-auto font-medium', toneText[tone])}>{label}</span>
        </div>
      </div>
    </button>
  )
}

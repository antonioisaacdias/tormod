import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SessionRow } from './SessionRow'
import type { Session } from '@/types/session'

interface SessionListProps {
  sessions: Session[]
  activeId: string
  onSelect: (id: string) => void
}

export function SessionList({ sessions, activeId, onSelect }: SessionListProps) {
  const liveCount = sessions.filter((session) => session.live).length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2.5 flex items-center justify-between px-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">
        <span>Sessões</span>
        <span className="font-medium normal-case text-faint">
          {sessions.length} · {liveCount} vivas
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin">
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            active={session.id === activeId}
            onSelect={() => onSelect(session.id)}
          />
        ))}
      </div>
      <Button className="mt-3 w-full">
        <Plus className="size-4" /> Nova sessão
      </Button>
    </div>
  )
}

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { applySessionView, DEFAULT_SESSION_VIEW } from '@/lib/sessionView'
import { SessionRow } from './SessionRow'
import { SessionFilterMenu } from './SessionFilterMenu'
import { SessionSearch } from './SessionSearch'
import type { SessionAction } from './SessionActionsMenu'
import type { Session } from '@/types/session'

interface SessionListProps {
  sessions: Session[]
  activeId: string
  drafts: Record<string, string>
  onSelect: (id: string) => void
  onCreate?: () => void
  onSessionAction?: (id: string, action: SessionAction) => void
}

export function SessionList({ sessions, activeId, drafts, onSelect, onCreate, onSessionAction }: SessionListProps) {
  const [view, setView] = useState(DEFAULT_SESSION_VIEW)
  const visible = applySessionView(sessions, view)
  const liveCount = sessions.filter((session) => session.live).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 px-1.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <ConnectionBadge compact />
          <span className="shrink-0 text-[11px] font-medium text-faint">
            {visible.length} · {liveCount} vivas
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SessionSearch className="min-w-0 flex-1" />
          <SessionFilterMenu view={view} onChange={setView} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin">
        {visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-faint">Nenhuma sessão neste filtro.</p>
        ) : (
          visible.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={session.id === activeId}
              draft={drafts[session.id]}
              onSelect={() => onSelect(session.id)}
              onAction={(action) => onSessionAction?.(session.id, action)}
            />
          ))
        )}
      </div>

      <Button className="mt-3 w-full" onClick={onCreate}>
        <Plus className="size-4" /> Nova sessão
      </Button>
    </div>
  )
}

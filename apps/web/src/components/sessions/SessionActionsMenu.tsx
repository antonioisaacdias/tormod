import { useState } from 'react'
import { CircleStop, MoreVertical, Pencil, Play, Trash2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import type { Session } from '@/types/session'

export type SessionAction = 'close' | 'resume' | 'rename' | 'delete'

interface ActionItem {
  action: SessionAction
  label: string
  icon: LucideIcon
  danger?: boolean
}

interface SessionActionsMenuProps {
  session: Session
  onAction?: (action: SessionAction) => void
}

export function SessionActionsMenu({ session, onAction }: SessionActionsMenuProps) {
  const [open, setOpen] = useState(false)

  const items: ActionItem[] = [
    session.live
      ? { action: 'close', label: 'Fechar', icon: CircleStop }
      : { action: 'resume', label: 'Retomar', icon: Play },
    { action: 'rename', label: 'Renomear', icon: Pencil },
    { action: 'delete', label: 'Excluir', icon: Trash2, danger: true },
  ]

  function run(action: SessionAction) {
    onAction?.(action)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Ações da sessão"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-raised hover:text-frost data-[state=open]:bg-raised data-[state=open]:text-frost"
      >
        <MoreVertical className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1.5">
        {items.map((item) => (
          <button
            key={item.action}
            onClick={() => run(item.action)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
              item.danger
                ? 'text-danger hover:bg-danger/12'
                : 'text-mist hover:bg-raised hover:text-frost',
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

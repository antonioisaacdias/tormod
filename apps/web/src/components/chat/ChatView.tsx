import { ChevronLeft, Cpu } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toneText } from '@/lib/toneClass'
import { statusPresentation } from '@/lib/sessionStatus'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { Thread } from './Thread'
import { Composer } from './Composer'
import { StatusLine } from './StatusLine'
import { useThreadDecisions } from './useThreadDecisions'
import type { Session } from '@/types/session'
import type { SessionUsage } from '@/types/usage'
import type { ThreadItem } from '@/types/thread'

interface ChatViewProps {
  session: Session
  items: ThreadItem[]
  usage: SessionUsage
  onBack: () => void
}

export function ChatView({ session, items, usage, onBack }: ChatViewProps) {
  const { decisions, decide } = useThreadDecisions()
  const status = statusPresentation(session.status)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-ink">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3.5 lg:px-6">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Voltar" className="lg:hidden">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot tone={status.tone} pulse={session.live} />
            <span className="truncate text-base font-bold text-frost">{session.title}</span>
            <span className={cn('text-[11px] font-medium', toneText[status.tone])}>{status.label}</span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-faint">
            {session.id} · {session.node} · {session.directory}
          </div>
        </div>
        <Badge tone="arc" size="md" className="hidden shrink-0 sm:inline-flex">
          <Cpu className="size-3" /> cérebro: Claude Code
        </Badge>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none px-4 py-5 lg:px-6">
        <Thread items={items} decisions={decisions} onDecide={decide} />
      </div>

      <div className="shrink-0 border-t border-border px-4 pb-3.5 pt-3 lg:px-6">
        <StatusLine usage={usage} />
        <Composer placeholder={`Responder ao Claude Code na sessão ${session.node}…`} />
      </div>
    </div>
  )
}

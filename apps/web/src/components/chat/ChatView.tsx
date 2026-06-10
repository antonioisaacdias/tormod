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
import type { Session } from '@/types/session'
import type { SessionUsage } from '@/types/usage'
import type { ApprovalDecision, ThreadItem } from '@/types/thread'

interface ChatViewProps {
  session: Session
  items: ThreadItem[]
  usage: SessionUsage
  decisions: Record<string, ApprovalDecision>
  working: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: (text: string) => void
  onDecide: (toolUseId: string, decision: ApprovalDecision) => void
  onBack: () => void
}

export function ChatView({
  session,
  items,
  usage,
  decisions,
  working,
  draft,
  onDraftChange,
  onSend,
  onDecide,
  onBack,
}: ChatViewProps) {
  const status = statusPresentation(working ? 'working' : session.status)

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
        <Thread items={items} decisions={decisions} working={working} onDecide={onDecide} />
      </div>

      <div className="shrink-0 border-t border-border px-4 pb-3.5 pt-3 lg:px-6">
        <StatusLine usage={usage} />
        <Composer
          value={draft}
          onChange={onDraftChange}
          onSubmit={onSend}
          placeholder={`Responder ao Claude Code na sessão ${session.node}…`}
        />
      </div>
    </div>
  )
}

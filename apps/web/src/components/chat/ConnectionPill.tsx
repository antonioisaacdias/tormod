import { Loader2 } from 'lucide-react'
import type { ConnectionStatus } from '@/lib/api'

interface ConnectionPillProps {
  connection: ConnectionStatus
}

export function ConnectionPill({ connection }: ConnectionPillProps) {
  if (connection === 'open') return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-ink px-2 py-0.5 text-[11px] font-medium text-faint">
      <Loader2 className="size-3 animate-spin" />
      reconectando…
    </span>
  )
}

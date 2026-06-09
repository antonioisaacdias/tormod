import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import type { ToolTier } from '@/types/thread'

interface ToolCallProps {
  name: string
  command: string
  tier: ToolTier
}

export function ToolCall({ name, command, tier }: ToolCallProps) {
  const executed = tier === 'executed'
  return (
    <div
      className={cn(
        'mb-3.5 flex items-center gap-2.5 rounded-xl border-l-2 bg-deep py-2.5 pl-3.5 pr-3 ring-1 ring-border',
        executed ? 'border-l-arc' : 'border-l-safe',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-semibold text-arc">{name}</div>
        <div className="mt-0.5 break-all font-mono text-xs text-[#c3cfdd]">{command}</div>
      </div>
      <Badge tone={executed ? 'arc' : 'safe'} className="uppercase tracking-wide">
        {executed ? 'executado' : 'leitura · auto'}
      </Badge>
    </div>
  )
}

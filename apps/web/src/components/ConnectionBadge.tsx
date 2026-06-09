import { StatusDot } from '@/components/ui/StatusDot'

interface ConnectionBadgeProps {
  latencyMs?: number
  compact?: boolean
}

export function ConnectionBadge({ latencyMs = 12, compact = false }: ConnectionBadgeProps) {
  return (
    <span className="inline-flex items-center gap-2 self-start rounded-full bg-surface px-3 py-1.5 text-[11px] text-mist ring-1 ring-border">
      <StatusDot tone="safe" pulse />
      {compact ? (
        <span className="font-mono text-frost">Claude Code</span>
      ) : (
        <span>
          Claude Code conectado · <span className="font-mono text-frost">{latencyMs}ms</span>
        </span>
      )}
    </span>
  )
}

import { Cpu } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Meter } from '@/components/ui/Meter'
import { formatTokens } from '@/lib/formatTokens'
import { usageTone } from '@/lib/usageTone'
import type { SessionUsage } from '@/types/usage'

function Divider() {
  return <span className="hidden h-3.5 w-px bg-border sm:block" />
}

interface MetricProps {
  label: string
  percentage: number
  detail?: string
  meterClassName?: string
}

function Metric({ label, percentage, detail, meterClassName = 'w-14' }: MetricProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium text-mist">{label}</span>
      <Meter value={percentage} tone={usageTone(percentage)} className={meterClassName} />
      <span className="font-mono text-frost">{percentage}%</span>
      {detail && <span className="font-mono text-faint">{detail}</span>}
    </div>
  )
}

interface StatusLineProps {
  usage: SessionUsage
}

export function StatusLine({ usage }: StatusLineProps) {
  const { context, limits } = usage
  const contextPercentage = Math.round((context.usedTokens / context.totalTokens) * 100)
  const contextDetail = `${formatTokens(context.usedTokens)}/${formatTokens(context.totalTokens)}`
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 pb-2.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        <Cpu className="size-3.5 text-arc" />
        <span className="font-mono font-medium text-frost">{usage.model}</span>
      </div>
      <Divider />
      <Metric label="ctx" percentage={contextPercentage} detail={contextDetail} />
      <Divider />
      <Metric label="5h" percentage={limits.fiveHour} meterClassName="w-10" />
      <Divider />
      <Metric label="7d" percentage={limits.sevenDay} meterClassName="w-10" />
      <Divider />
      <Badge tone="safe">leitura: auto</Badge>
    </div>
  )
}

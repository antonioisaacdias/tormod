import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const fill = cva('block h-full rounded-full', {
  variants: {
    tone: {
      arc: 'bg-arc',
      safe: 'bg-safe',
      approve: 'bg-approve',
      danger: 'bg-danger',
    },
  },
  defaultVariants: {
    tone: 'arc',
  },
})

interface MeterProps extends VariantProps<typeof fill> {
  value: number
  className?: string
}

export function Meter({ value, tone, className }: MeterProps) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-raised', className)}>
      <span className={fill({ tone })} style={{ width: `${value}%` }} />
    </div>
  )
}

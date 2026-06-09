import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badge = cva(
  'inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        safe: 'text-safe bg-safe/15',
        approve: 'text-approve bg-approve/15',
        arc: 'text-arc bg-arc/12',
        danger: 'text-danger bg-danger/15',
        neutral: 'text-mist bg-surface ring-1 ring-border',
      },
      size: {
        sm: 'px-2 py-1 text-[10.5px]',
        md: 'px-2.5 py-1.5 text-[11px]',
      },
    },
    defaultVariants: {
      tone: 'arc',
      size: 'sm',
    },
  },
)

interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badge> {}

export function Badge({ tone, size, className, ...props }: BadgeProps) {
  return <span className={cn(badge({ tone, size }), className)} {...props} />
}

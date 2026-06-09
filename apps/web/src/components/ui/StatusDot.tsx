import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const statusDot = cva('inline-block size-2 rounded-full', {
  variants: {
    tone: {
      safe: 'bg-safe shadow-[0_0_8px_var(--color-safe)]',
      approve: 'bg-approve shadow-[0_0_8px_var(--color-approve)]',
      arc: 'bg-arc shadow-[0_0_8px_var(--color-arc)]',
      danger: 'bg-danger shadow-[0_0_8px_var(--color-danger)]',
      faint: 'bg-faint',
    },
    pulse: {
      true: 'animate-pulse',
      false: '',
    },
  },
  defaultVariants: {
    tone: 'arc',
    pulse: false,
  },
})

interface StatusDotProps extends VariantProps<typeof statusDot> {
  className?: string
}

export function StatusDot({ tone, pulse, className }: StatusDotProps) {
  return <span className={cn(statusDot({ tone, pulse }), className)} />
}

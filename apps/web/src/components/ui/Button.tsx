import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-[background-color,transform] active:scale-[.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-arc text-ink hover:bg-arc-deep',
        safe: 'bg-safe text-[#04261b] hover:brightness-105',
        danger: 'bg-raised text-danger ring-1 ring-danger/30 hover:bg-raised/70',
        ghost: 'text-mist hover:bg-raised hover:text-frost',
      },
      size: {
        sm: 'px-3 py-2 text-[13.5px]',
        md: 'px-4 py-3 text-sm',
        icon: 'size-9 rounded-lg',
        fab: 'size-14 rounded-[19px] text-2xl shadow-[0_14px_30px_-8px_rgba(77,182,232,.55)]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof button> {}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />
}

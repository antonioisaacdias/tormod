import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'

interface SessionSearchProps {
  className?: string
}

export function SessionSearch({ className }: SessionSearchProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 transition-colors focus-within:border-arc/50',
        className,
      )}
    >
      <Search className="size-3.5 shrink-0 text-faint" />
      <input
        type="search"
        placeholder="Buscar sessões…"
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-frost outline-none placeholder:text-faint"
      />
    </div>
  )
}

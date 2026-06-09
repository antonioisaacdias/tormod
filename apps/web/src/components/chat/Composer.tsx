import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAutoResizeTextarea } from './useAutoResizeTextarea'

const MAX_HEIGHT = 160

interface ComposerProps {
  placeholder?: string
}

export function Composer({ placeholder = 'Responder ao Claude Code…' }: ComposerProps) {
  const { ref, resize } = useAutoResizeTextarea(MAX_HEIGHT)

  return (
    <div className="flex items-end gap-2.5">
      <textarea
        ref={ref}
        rows={1}
        onInput={resize}
        placeholder={placeholder}
        className="max-h-40 min-h-12 min-w-0 flex-1 resize-none overflow-y-auto scrollbar-none rounded-2xl border border-border bg-surface px-4 py-3 text-sm leading-normal text-frost outline-none transition-colors placeholder:text-faint focus:border-arc/50"
      />
      <Button size="icon" aria-label="Enviar" className="size-12 shrink-0 rounded-2xl">
        <ArrowUp className="size-5" strokeWidth={2.5} />
      </Button>
    </div>
  )
}

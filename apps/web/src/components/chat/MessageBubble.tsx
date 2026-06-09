import { Zap } from 'lucide-react'
import { cn } from '@/lib/cn'
import { InlineText } from './InlineText'
import type { InlineSegment, MessageAuthor } from '@/types/thread'

interface MessageBubbleProps {
  author: MessageAuthor
  segments: InlineSegment[]
}

export function MessageBubble({ author, segments }: MessageBubbleProps) {
  const isUser = author === 'user'
  return (
    <div className={cn('mb-3.5 flex flex-col', isUser && 'items-end')}>
      {!isUser && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-arc">
          <Zap className="size-3" strokeWidth={2.5} />
          claude code
        </div>
      )}
      <div
        className={cn(
          'max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-[5px] bg-arc font-medium text-ink'
            : 'rounded-bl-[5px] border border-border bg-surface text-frost/90',
        )}
      >
        <InlineText segments={segments} />
      </div>
    </div>
  )
}

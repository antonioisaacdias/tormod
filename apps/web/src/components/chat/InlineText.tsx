import { cn } from '@/lib/cn'
import type { InlineSegment, InlineTone } from '@/types/thread'

const toneClass: Record<InlineTone, string> = {
  plain: '',
  mono: 'font-mono text-frost',
  ok: 'font-mono text-safe',
}

interface InlineTextProps {
  segments: InlineSegment[]
}

export function InlineText({ segments }: InlineTextProps) {
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index} className={cn(toneClass[segment.tone ?? 'plain'])}>
          {segment.text}
        </span>
      ))}
    </>
  )
}

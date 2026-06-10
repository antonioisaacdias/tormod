import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { WorkEntry } from '@/types/thread'

interface WorkBalloonProps {
  entries: WorkEntry[]
  done: boolean
  seeded?: boolean
}

function summarize(entries: WorkEntry[]): string {
  const tools = entries.filter((e) => e.type === 'tool').length
  const parts: string[] = []
  if (entries.some((e) => e.type === 'thinking')) parts.push('raciocínio')
  if (tools > 0) parts.push(`${tools} ${tools === 1 ? 'ação' : 'ações'}`)
  return parts.join(' · ') || 'trabalho'
}

export function WorkBalloon({ entries, done, seeded }: WorkBalloonProps) {
  const [manual, setManual] = useState<boolean | null>(null)
  // Live turns stay open (you watch the work happen + keep it visible after);
  // rehydrated history starts collapsed. Manual toggle overrides either way.
  const open = manual ?? !seeded
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && !done && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [entries, open, done])

  return (
    <div className="mb-3.5 rounded-xl border border-border/60 bg-deep/50">
      <button
        onClick={() => setManual(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-faint"
      >
        {done ? (
          <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        ) : (
          <span className="inline-flex shrink-0 gap-0.5">
            <span className="size-1.5 animate-pulse rounded-full bg-arc" />
            <span className="size-1.5 animate-pulse rounded-full bg-arc [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-arc [animation-delay:300ms]" />
          </span>
        )}
        <span className="font-medium uppercase tracking-wide">{done ? summarize(entries) : 'trabalhando…'}</span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="flex max-h-60 flex-col gap-2 overflow-y-auto scrollbar-thin border-t border-border/60 px-3 py-2.5"
        >
          {entries.map((entry, i) =>
            entry.type === 'thinking' ? (
              <div key={i} className="whitespace-pre-wrap text-[12px] italic leading-relaxed text-mist/70">
                {entry.text}
              </div>
            ) : (
              <div key={i} className="font-mono text-[11.5px] leading-relaxed">
                <div>
                  <span className="text-arc">{entry.tool}</span>{' '}
                  <span className="break-all text-[#c3cfdd]">{entry.command}</span>
                </div>
                {entry.detail && (
                  <div className="mt-1 whitespace-pre-wrap break-words border-l-2 border-border/60 pl-2 text-[11px] not-italic text-mist/60">
                    {entry.detail}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

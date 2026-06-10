import { MessageBubble } from './MessageBubble'
import { WorkBalloon } from './WorkBalloon'
import { ApprovalCard } from './ApprovalCard'
import type { ApprovalDecision, ThreadItem } from '@/types/thread'

interface ThreadProps {
  items: ThreadItem[]
  decisions: Record<string, ApprovalDecision>
  working?: boolean
  onDecide: (approvalId: string, decision: ApprovalDecision) => void
}

export function Thread({ items, decisions, working, onDecide }: ThreadProps) {
  const visible = items.filter((item) => !item.gatedBy || decisions[item.gatedBy] === 'allowed')
  const last = visible[visible.length - 1]
  const openWork = last?.kind === 'work' && !last.done

  return (
    <div className="mx-auto flex w-full max-w-[660px] flex-col">
      {visible.map((item) => {
        switch (item.kind) {
          case 'work':
            return <WorkBalloon key={item.id} entries={item.entries} done={item.done} seeded={item.seeded} />
          case 'day':
            return (
              <div key={item.id} className="mb-4 mt-0.5 text-center">
                <span className="rounded-full bg-surface px-3 py-1 text-[10.5px] text-faint">
                  {item.label}
                </span>
              </div>
            )
          case 'message':
            return <MessageBubble key={item.id} author={item.author} segments={item.segments} />
          case 'approval':
            return (
              <ApprovalCard
                key={item.id}
                tool={item.tool}
                node={item.node}
                command={item.command}
                decision={decisions[item.id]}
                onDecide={(decision) => onDecide(item.id, decision)}
              />
            )
        }
      })}
      {working && !openWork && (
        <div className="mb-3.5 flex items-center gap-2 text-[11px] text-faint">
          <span className="inline-flex gap-1">
            <span className="size-1.5 animate-pulse rounded-full bg-arc" />
            <span className="size-1.5 animate-pulse rounded-full bg-arc [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-arc [animation-delay:300ms]" />
          </span>
          trabalhando…
        </div>
      )}
    </div>
  )
}

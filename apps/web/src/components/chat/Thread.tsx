import { MessageBubble } from './MessageBubble'
import { ToolCall } from './ToolCall'
import { ApprovalCard } from './ApprovalCard'
import type { ApprovalDecision, ThreadItem } from '@/types/thread'

interface ThreadProps {
  items: ThreadItem[]
  decisions: Record<string, ApprovalDecision>
  onDecide: (approvalId: string, decision: ApprovalDecision) => void
}

export function Thread({ items, decisions, onDecide }: ThreadProps) {
  const visible = items.filter((item) => !item.gatedBy || decisions[item.gatedBy] === 'allowed')

  return (
    <div className="mx-auto flex w-full max-w-[660px] flex-col">
      {visible.map((item) => {
        switch (item.kind) {
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
          case 'tool':
            return <ToolCall key={item.id} name={item.name} command={item.command} tier={item.tier} />
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
    </div>
  )
}

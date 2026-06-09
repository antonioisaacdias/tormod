import { Check, Hexagon, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import type { ApprovalDecision } from '@/types/thread'

interface ApprovalCardProps {
  tool: string
  node?: string
  command: string
  decision?: ApprovalDecision
  onDecide: (decision: ApprovalDecision) => void
}

export function ApprovalCard({ tool, node, command, decision, onDecide }: ApprovalCardProps) {
  const resolved = decision !== undefined
  const allowed = decision === 'allowed'
  return (
    <div
      className={cn(
        'mb-3.5 rounded-2xl border p-3.5 transition-colors',
        resolved
          ? 'border-border bg-surface'
          : 'border-approve/40 bg-[linear-gradient(165deg,rgba(232,169,60,.13),rgba(232,169,60,.035))]',
      )}
    >
      <div
        className={cn(
          'mb-1.5 flex items-center gap-2 text-[13px] font-bold',
          resolved ? 'text-mist' : 'text-approve',
        )}
      >
        {resolved ? <Hexagon className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
        {resolved ? 'Decisão registrada' : 'Claude quer executar uma ação'}
      </div>

      {!resolved && (
        <div className="mb-3 text-[11px] text-mist">
          tool <span className="font-mono text-frost">{tool}</span> · tier{' '}
          <b className="font-bold text-approve">aprovação</b>
        </div>
      )}

      <div className="mb-3 break-all rounded-lg border border-border bg-ink px-3 py-2.5 font-mono text-[12.5px] text-[#d6dae6]">
        {node && <span className="text-approve">{node}</span>} {command}
      </div>

      {resolved ? (
        <div
          className={cn(
            'flex items-center gap-1.5 text-[12.5px] font-medium',
            allowed ? 'text-safe' : 'text-danger',
          )}
        >
          {allowed ? <Check className="size-4" /> : <X className="size-4" />}
          {allowed
            ? 'Permitido — retomando a sessão…'
            : 'Negado — Claude Code vai propor outra abordagem.'}
        </div>
      ) : (
        <div className="flex gap-2.5">
          <Button variant="danger" className="flex-1" onClick={() => onDecide('denied')}>
            <X className="size-4" /> Negar
          </Button>
          <Button variant="safe" className="flex-[1.5]" onClick={() => onDecide('allowed')}>
            <Check className="size-4" /> Permitir
          </Button>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import type { ApprovalDecision } from '@/types/thread'

export function useThreadDecisions() {
  const [decisions, setDecisions] = useState<Record<string, ApprovalDecision>>({})

  function decide(approvalId: string, decision: ApprovalDecision) {
    setDecisions((current) => ({ ...current, [approvalId]: decision }))
  }

  return { decisions, decide }
}

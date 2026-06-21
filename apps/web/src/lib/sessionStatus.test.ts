import { describe, it, expect } from 'vitest'
import { statusPresentation } from './sessionStatus'

describe('statusPresentation', () => {
  it('maps each status to its tone and label', () => {
    expect(statusPresentation('waiting')).toEqual({ tone: 'approve', label: 'aguardando' })
    expect(statusPresentation('working')).toEqual({ tone: 'arc', label: 'trabalhando' })
    expect(statusPresentation('idle')).toEqual({ tone: 'faint', label: 'ocioso' })
    expect(statusPresentation('closed')).toEqual({ tone: 'faint', label: 'fechada' })
  })
})

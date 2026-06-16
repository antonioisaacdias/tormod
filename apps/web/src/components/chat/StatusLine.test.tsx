// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusLine } from './StatusLine'
import type { SessionUsage } from '@/types/usage'

afterEach(cleanup)

const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
  model: 'opus',
  context: { usedTokens: 100_000, totalTokens: 200_000 },
  limits: {},
  ...over,
})

describe('StatusLine', () => {
  it('shows the model and the computed context percentage', () => {
    render(<StatusLine usage={usage()} />)
    expect(screen.getByText('opus')).toBeDefined()
    expect(screen.getByText('50%')).toBeDefined()
  })

  it('renders rate-limit metrics only when present', () => {
    render(<StatusLine usage={usage({ limits: { fiveHour: 25, sevenDay: 75 } })} />)
    expect(screen.getByText('5h')).toBeDefined()
    expect(screen.getByText('7d')).toBeDefined()
    expect(screen.getByText('25%')).toBeDefined()
  })
})

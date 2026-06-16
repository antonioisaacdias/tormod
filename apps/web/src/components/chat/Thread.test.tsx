// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Thread } from './Thread'
import type { ThreadItem } from '@/types/thread'

afterEach(cleanup)

const noop = () => {}
const items: ThreadItem[] = [
  { id: 'd1', kind: 'day', label: 'Hoje' },
  { id: 'm1', kind: 'message', author: 'user', segments: [{ text: 'oi' }] },
  { id: 'g1', kind: 'message', author: 'brain', segments: [{ text: 'gated reply' }], gatedBy: 'a1' },
  { id: 'a1', kind: 'approval', tool: 'bash', node: 'odin', command: 'ls -la' },
]

describe('Thread', () => {
  it('renders ungated items and hides gated ones until approved', () => {
    render(<Thread items={items} decisions={{}} onDecide={noop} />)
    expect(screen.getByText('Hoje')).toBeDefined()
    expect(screen.getByText('oi')).toBeDefined()
    expect(screen.queryByText('gated reply')).toBeNull()
  })

  it('reveals a gated item once its approval is allowed', () => {
    render(<Thread items={items} decisions={{ a1: 'allowed' }} onDecide={noop} />)
    expect(screen.getByText('gated reply')).toBeDefined()
  })

  it('shows the working indicator when working and no open work balloon', () => {
    render(
      <Thread
        items={[{ id: 'm1', kind: 'message', author: 'user', segments: [{ text: 'x' }] }]}
        decisions={{}}
        working
        onDecide={noop}
      />,
    )
    expect(screen.getByText(/trabalhando/)).toBeDefined()
  })
})

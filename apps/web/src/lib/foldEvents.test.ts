import { describe, it, expect } from 'vitest'
import { appendUserMessage, describe as describeTool, emptyThread, foldEvent, seedThread } from './foldEvents'
import type { ServerEvent } from './serverTypes'
import type { ThreadState } from './foldEvents'

function fold(events: ServerEvent[], start: ThreadState = emptyThread): ThreadState {
  return events.reduce(foldEvent, start)
}

describe('foldEvents — work balloon grouping', () => {
  it('groups thinking + tool into one open work balloon', () => {
    const state = fold([
      { type: 'thinking', text: 'hmm' },
      { type: 'thinking', text: ' ok' },
      { type: 'tool_use', id: 't1', request: { tool: 'Bash', input: { command: 'ls' } } },
    ])
    expect(state.items).toHaveLength(1)
    const work = state.items[0]
    expect(work.kind).toBe('work')
    if (work.kind !== 'work') throw new Error('expected work')
    expect(work.done).toBe(false)
    expect(work.seeded).toBeFalsy() // live turn — starts/stays open
    expect(work.entries).toEqual([
      { type: 'thinking', text: 'hmm ok' },
      { type: 'tool', id: 't1', tool: 'Bash', command: 'ls' },
    ])
  })

  it('keeps the full agent request as the tool entry detail', () => {
    const state = fold([
      { type: 'tool_use', id: 't1', request: { tool: 'Task', input: { subagent_type: 'Explore', description: 'achar bug', prompt: 'instruções completas e longas aqui' } } },
    ])
    const work = state.items[0]
    if (work.kind !== 'work') throw new Error('expected work')
    const entry = work.entries[0]
    expect(entry).toEqual({ type: 'tool', id: 't1', tool: 'Task', command: 'Explore: achar bug', detail: 'instruções completas e longas aqui' })
  })

  it('skips AskUserQuestion tool_use (re-asked inline, not in the work balloon)', () => {
    const state = fold([
      { type: 'tool_use', id: 'q1', request: { tool: 'AskUserQuestion', input: { questions: [{ question: 'cor?' }] } } },
    ])
    expect(state.items).toHaveLength(0)
  })

  it('a brain text message closes the work balloon and renders a bubble', () => {
    const state = fold([
      { type: 'thinking', text: 'pensando' },
      { type: 'text', text: 'resposta' },
    ])
    expect(state.items.map((i) => i.kind)).toEqual(['work', 'message'])
    const work = state.items[0]
    expect(work.kind === 'work' && work.done).toBe(true)
    const msg = state.items[1]
    expect(msg.kind === 'message' && msg.author).toBe('brain')
  })

  it('a carded tool is pulled out of the balloon into a prominent approval', () => {
    const state = fold([
      { type: 'thinking', text: 'vou editar' },
      { type: 'tool_use', id: 't9', request: { tool: 'Write', input: { file_path: '/x' } } },
      { type: 'permission_request', toolUseId: 't9', request: { tool: 'Write', input: { file_path: '/x' } }, tier: 'approve' },
    ])
    // work balloon keeps the thinking; the tool entry is gone; a card appears
    const work = state.items.find((i) => i.kind === 'work')
    expect(work && work.kind === 'work' && work.entries.every((e) => e.type !== 'tool')).toBe(true)
    const approval = state.items.find((i) => i.kind === 'approval')
    expect(approval && approval.kind === 'approval' && approval.tool).toBe('Write')
    expect(approval?.id).toBe('t9')
  })

  it('an empty work balloon (only a carded tool) is dropped', () => {
    const state = fold([
      { type: 'tool_use', id: 't1', request: { tool: 'Write', input: { file_path: '/x' } } },
      { type: 'permission_request', toolUseId: 't1', request: { tool: 'Write', input: { file_path: '/x' } }, tier: 'approve' },
    ])
    expect(state.items.map((i) => i.kind)).toEqual(['approval'])
  })

  it('result closes any open work balloon', () => {
    const state = fold([
      { type: 'thinking', text: 'x' },
      { type: 'result', ok: true },
    ])
    const work = state.items[0]
    expect(work.kind === 'work' && work.done).toBe(true)
  })

  it('a user message closes the open work balloon', () => {
    const start = fold([{ type: 'thinking', text: 'x' }])
    const state = appendUserMessage(start, 'oi')
    expect(state.items.map((i) => i.kind)).toEqual(['work', 'message'])
    expect(state.items[0].kind === 'work' && state.items[0].done).toBe(true)
  })
})

describe('describe — tool formatting (no raw JSON)', () => {
  it('formats Task (subagent) instead of dumping JSON', () => {
    expect(
      describeTool({ tool: 'Task', input: { subagent_type: 'Explore', description: 'find the bug', prompt: 'long...' } }),
    ).toBe('Explore: find the bug')
  })

  it('summarizes TodoWrite by count', () => {
    expect(describeTool({ tool: 'TodoWrite', input: { todos: [1, 2, 3] } })).toBe('3 tarefas')
  })

  it('formats Grep with pattern and path', () => {
    expect(describeTool({ tool: 'Grep', input: { pattern: 'foo', path: 'src' } })).toBe('foo em src')
  })

  it('uses common fields for known tools', () => {
    expect(describeTool({ tool: 'Bash', input: { command: 'ls -la' } })).toBe('ls -la')
    expect(describeTool({ tool: 'WebFetch', input: { url: 'https://x', prompt: 'y' } })).toBe('https://x')
  })
})

describe('foldEvents — seedThread (history)', () => {
  it('groups consecutive tool history into a done work balloon', () => {
    const state = seedThread([
      { role: 'user', text: 'liste' },
      { role: 'tool', tool: 'Bash', input: { command: 'ls' } },
      { role: 'tool', tool: 'Read', input: { file_path: '/etc/hosts' } },
      { role: 'brain', text: 'pronto' },
    ])
    expect(state.items.map((i) => i.kind)).toEqual(['message', 'work', 'message'])
    const work = state.items[1]
    expect(work.kind === 'work' && work.done).toBe(true)
    expect(work.kind === 'work' && work.seeded).toBe(true) // history — starts collapsed
    expect(work.kind === 'work' && work.entries).toHaveLength(2)
  })
})

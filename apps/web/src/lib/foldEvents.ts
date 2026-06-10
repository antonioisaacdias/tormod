import type { ApprovalDecision, ThreadItem, WorkEntry } from '@/types/thread'
import type { HistoryItem, ServerEvent, ToolRequest } from './serverTypes'

export interface ThreadState {
  items: ThreadItem[]
  decisions: Record<string, ApprovalDecision>
  seq: number
}

export const emptyThread: ThreadState = { items: [], decisions: {}, seq: 0 }

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Renders a tool call as a readable one-liner (the single source of tool formatting). */
export function describe(request: ToolRequest): string {
  const { tool } = request
  const input = request.input ?? {}
  if (tool === 'Task') {
    const kind = str(input.subagent_type) ?? 'subagent'
    const what = str(input.description) ?? str(input.prompt)
    return what ? `${kind}: ${what}` : kind
  }
  if (tool === 'TodoWrite') {
    const n = Array.isArray(input.todos) ? input.todos.length : 0
    return `${n} ${n === 1 ? 'tarefa' : 'tarefas'}`
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const pattern = str(input.pattern) ?? ''
    const where = str(input.path)
    return where ? `${pattern} em ${where}` : pattern
  }
  return (
    str(input.command) ??
    str(input.file_path) ??
    str(input.path) ??
    str(input.notebook_path) ??
    str(input.pattern) ??
    str(input.query) ??
    str(input.url) ??
    str(input.description) ??
    JSON.stringify(input)
  )
}

/** The full request behind a tool's headline (e.g. the subagent prompt), shown expanded under it. */
export function detailOf(request: ToolRequest): string | undefined {
  const { tool } = request
  const input = request.input ?? {}
  if (tool === 'Task') return str(input.prompt)
  if (tool === 'Write') return str(input.content)
  if (tool === 'WebFetch') return str(input.prompt)
  return undefined
}

function toolEntry(id: string, request: ToolRequest): WorkEntry {
  const detail = detailOf(request)
  return { type: 'tool', id, tool: request.tool, command: describe(request), ...(detail ? { detail } : {}) }
}

function lastItem(items: ThreadItem[]): ThreadItem | undefined {
  return items[items.length - 1]
}

/** Replaces the last item in a new array. */
function replaceLast(items: ThreadItem[], item: ThreadItem): ThreadItem[] {
  return [...items.slice(0, -1), item]
}

/** Closes any still-open work balloon so the next message/card renders cleanly. */
function closeOpenWork(items: ThreadItem[]): ThreadItem[] {
  const last = lastItem(items)
  if (last && last.kind === 'work' && !last.done) return replaceLast(items, { ...last, done: true })
  return items
}

/** Folds one server event into the thread state. Pure — returns new state. */
export function foldEvent(state: ThreadState, event: ServerEvent): ThreadState {
  switch (event.type) {
    case 'text': {
      const closed = closeOpenWork(state.items)
      const last = lastItem(closed)
      if (last && last.kind === 'message' && last.author === 'brain') {
        return { ...state, items: replaceLast(closed, { ...last, segments: [...last.segments, { text: event.text }] }) }
      }
      return {
        ...state,
        seq: state.seq + 1,
        items: [...closed, { id: `m${state.seq}`, kind: 'message', author: 'brain', segments: [{ text: event.text }] }],
      }
    }

    case 'thinking':
      return appendWork(state, { type: 'thinking', text: event.text }, true)

    case 'tool_use':
      // AskUserQuestion is denied server-side and re-asked inline as text — don't
      // clutter the work balloon with its raw JSON.
      if (event.request.tool === 'AskUserQuestion') return state
      return appendWork(state, toolEntry(event.id, event.request), false)

    case 'permission_request': {
      // A carded tool is shown as a prominent approval, not buried in the work
      // balloon — pull its tentative entry back out, then add the card.
      const stripped = state.items
        .map((item) =>
          item.kind === 'work' && !item.done
            ? { ...item, entries: item.entries.filter((e) => !(e.type === 'tool' && e.id === event.toolUseId)) }
            : item,
        )
        .filter((item) => !(item.kind === 'work' && item.entries.length === 0))
      const approval: ThreadItem = {
        id: event.toolUseId,
        kind: 'approval',
        tool: event.request.tool,
        ...(str(event.request.input.node) ? { node: str(event.request.input.node) } : {}),
        command: event.literal ?? describe(event.request),
      }
      const exists = stripped.some((item) => item.id === event.toolUseId)
      return {
        ...state,
        items: exists
          ? stripped.map((item) => (item.id === event.toolUseId ? approval : item))
          : [...stripped, approval],
      }
    }

    case 'permission_resolved':
      return {
        ...state,
        decisions: { ...state.decisions, [event.toolUseId]: event.allow ? 'allowed' : 'denied' },
      }

    case 'result':
    case 'error': {
      const items = state.items.map((item) =>
        item.kind === 'work' && !item.done ? { ...item, done: true } : item,
      )
      if (event.type === 'error') {
        return {
          ...state,
          seq: state.seq + 1,
          items: [...items, { id: `m${state.seq}`, kind: 'message', author: 'brain', segments: [{ text: `⚠ ${event.message}` }] }],
        }
      }
      return { ...state, items }
    }

    case 'tool_result':
    case 'usage':
      return state
  }
}

/** Appends an entry to the open work balloon, or opens a new one. */
function appendWork(state: ThreadState, entry: WorkEntry, mergeThinking: boolean): ThreadState {
  const last = lastItem(state.items)
  if (last && last.kind === 'work' && !last.done) {
    const entries = [...last.entries]
    const tail = entries[entries.length - 1]
    if (mergeThinking && entry.type === 'thinking' && tail && tail.type === 'thinking') {
      entries[entries.length - 1] = { type: 'thinking', text: tail.text + entry.text }
    } else {
      entries.push(entry)
    }
    return { ...state, items: replaceLast(state.items, { ...last, entries }) }
  }
  return {
    ...state,
    seq: state.seq + 1,
    items: [...state.items, { id: `w${state.seq}`, kind: 'work', entries: [entry], done: false }],
  }
}

/** Builds initial thread state from transcript history, grouping tools into work balloons. */
export function seedThread(history: HistoryItem[]): ThreadState {
  const items: ThreadItem[] = []
  let seq = 0
  for (const entry of history) {
    if (entry.role === 'tool') {
      const last = items[items.length - 1]
      const we = toolEntry(`h${seq++}`, { tool: entry.tool, input: entry.input })
      if (last && last.kind === 'work') {
        items[items.length - 1] = { ...last, entries: [...last.entries, we] }
      } else {
        items.push({ id: `w${seq++}`, kind: 'work', entries: [we], done: true, seeded: true })
      }
    } else {
      items.push({
        id: `m${seq++}`,
        kind: 'message',
        author: entry.role === 'user' ? 'user' : 'brain',
        segments: [{ text: entry.text }],
      })
    }
  }
  return { items, decisions: {}, seq }
}

/** Appends a user message to the thread (echoed locally on send). */
export function appendUserMessage(state: ThreadState, text: string): ThreadState {
  return {
    ...state,
    seq: state.seq + 1,
    items: [...closeOpenWork(state.items), { id: `u${state.seq}`, kind: 'message', author: 'user', segments: [{ text }] }],
  }
}

/** Optimistically records a local decision before the server confirms it. */
export function setDecision(state: ThreadState, toolUseId: string, decision: ApprovalDecision): ThreadState {
  return { ...state, decisions: { ...state.decisions, [toolUseId]: decision } }
}

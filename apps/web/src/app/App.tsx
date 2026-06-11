import { useEffect, useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { SessionList } from '@/components/sessions/SessionList'
import { ChatView } from '@/components/chat/ChatView'
import { SettingsDrawer } from '@/components/settings/SettingsDrawer'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useSessions } from '@/hooks/useSessions'
import { useSessionThreads } from '@/hooks/useSessionThreads'
import { setToken } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import type { SessionAction } from '@/components/sessions/SessionActionsMenu'

export function App() {
  const { sessions, unauthorized, loading, refresh, create, close, remove, setMode } = useSessions()
  const [activeId, setActiveId] = usePersistentState<string | null>('tormod:activeId', null)
  const [mobileChat, setMobileChat] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drafts, setDrafts] = usePersistentState<Record<string, string>>('tormod:drafts', {})

  // Keep the user on their last session across reloads; only fall back to the
  // first session once the list has loaded and the saved one is gone.
  useEffect(() => {
    if (sessions.length === 0) return
    if (activeId && sessions.some((session) => session.id === activeId)) return
    setActiveId(sessions[0].id)
  }, [sessions, activeId, setActiveId])

  const active = sessions.find((session) => session.id === activeId) ?? null
  const threads = useSessionThreads()
  const runtime = threads.get(active?.id ?? null)
  const ensure = threads.ensure

  // Open the active session's stream; previously-opened streams stay alive so a
  // working session's thinking/tooling isn't lost when you switch away.
  useEffect(() => {
    if (active) ensure(active.id, active.usage)
  }, [active, ensure])

  function openSession(id: string) {
    setActiveId(id)
    setMobileChat(true)
  }

  function changeDraft(value: string) {
    if (!active) return
    setDrafts((current) => ({ ...current, [active.id]: value }))
  }

  function onSend(text: string) {
    if (!active) return
    void threads.send(active.id, text)
    setDrafts((current) => ({ ...current, [active.id]: '' }))
  }

  async function onCreate() {
    const id = await create()
    if (id) openSession(id)
  }

  function onSessionAction(id: string, action: SessionAction) {
    if (action === 'close') void close(id)
    else if (action === 'delete') {
      threads.drop(id)
      void remove(id)
      if (id === activeId) setActiveId(null)
    }
    // 'resume' and 'rename' have no backend route yet — no-op.
  }

  if (loading) {
    return <div className="grid h-full place-items-center bg-ink text-faint">Carregando…</div>
  }

  if (unauthorized) {
    return <TokenGate onSubmit={async (token) => { setToken(token); await refresh() }} />
  }

  return (
    <div className="flex h-full bg-ink text-frost">
      <aside
        className={cn(
          'flex-col gap-4 border-r border-border bg-deep p-3.5 lg:flex lg:w-72',
          mobileChat ? 'hidden' : 'flex w-full',
        )}
      >
        <div className="flex items-center justify-between">
          <Brand />
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Configurações">
            <SettingsIcon className="size-5" />
          </Button>
        </div>
        <SessionList
          sessions={sessions}
          activeId={activeId ?? ''}
          drafts={drafts}
          onSelect={openSession}
          onCreate={onCreate}
          onSessionAction={onSessionAction}
        />
      </aside>

      <main className={cn('min-h-0 flex-1', mobileChat ? 'flex' : 'hidden lg:flex')}>
        {active ? (
          <ChatView
            session={active}
            items={runtime.thread.items}
            usage={runtime.usage}
            decisions={runtime.thread.decisions}
            working={runtime.working}
            draft={drafts[active.id] ?? ''}
            onDraftChange={changeDraft}
            onSend={onSend}
            onStop={() => void threads.interrupt(active.id)}
            onDecide={(toolUseId, decision) => void threads.decide(active.id, toolUseId, decision)}
            onSetPermissionMode={(mode) => void setMode(active.id, mode)}
            onBack={() => setMobileChat(false)}
          />
        ) : (
          <div className="grid flex-1 place-items-center text-center text-faint">
            <div>
              <p className="mb-3 text-sm">Nenhuma sessão. Crie uma para conversar com o Claude Code.</p>
              <Button onClick={onCreate}>Nova sessão</Button>
            </div>
          </div>
        )}
      </main>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="grid h-full place-items-center bg-ink text-frost">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim()) onSubmit(value.trim())
        }}
        className="flex w-full max-w-sm flex-col gap-3 px-6"
      >
        <h1 className="text-lg font-bold">Tormod</h1>
        <p className="text-sm text-faint">Cole o bearer token para conectar ao servidor.</p>
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="TORMOD_TOKEN"
          autoFocus
          className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-frost outline-none focus:border-arc/50"
        />
        <Button type="submit" disabled={!value.trim()}>
          Conectar
        </Button>
      </form>
    </div>
  )
}

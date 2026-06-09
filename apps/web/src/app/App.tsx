import { useState } from 'react'
import { Brand } from '@/components/Brand'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { SessionList } from '@/components/sessions/SessionList'
import { ChatView } from '@/components/chat/ChatView'
import { cn } from '@/lib/cn'
import { sessions } from '@/fixtures/sessions'
import { thread } from '@/fixtures/thread'
import { sessionUsage } from '@/fixtures/usage'

export function App() {
  const [activeId, setActiveId] = useState(sessions[0].id)
  const [mobileChat, setMobileChat] = useState(false)
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0]

  function openSession(id: string) {
    setActiveId(id)
    setMobileChat(true)
  }

  return (
    <div className="flex h-full bg-ink text-frost">
      <aside
        className={cn(
          'flex-col gap-4 border-r border-border bg-deep p-3.5 lg:flex lg:w-72',
          mobileChat ? 'hidden' : 'flex w-full',
        )}
      >
        <Brand />
        <ConnectionBadge />
        <SessionList sessions={sessions} activeId={activeId} onSelect={openSession} />
      </aside>

      <main className={cn('min-h-0 flex-1', mobileChat ? 'flex' : 'hidden lg:flex')}>
        <ChatView session={active} items={thread} usage={sessionUsage} onBack={() => setMobileChat(false)} />
      </main>
    </div>
  )
}

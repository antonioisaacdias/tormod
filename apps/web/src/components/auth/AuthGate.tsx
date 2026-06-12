import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { getStatus, register, login, AuthError } from '@/lib/auth'
import type { AuthStatus } from '@/lib/serverTypes'

const input =
  'rounded-xl border border-border bg-surface px-4 py-3 text-sm text-frost outline-none focus:border-arc/50'

export function AuthGate({ onAuthed }: { onAuthed: () => void }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)

  useEffect(() => {
    getStatus().then(setStatus).catch(() => setStatus({ registered: false, external: false, totpEnabled: false }))
  }, [])

  if (!status) {
    return <div className="grid h-full place-items-center bg-ink text-faint">Carregando…</div>
  }
  if (!status.registered) return <RegisterForm onDone={onAuthed} />
  return <LoginForm status={status} onDone={onAuthed} />
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await register({ username, email, password })
      onDone()
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'falha no cadastro')
    } finally {
      setBusy(false)
    }
  }

  const valid = username.trim().length >= 3 && email.includes('@') && password.length >= 8

  return (
    <div className="grid h-full place-items-center bg-ink text-frost">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3 px-6">
        <h1 className="text-lg font-bold">Tormod — primeiro acesso</h1>
        <p className="text-sm text-faint">Crie o usuário que vai operar o homelab.</p>
        <input className={input} placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <input className={input} type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" placeholder="senha (mín. 8)" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={!valid || busy}>{busy ? 'Criando…' : 'Criar conta'}</Button>
      </form>
    </div>
  )
}

function LoginForm({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const needsTotp = status.external && status.totpEnabled
  const blocked = status.external && !status.totpEnabled

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login({ username, password, ...(needsTotp ? { totp } : {}) })
      onDone()
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'falha no login')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center bg-ink text-frost">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3 px-6">
        <h1 className="text-lg font-bold">Tormod</h1>
        {blocked ? (
          <p className="text-sm text-amber-400">
            2FA não configurado. Conecte pela LAN/VPN para configurar o segundo fator antes de acessar externamente.
          </p>
        ) : (
          <>
            <input className={input} placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            <input className={input} type="password" placeholder="senha" value={password} onChange={(e) => setPassword(e.target.value)} />
            {needsTotp && (
              <input className={input} inputMode="numeric" placeholder="código 2FA (6 dígitos)" value={totp} onChange={(e) => setTotp(e.target.value)} />
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" disabled={busy || !username || !password}>{busy ? 'Entrando…' : 'Entrar'}</Button>
          </>
        )}
      </form>
    </div>
  )
}

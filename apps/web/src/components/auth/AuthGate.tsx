import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { getStatus, register, login, AuthError } from '@/lib/auth'
import type { AuthStatus } from '@/lib/serverTypes'

const inputClass =
  'rounded-xl border border-border bg-surface px-4 py-3 text-sm text-frost outline-none focus:border-arc/50'

function authErrorMessage(err: unknown, mode: 'login' | 'register'): string {
  const fallback = mode === 'login' ? 'Não foi possível entrar. Tente novamente.' : 'Não foi possível criar a conta.'
  if (!(err instanceof AuthError)) return fallback
  if (err.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
  if (err.status === 400) return 'Dados inválidos. Confira usuário (mín. 3), email e senha (mín. 8).'
  if (mode === 'register' && err.status === 403) return 'Já existe um usuário cadastrado neste Tormod.'
  if (mode === 'login' && err.status === 401) return 'Usuário ou senha inválidos.'
  if (mode === 'login' && err.status === 403) return 'Configure o 2FA pela LAN/VPN antes de acessar externamente.'
  return fallback
}

function Field({ label, id, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-faint">
        {label}
      </label>
      <input id={id} className={inputClass} {...props} />
    </div>
  )
}

function Alert({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) {
  const Icon = tone === 'danger' ? AlertCircle : AlertTriangle
  const toneClass =
    tone === 'danger'
      ? 'border-danger/30 bg-danger/10 text-danger'
      : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-snug', toneClass)}>
      <Icon className="mt-px size-4 shrink-0" strokeWidth={2.25} />
      <span>{children}</span>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center bg-ink px-6 text-frost">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-deep p-7 shadow-xl shadow-black/30">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        {children}
      </div>
    </div>
  )
}

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
      setError(authErrorMessage(err, 'register'))
    } finally {
      setBusy(false)
    }
  }

  const valid = username.trim().length >= 3 && email.includes('@') && password.length >= 8

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h1 className="text-base font-bold text-frost">Primeiro acesso</h1>
          <p className="text-sm text-faint">Crie o usuário que vai operar o homelab.</p>
        </div>
        <Field label="Usuário" id="reg-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <Field label="Email" id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Senha" id="reg-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="-mt-1 text-xs text-mist">Mínimo de 8 caracteres.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" disabled={!valid || busy}>
          {busy ? 'Criando…' : 'Criar conta'}
        </Button>
      </form>
    </Card>
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
      setError(authErrorMessage(err, 'login'))
    } finally {
      setBusy(false)
    }
  }

  if (blocked) {
    return (
      <Card>
        <Alert tone="warning">
          2FA não configurado. Conecte pela LAN/VPN para configurar o segundo fator antes de acessar externamente.
        </Alert>
      </Card>
    )
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Usuário" id="login-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <Field label="Senha" id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {needsTotp && (
          <Field
            label="Código 2FA"
            id="login-totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" disabled={busy || !username || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </Card>
  )
}

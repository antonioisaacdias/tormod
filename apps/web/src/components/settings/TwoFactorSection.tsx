import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { getProfile, enrollTotp, confirmTotp, disableTotp, AuthError } from '@/lib/auth'
import type { TotpEnrollment } from '@/lib/serverTypes'

const input = 'rounded-lg border border-border bg-surface px-3 py-2 text-sm text-frost outline-none focus:border-arc/50'

export function TwoFactorSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function load() {
    getProfile().then((p) => setEnabled(p.totpEnabled)).catch(() => setEnabled(null))
  }
  useEffect(load, [])

  async function startEnroll() {
    setError('')
    try {
      setEnrollment(await enrollTotp())
    } catch (err) {
      setError(err instanceof AuthError && err.status === 403 ? 'Configure o 2FA conectado pela LAN/VPN.' : 'falha ao iniciar 2FA')
    }
  }

  async function confirm() {
    setError('')
    try {
      await confirmTotp(token)
      setEnrollment(null)
      setToken('')
      load()
    } catch {
      setError('código inválido')
    }
  }

  async function disable() {
    setError('')
    try {
      await disableTotp(password)
      setPassword('')
      load()
    } catch {
      setError('senha inválida')
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-frost">Autenticação em dois fatores (2FA)</h3>
      {enabled === null && <p className="text-sm text-faint">—</p>}

      {enabled === true && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-faint">2FA ativo. Exigido em acessos externos.</p>
          <input className={input} type="password" placeholder="senha para desativar" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="ghost" onClick={disable} disabled={!password}>Desativar 2FA</Button>
        </div>
      )}

      {enabled === false && !enrollment && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-faint">Recomendado antes de expor o Tormod à internet.</p>
          <Button onClick={startEnroll}>Configurar 2FA</Button>
        </div>
      )}

      {enrollment && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-faint">Escaneie no app autenticador (Aegis, Bitwarden, Google Authenticator):</p>
          <img src={enrollment.qrDataUrl} alt="QR code 2FA" className="size-44 rounded-lg bg-white p-2" />
          <input className={input} inputMode="numeric" placeholder="código de 6 dígitos" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button onClick={confirm} disabled={token.length < 6}>Confirmar</Button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  )
}

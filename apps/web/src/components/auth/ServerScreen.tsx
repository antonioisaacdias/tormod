import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { setServerUrl, clearServerUrl } from '@/lib/platform'
import { validateServerUrl } from '@/lib/request'
import { getStatus } from '@/lib/auth'

const inputClass =
  'rounded-xl border border-border bg-surface px-4 py-3 text-sm text-frost outline-none focus:border-arc/50'

export function ServerScreen({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const normalized = validateServerUrl(url)
    if (!normalized) {
      setError('Endereço inválido. Use algo como http://10.0.0.10:8080')
      return
    }
    setBusy(true)
    setServerUrl(normalized)
    try {
      await getStatus()
      onConnected()
    } catch {
      clearServerUrl()
      setError('Não foi possível alcançar esse servidor. Confira o endereço e a conexão (VPN).')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center bg-ink px-6 text-frost">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-deep p-7 shadow-xl shadow-black/30">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <h1 className="text-base font-bold text-frost">Conectar ao servidor</h1>
            <p className="text-sm text-faint">Endereço do seu Tormod na rede (ou pela VPN).</p>
          </div>
          <input
            className={cn(inputClass)}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="http://10.0.0.10:8080"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm leading-snug text-danger">
              <AlertCircle className="mt-px size-4 shrink-0" strokeWidth={2.25} />
              <span>{error}</span>
            </div>
          )}
          <Button type="submit" disabled={busy || url.trim().length === 0}>
            {busy ? 'Conectando…' : 'Conectar'}
          </Button>
        </form>
      </div>
    </div>
  )
}

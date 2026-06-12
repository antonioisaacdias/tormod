import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/Button'
import { TwoFactorSection } from './TwoFactorSection'
import type { Settings } from '@/lib/serverTypes'

const MODELS: Settings['defaultModel'][] = ['auto', 'opus', 'sonnet', 'haiku']
const EFFORTS: Settings['defaultEffort'][] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { settings, saving, unauthorized, save } = useSettings(open)
  const [maxLive, setMaxLive] = useState('')
  const [idleHours, setIdleHours] = useState('')
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (settings) {
      setMaxLive(String(settings.maxLiveSessions))
      setIdleHours(String(settings.idleCloseHours))
      setPrompt(settings.systemPrompt)
    }
  }, [settings])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-sm flex-col gap-5 border-l border-border bg-deep p-5 text-frost"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Configurações</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="size-5" />
          </Button>
        </div>

        {unauthorized ? (
          <p className="text-sm text-danger">Sessão expirada. Recarregue a página e entre com o token novamente.</p>
        ) : !settings ? (
          <p className="text-sm text-faint">Carregando…</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Máximo de sessões vivas</span>
              <input
                type="number"
                min={1}
                max={50}
                value={maxLive}
                onChange={(e) => setMaxLive(e.target.value)}
                onBlur={() => save({ maxLiveSessions: Number(maxLive) })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              />
              <span className="text-[11px] text-faint">
                Ao exceder, as sessões ociosas há mais tempo são fechadas automaticamente (turnos em andamento são preservados).
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Horas ociosas para fechar</span>
              <input
                type="number"
                min={0}
                max={168}
                value={idleHours}
                onChange={(e) => setIdleHours(e.target.value)}
                onBlur={() => save({ idleCloseHours: Number(idleHours) })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              />
              <span className="text-[11px] text-faint">0 desliga o fechamento automático por ociosidade.</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Modelo padrão</span>
              <select
                value={settings.defaultModel}
                onChange={(e) => save({ defaultModel: e.target.value as Settings['defaultModel'] })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Effort padrão</span>
              <select
                value={settings.defaultEffort}
                onChange={(e) => save({ defaultEffort: e.target.value as Settings['defaultEffort'] })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              >
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>{ef}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Aprovação padrão</span>
              <select
                value={settings.defaultPermissionMode}
                onChange={(e) => save({ defaultPermissionMode: e.target.value as Settings['defaultPermissionMode'] })}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-arc/50"
              >
                <option value="default">Sempre perguntar</option>
                <option value="auto">Modo livre (auto-aprovar)</option>
              </select>
              <span className="text-[11px] text-faint">
                No modo livre, ações que pediriam aprovação são executadas direto; comandos destrutivos continuam bloqueados. Vale para sessões novas (cada sessão pode sobrescrever).
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Contexto do ambiente</span>
              <textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onBlur={() => save({ systemPrompt: prompt })}
                placeholder="Ex.: você roda no odin, controlado de outro PC pela LAN/VPN. Nunca passe links localhost/127.0.0.1 — use o IP da máquina (ex.: 192.168.0.10) ou o domínio público."
                className="resize-y rounded-lg border border-border bg-surface px-3 py-2 leading-relaxed outline-none focus:border-arc/50"
              />
              <span className="text-[11px] text-faint">
                Texto anexado ao system prompt de toda sessão nova — o cérebro fica ciente do ambiente.
              </span>
            </label>

            <TwoFactorSection />

            <span className="text-[11px] text-faint">
              {saving ? 'Salvando…' : 'Modelo, effort e contexto valem para sessões novas.'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
